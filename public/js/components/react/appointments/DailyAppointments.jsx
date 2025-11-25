import React, { useState, useEffect } from 'react';
import AppointmentsHeader from './AppointmentsHeader.jsx';
import StatsCards from './StatsCards.jsx';
import MobileViewToggle from './MobileViewToggle.jsx';
import AppointmentsList from './AppointmentsList.jsx';

import { useAppointments } from '../../../hooks/useAppointments.js';
import { useWebSocketSync } from '../../../hooks/useWebSocketSync.js';

/**
 * DailyAppointments Component
 * Main application for daily appointments management
 *
 * SIMPLIFIED APPROACH:
 * - No optimistic updates
 * - No action ID tracking
 * - No deduplication logic
 * - Just reload on every WebSocket message
 * - Database is the single source of truth
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
        getStats
    } = useAppointments();

    // WebSocket integration - SIMPLIFIED: just reload on message
    const { connectionStatus } = useWebSocketSync(selectedDate, (data) => {
        console.log('📡 [DailyAppointments] WebSocket update received - reloading appointments');
        loadAppointments(selectedDate);
        flashUpdateIndicator();
    });

    // Load appointments when date changes
    useEffect(() => {
        loadAppointments(selectedDate);
    }, [selectedDate, loadAppointments]);

    // Handle WebSocket reconnection
    useEffect(() => {
        const handleReconnect = () => {
            console.log('[DailyAppointments] 🔄 Connection restored - refreshing appointments');
            loadAppointments(selectedDate);
        };

        window.addEventListener('websocket_reconnected', handleReconnect);

        return () => {
            window.removeEventListener('websocket_reconnected', handleReconnect);
        };
    }, [selectedDate, loadAppointments]);

    // Flash update indicator
    const flashUpdateIndicator = () => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    };

    // Handle date change
    const handleDateChange = (newDate) => {
        setSelectedDate(newDate);
    };

    // Handle check-in
    const handleCheckIn = async (appointmentId) => {
        try {
            await checkInPatient(appointmentId, selectedDate);
        } catch (err) {
            console.error('Check-in failed:', err);
        }
    };

    // Handle mark seated
    const handleMarkSeated = async (appointmentId) => {
        try {
            await markSeated(appointmentId, selectedDate);
        } catch (err) {
            console.error('Seat failed:', err);
        }
    };

    // Handle mark dismissed
    const handleMarkDismissed = async (appointmentId) => {
        try {
            await markDismissed(appointmentId, selectedDate);
        } catch (err) {
            console.error('Dismiss failed:', err);
        }
    };

    // Handle undo state
    const handleUndoState = async (appointmentId, stateToUndo) => {
        try {
            await undoState(appointmentId, stateToUndo, selectedDate);
        } catch (err) {
            console.error('Undo failed:', err);
        }
    };

    // Get statistics
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
                waiting={stats.waiting}
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
