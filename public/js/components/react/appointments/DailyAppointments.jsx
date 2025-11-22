import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppointmentsHeader from './AppointmentsHeader.jsx';
import StatsCards from './StatsCards.jsx';
import MobileViewToggle from './MobileViewToggle.jsx';
import AppointmentsList from './AppointmentsList.jsx';

import { useAppointments } from '../../../hooks/useAppointments.js';
import { useWebSocketSync } from '../../../hooks/useWebSocketSync.js';
import { actionIdManager } from '../../../utils/action-id.js';
import { appointmentMetrics } from '../../../utils/appointment-metrics.js';

/**
 * DailyAppointments Component
 * Main application for daily appointments management
 *
 * Enhanced with robust action ID tracking for event source detection
 */
const DailyAppointments = () => {
    // Get today's date in local timezone
    const getTodayDate = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const [selectedDate, setSelectedDate] = useState(getTodayDate());
    const [mobileView, setMobileView] = useState('all');
    const [showFlash, setShowFlash] = useState(false);

    // Event deduplication: Track processed WebSocket event IDs
    const processedEventIds = useRef(new Set());
    const EVENT_ID_MAX_SIZE = 100; // Limit memory usage

    // Out-of-order detection: Track last server timestamp per appointment
    const lastServerTimestamp = useRef(new Map());
    const TIMESTAMP_BUFFER_SIZE = 50; // Track last 50 appointments

    // Use custom hooks
    const {
        allAppointments,
        checkedInAppointments,
        loading,
        error,
        loadAppointments,
        checkInPatient,
        markSeated,
        markDismissed,
        undoState,
        undoAction,
        applyGranularUpdate,  // NEW: Efficient granular updates
        getStats
    } = useAppointments();

    // WebSocket integration - GRANULAR updates with action ID tracking and event deduplication
    const { connectionStatus } = useWebSocketSync(selectedDate, (data) => {
        // STEP 1: Event deduplication - skip if already processed
        const eventId = data?.id || data?.messageId;
        if (eventId) {
            if (processedEventIds.current.has(eventId)) {
                console.log('⏭️ [DailyAppointments] Skipping duplicate event:', eventId);
                appointmentMetrics.recordDuplicateEventBlocked(); // Track duplicate
                return; // Already processed this event
            }

            // Mark as processed
            processedEventIds.current.add(eventId);

            // Limit memory usage: keep only last 100 event IDs
            if (processedEventIds.current.size > EVENT_ID_MAX_SIZE) {
                const firstId = processedEventIds.current.values().next().value;
                processedEventIds.current.delete(firstId);
            }
        }

        // STEP 2: Check if this update is from our own action using action ID
        const isOwnAction = data?.actionId && actionIdManager.isOwnAction(data.actionId);
        appointmentMetrics.recordEventReceived(isOwnAction); // Track event

        if (isOwnAction) {
            // Our own action - optimistic update already handled it
            console.log('📡 [DailyAppointments] WebSocket update from own action - skipping');
            flashUpdateIndicator();
        } else {
            // Update from another client - use GRANULAR update if available
            console.log('📡 [DailyAppointments] WebSocket update from another client');

            // STEP 3: Out-of-order detection (warn if events arrive scrambled)
            if (data?.serverTimestamp && data?.appointmentId) {
                const lastTimestamp = lastServerTimestamp.current.get(data.appointmentId);

                if (lastTimestamp && data.serverTimestamp < lastTimestamp) {
                    const timeDiff = lastTimestamp - data.serverTimestamp;
                    console.warn('⚠️ Out-of-order event detected!', {
                        appointmentId: data.appointmentId,
                        thisTimestamp: data.serverTimestamp,
                        lastTimestamp: lastTimestamp,
                        timeDiff
                    });
                    appointmentMetrics.recordOutOfOrderEvent(timeDiff); // Track out-of-order
                    // Still apply the update (deduplication prevents true duplicates)
                    // But log for monitoring/debugging
                }

                // Update last timestamp
                lastServerTimestamp.current.set(data.appointmentId, data.serverTimestamp);

                // Limit memory: keep only last 50 appointments
                if (lastServerTimestamp.current.size > TIMESTAMP_BUFFER_SIZE) {
                    const firstKey = lastServerTimestamp.current.keys().next().value;
                    lastServerTimestamp.current.delete(firstKey);
                }
            }

            // Check if we have granular data (efficient update)
            if (data?.changeType && data?.appointmentId) {
                console.log('✨ Using granular update - NO API call needed!', data);
                appointmentMetrics.recordGranularUpdate(); // Track granular update
                applyGranularUpdate({
                    changeType: data.changeType,
                    appointmentId: data.appointmentId,
                    state: data.state,
                    updates: data.updates
                });
            } else {
                // Fallback to full reload (legacy mode or unknown change type)
                console.log('⚠️ No granular data, falling back to full reload');
                appointmentMetrics.recordFullReload(); // Track full reload
                loadAppointments(selectedDate);
            }

            flashUpdateIndicator();
        }
    });

    // Load appointments when date changes
    useEffect(() => {
        loadAppointments(selectedDate);
    }, [selectedDate, loadAppointments]);

    // Handle WebSocket reconnection (e.g., after computer wakes from sleep)
    useEffect(() => {
        const handleReconnect = () => {
            console.log('[DailyAppointments] 🔄 Connection restored - refreshing appointments');
            appointmentMetrics.recordReconnection(); // Track reconnection
            loadAppointments(selectedDate);
        };

        window.addEventListener('websocket_reconnected', handleReconnect);

        return () => {
            window.removeEventListener('websocket_reconnected', handleReconnect);
        };
    }, [selectedDate, loadAppointments]);

    // Log metrics summary periodically (development mode only)
    useEffect(() => {
        if (process.env.NODE_ENV === 'development') {
            const interval = setInterval(() => {
                const metrics = appointmentMetrics.getMetrics();
                if (metrics.totalEventsReceived > 0) {
                    appointmentMetrics.logSummary();
                }
            }, 60000); // Every 60 seconds

            return () => clearInterval(interval);
        }
    }, []);

    // Flash update indicator
    const flashUpdateIndicator = () => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    };

    // Handle date change
    const handleDateChange = (newDate) => {
        setSelectedDate(newDate);
    };

    // Handle check-in (OPTIMISTIC UPDATE - no reload needed!)
    const handleCheckIn = async (appointmentId) => {
        try {
            const result = await checkInPatient(appointmentId);
            if (result.success) {
                // Register action ID for tracking
                actionIdManager.registerAction(result.actionId);

                // No loadAppointments() needed! Hook updates state optimistically
            }
        } catch (err) {
        }
    };

    // Handle mark seated (OPTIMISTIC UPDATE - no reload needed!)
    const handleMarkSeated = async (appointmentId) => {
        try {
            const result = await markSeated(appointmentId);
            if (result.success) {
                // Register action ID for tracking
                actionIdManager.registerAction(result.actionId);

                // No loadAppointments() needed! Hook updates state optimistically
            }
        } catch (err) {
        }
    };

    // Handle mark dismissed (OPTIMISTIC UPDATE - no reload needed!)
    const handleMarkDismissed = async (appointmentId) => {
        try {
            const result = await markDismissed(appointmentId);
            if (result.success) {
                // Register action ID for tracking
                actionIdManager.registerAction(result.actionId);

                // No loadAppointments() needed! Hook updates state optimistically
            }
        } catch (err) {
        }
    };

    // Handle undo state (OPTIMISTIC UPDATE - no reload needed!)
    const handleUndoState = async (appointmentId, stateToUndo) => {
        try {
            const result = await undoState(appointmentId, stateToUndo);
            if (result.success && result.actionId) {
                // Register action ID for tracking
                actionIdManager.registerAction(result.actionId);
            }
            // No loadAppointments() needed! Hook updates state optimistically
        } catch (err) {
        }
    };

    // Handle undo action from notification (OPTIMISTIC UPDATE - no reload needed!)
    const handleUndoAction = async (undoData) => {
        try {
            await undoAction(undoData.appointmentId, undoData.previousState);
            // No loadAppointments() needed! Hook updates state optimistically
        } catch (err) {
        }
    };

    // Get statistics (from API or calculated)
    const stats = getStats();

    // Error state
    if (error) {
        return (
            <div className="daily-appointments-view">
                <div className="error-message">
                    <i className="fas fa-exclamation-circle"></i>
                    Failed to load appointments: {error}
                </div>
            </div>
        );
    }

    return (
        <div className="daily-appointments-view">
            {/* Header with date picker */}
            <AppointmentsHeader
                selectedDate={selectedDate}
                onDateChange={handleDateChange}
                connectionStatus={connectionStatus}
                showFlash={showFlash}
            />

            {/* Mobile view toggle */}
            <MobileViewToggle
                activeView={mobileView}
                onViewChange={setMobileView}
            />

            {/* Statistics cards */}
            <StatsCards
                total={stats.total}
                checkedIn={stats.checkedIn}
                waiting={stats.completed}
                completed={stats.completed}
            />

            {/* Appointments lists */}
            <div className="container full-width">
                <AppointmentsList
                    title="All Appointments"
                    appointments={allAppointments}
                    showStatus={false}
                    loading={loading}
                    onCheckIn={handleCheckIn}
                    emptyMessage="No appointments scheduled for this date."
                    className={mobileView === 'all' ? 'active-view' : ''}
                />

                <AppointmentsList
                    title="Checked-In Patients"
                    appointments={checkedInAppointments}
                    showStatus={true}
                    loading={loading}
                    onMarkSeated={handleMarkSeated}
                    onMarkDismissed={handleMarkDismissed}
                    onUndoState={handleUndoState}
                    emptyMessage="No patients checked in yet."
                    className={mobileView === 'checked-in' ? 'active-view' : ''}
                />
            </div>

            {/* Footer */}
            <footer>
                <p>&copy; 2025 Shwan Orthodontics. All rights reserved.</p>
            </footer>

        </div>
    );
};

export default DailyAppointments;
