import React, { useState, useEffect } from 'react';
import { useLoaderData, useSearchParams } from 'react-router-dom';
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
 * HYBRID APPROACH:
 * - Loader pre-fetches initial data (eliminates loading flash)
 * - URL searchParams as single source of truth for date
 * - WebSocket for real-time updates
 * - Native scroll restoration via React Router
 */
const DailyAppointments = () => {
    // 1. Get initial data from loader
    const loaderData = useLoaderData();

    // 2. Get/set URL search params (source of truth for date)
    const [searchParams, setSearchParams] = useSearchParams();

    // 3. Helper to get today's date
    const getTodayDate = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 4. Initialize date from URL (loader guarantees URL has date)
    const [selectedDate, setSelectedDate] = useState(
        loaderData.loadedDate || searchParams.get('date') || getTodayDate()
    );

    const [mobileView, setMobileView] = useState('all');
    const [showFlash, setShowFlash] = useState(false);

    // 5. Pass loader data to hook
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
    } = useAppointments(loaderData);

    // 6. WebSocket integration (UNCHANGED - preserves existing scroll behavior)
    const { connectionStatus } = useWebSocketSync(selectedDate, (data) => {
        console.log('📡 [DailyAppointments] WebSocket update received - reloading appointments');
        loadAppointments(selectedDate);
        flashUpdateIndicator();
    });

    // 7. Sync URL when date changes (component-driven updates)
    useEffect(() => {
        // Only update if date is different from URL
        const urlDate = searchParams.get('date');
        if (selectedDate && selectedDate !== urlDate) {
            setSearchParams({ date: selectedDate }, { replace: true });
        }
    }, [selectedDate, searchParams, setSearchParams]);

    // 8. Load appointments when date changes (for user-initiated date changes)
    useEffect(() => {
        // Skip if this is loader data (already loaded)
        if (loaderData.loadedDate === selectedDate) {
            console.log('📦 [DailyAppointments] Using loader data, skip fetch');
            return;
        }

        console.log('📅 [DailyAppointments] Date changed, fetching new data');
        loadAppointments(selectedDate);
    }, [selectedDate]); // Only depend on selectedDate

    // 9. Handle WebSocket reconnection (UNCHANGED)
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

    // 10. Flash update indicator (UNCHANGED)
    const flashUpdateIndicator = () => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    };

    // 11. Handle date change (updates state + URL)
    const handleDateChange = (newDate) => {
        setSelectedDate(newDate);
        // URL sync happens in useEffect above
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
                absent={stats.absent}
                waiting={stats.waiting}
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
