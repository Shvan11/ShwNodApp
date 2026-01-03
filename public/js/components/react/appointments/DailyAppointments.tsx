import { useState, useEffect, useCallback } from 'react';
import { useLoaderData, useSearchParams } from 'react-router-dom';
import AppointmentsHeader from './AppointmentsHeader';
import StatsCards from './StatsCards';
import MobileViewToggle, { type ViewType } from './MobileViewToggle';
import AppointmentsList from './AppointmentsList';
import type { DailyAppointment } from './AppointmentCard';
import type { ConnectionStatusType } from './ConnectionStatus';
import styles from './DailyAppointments.module.css';

import { useAppointments } from '../../../hooks/useAppointments';
import { useWebSocketSync } from '../../../hooks/useWebSocketSync';

interface LoaderData {
    loadedDate?: string;
    allAppointments?: DailyAppointment[];
    checkedInAppointments?: DailyAppointment[];
    [key: string]: unknown; // Allow additional properties from loader
}

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
    const loaderData = useLoaderData() as LoaderData;

    // 2. Get/set URL search params (source of truth for date)
    const [searchParams, setSearchParams] = useSearchParams();

    // 3. Helper to get today's date
    const getTodayDate = (): string => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 4. Initialize date from URL (loader guarantees URL has date)
    const [selectedDate, setSelectedDate] = useState<string>(
        loaderData.loadedDate || searchParams.get('date') || getTodayDate()
    );

    const [mobileView, setMobileView] = useState<ViewType>('checked-in');
    const [showFlash, setShowFlash] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');

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
    } = useAppointments(loaderData as unknown as Parameters<typeof useAppointments>[0]);

    // 6. Flash update indicator
    const flashUpdateIndicator = useCallback((): void => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    }, []);

    // 7. WebSocket update handler - stable reference to prevent re-subscription churn
    const handleWebSocketUpdate = useCallback(() => {
        console.log('📡 [DailyAppointments] WebSocket update received - reloading appointments');
        loadAppointments(selectedDate);
        flashUpdateIndicator();
    }, [selectedDate, loadAppointments, flashUpdateIndicator]);

    // 8. WebSocket integration
    const { connectionStatus } = useWebSocketSync(selectedDate, handleWebSocketUpdate);

    // 9. Sync URL when date changes (component-driven updates)
    useEffect(() => {
        // Only update if date is different from URL
        const urlDate = searchParams.get('date');
        if (selectedDate && selectedDate !== urlDate) {
            setSearchParams({ date: selectedDate }, { replace: true });
        }

        // Save current date to sessionStorage for return visits
        if (selectedDate) {
            sessionStorage.setItem('lastAppointmentDate', selectedDate);
        }
    }, [selectedDate, searchParams, setSearchParams]);

    // 10. Load appointments when date changes (for user-initiated date changes)
    useEffect(() => {
        // Skip if this is loader data (already loaded)
        if (loaderData.loadedDate === selectedDate) {
            console.log('📦 [DailyAppointments] Using loader data, skip fetch');
            return;
        }

        console.log('📅 [DailyAppointments] Date changed, fetching new data');
        loadAppointments(selectedDate);
    }, [selectedDate]); // Only depend on selectedDate

    // 11. Handle WebSocket reconnection
    useEffect(() => {
        const handleReconnect = (): void => {
            console.log('[DailyAppointments] 🔄 Connection restored - refreshing appointments');
            loadAppointments(selectedDate);
        };

        window.addEventListener('websocket_reconnected', handleReconnect);

        return () => {
            window.removeEventListener('websocket_reconnected', handleReconnect);
        };
    }, [selectedDate, loadAppointments]);

    // 12. Handle date change (updates state + URL)
    const handleDateChange = (newDate: string): void => {
        setSelectedDate(newDate);
        // URL sync happens in useEffect above
    };

    // 13. Handle refresh - reload today's appointments
    const handleRefresh = (): void => {
        const today = getTodayDate();
        setSelectedDate(today);
        setSearchTerm(''); // Clear search on refresh
        loadAppointments(today);
    };

    // Handle check-in
    const handleCheckIn = async (appointmentId: number): Promise<void> => {
        try {
            await checkInPatient(appointmentId, selectedDate);
        } catch (err) {
            console.error('Check-in failed:', err);
        }
    };

    // Handle mark seated
    const handleMarkSeated = async (appointmentId: number): Promise<void> => {
        try {
            await markSeated(appointmentId, selectedDate);
        } catch (err) {
            console.error('Seat failed:', err);
        }
    };

    // Handle mark dismissed
    const handleMarkDismissed = async (appointmentId: number): Promise<void> => {
        try {
            await markDismissed(appointmentId, selectedDate);
        } catch (err) {
            console.error('Dismiss failed:', err);
        }
    };

    // Handle undo state
    const handleUndoState = async (appointmentId: number, stateToUndo: string): Promise<void> => {
        try {
            await undoState(appointmentId, stateToUndo, selectedDate);
        } catch (err) {
            console.error('Undo failed:', err);
        }
    };

    // Get statistics
    const stats = getStats();

    // Filter appointments by search term
    const filteredAllAppointments = searchTerm
        ? (allAppointments as DailyAppointment[]).filter((apt) =>
            apt.PatientName?.toLowerCase().includes(searchTerm.toLowerCase())
        )
        : (allAppointments as DailyAppointment[]);

    const filteredCheckedInAppointments = searchTerm
        ? (checkedInAppointments as DailyAppointment[]).filter((apt) =>
            apt.PatientName?.toLowerCase().includes(searchTerm.toLowerCase())
        )
        : (checkedInAppointments as DailyAppointment[]);

    // Error state
    if (error) {
        return (
            <div className={styles.view}>
                <div className={styles.errorMessage}>
                    <i className="fas fa-exclamation-circle"></i>
                    Failed to load appointments: {error}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.view}>
            {/* Header with date picker, refresh button, and search */}
            <AppointmentsHeader
                selectedDate={selectedDate}
                onDateChange={handleDateChange}
                onRefresh={handleRefresh}
                isRefreshing={loading}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                connectionStatus={connectionStatus as ConnectionStatusType}
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
            <div className={styles.container}>
                <AppointmentsList
                    title="All Appointments"
                    appointments={filteredAllAppointments}
                    showStatus={false}
                    loading={loading}
                    onCheckIn={handleCheckIn}
                    emptyMessage={searchTerm ? "No matching patients found." : "No appointments scheduled for this date."}
                    className={mobileView === 'all' ? 'active-view' : ''}
                />

                <AppointmentsList
                    title="Checked-In Patients"
                    appointments={filteredCheckedInAppointments}
                    showStatus={true}
                    loading={loading}
                    onMarkSeated={handleMarkSeated}
                    onMarkDismissed={handleMarkDismissed}
                    onUndoState={handleUndoState}
                    emptyMessage={searchTerm ? "No matching patients found." : "No patients checked in yet."}
                    className={mobileView === 'checked-in' ? 'active-view' : ''}
                />
            </div>

            {/* Footer */}
            <footer className={styles.footer}>
                <p>&copy; 2025 Shwan Orthodontics. All rights reserved.</p>
            </footer>

        </div>
    );
};

export default DailyAppointments;
