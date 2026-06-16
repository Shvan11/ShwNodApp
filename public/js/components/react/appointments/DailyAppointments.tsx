import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLoaderData, useSearchParams } from 'react-router-dom';
import AppointmentsHeader, { type DoctorFilter } from './AppointmentsHeader';
import MobileViewToggle, { type ViewType } from './MobileViewToggle';
import AppointmentsList from './AppointmentsList';
import type { DailyAppointment } from './AppointmentCard';
import type { ConnectionStatusType, FreshnessType } from './ConnectionStatus';
import styles from './DailyAppointments.module.css';

import { useAppointments } from '../../../hooks/useAppointments';
import type { Appointment, AppointmentStats } from '../../../hooks/useAppointments';
import { useAppointmentsSync } from '../../../hooks/useAppointmentsSync';
import { useAppointmentDoctors } from '../../../hooks/useAppointmentDoctors';

// Parse the URL `?dr=` param into a DoctorFilter (defaults to 'all').
const parseDrParam = (raw: string | null): DoctorFilter => {
    if (raw === 'unassigned') return 'unassigned';
    if (raw) {
        const n = Number(raw);
        if (Number.isInteger(n)) return n;
    }
    return 'all';
};

interface LoaderData {
    loadedDate?: string;
    allAppointments?: DailyAppointment[];
    checkedInAppointments?: DailyAppointment[];
    stats?: AppointmentStats;
    error?: string;
    _loaderTimestamp?: number;
    [key: string]: unknown; // Allow additional properties from loader
}

/**
 * DailyAppointments Component
 * Main application for daily appointments management
 *
 * HYBRID APPROACH:
 * - Loader pre-fetches initial data (eliminates loading flash)
 * - URL searchParams as single source of truth for date
 * - SSE for real-time updates
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

    // Before anyone arrives the checked-in list is an empty screen on mobile —
    // land on whichever list actually has content.
    const [mobileView, setMobileView] = useState<ViewType>(() =>
        (loaderData.checkedInAppointments?.length ?? 0) > 0 ? 'checked-in' : 'all'
    );
    const [showFlash, setShowFlash] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    // Doctor filter (URL is the source of truth for the initial value).
    const [selectedDrId, setSelectedDrId] = useState<DoctorFilter>(() =>
        parseDrParam(searchParams.get('dr'))
    );

    // Appointment-eligible doctors (shared with the calendar) — drives both the
    // header dropdown and the drID → name lookup for the per-card doctor label.
    const { legend: doctors } = useAppointmentDoctors();
    const doctorNames = useMemo(
        () => new Map(doctors.map((d) => [d.id, d.name])),
        [doctors]
    );
    // The per-card doctor name is only useful when viewing all doctors; once the
    // list is filtered to one doctor it's redundant noise on every card.
    const showDoctorName = selectedDrId === 'all';

    // 5. React Query owns the read, keyed by selectedDate; seed its cache with
    // the loader payload for the loaded date (no first-paint flash). The loader
    // types appointments as DailyAppointment[] (UI shape); the hook wants
    // Appointment[] (data shape) — they differ only nominally, so assert per-array.
    const {
        allAppointments,
        checkedInAppointments,
        loading,
        error,
        loadAppointments,
        checkInPatient,
        markSeated,
        markDismissed,
        undoState
    } = useAppointments(selectedDate, {
        loadedDate: loaderData.loadedDate,
        allAppointments: loaderData.allAppointments as Appointment[] | undefined,
        checkedInAppointments: loaderData.checkedInAppointments as Appointment[] | undefined,
        stats: loaderData.stats,
        error: loaderData.error,
        _loaderTimestamp: loaderData._loaderTimestamp,
    });

    // 6. Flash update indicator
    const flashUpdateIndicator = useCallback((): void => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    }, []);

    // 7. SSE update handler — return success so the hook can detect
    // recovery-fetch failure and trigger markStale + retry.
    const handleAppointmentsUpdate = useCallback(async (): Promise<boolean> => {
        const ok = await loadAppointments(selectedDate);
        if (ok) flashUpdateIndicator();
        return ok;
    }, [selectedDate, loadAppointments, flashUpdateIndicator]);

    // 8. SSE realtime sync integration
    const { connectionStatus, dataFreshness } = useAppointmentsSync(selectedDate, handleAppointmentsUpdate);

    // 9. Sync URL when date or doctor filter changes (component-driven updates).
    // Both params are written together so neither clobbers the other; `dr` is
    // omitted when viewing all doctors.
    useEffect(() => {
        const urlDate = searchParams.get('date');
        const urlDr = searchParams.get('dr');
        const desiredDr = selectedDrId === 'all' ? null : String(selectedDrId);

        if ((selectedDate && selectedDate !== urlDate) || desiredDr !== urlDr) {
            const next: Record<string, string> = {};
            if (selectedDate) next.date = selectedDate;
            if (desiredDr) next.dr = desiredDr;
            setSearchParams(next, { replace: true });
        }

        // Save current date to sessionStorage for return visits
        if (selectedDate) {
            sessionStorage.setItem('lastAppointmentDate', selectedDate);
        }
    }, [selectedDate, selectedDrId, searchParams, setSearchParams]);

    // 10. Date-change fetching is automatic: useAppointments keys React Query on
    // selectedDate, so changing the date fetches the new day (from cache if warm)
    // with no manual effect — the loader seeds only the initial date.

    // 11. Reconnect-driven refetch is handled inside useAppointmentsSync via the
    // debounced recovery trigger (sseAppointments 'reconnected' + window 'online' +
    // visibilitychange). No additional listener needed here.

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
        setSelectedDrId('all'); // Clear doctor filter on refresh
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

    // Doctor + patient-name predicates, applied together to each list.
    const matchesDoctor = useCallback(
        (apt: DailyAppointment): boolean => {
            if (selectedDrId === 'all') return true;
            if (selectedDrId === 'unassigned') return apt.dr_id == null;
            return apt.dr_id === selectedDrId;
        },
        [selectedDrId]
    );

    const matchesSearch = useCallback(
        (apt: DailyAppointment): boolean =>
            !searchTerm || !!apt.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()),
        [searchTerm]
    );

    const filteredAllAppointments = useMemo(
        () => (allAppointments as DailyAppointment[]).filter((a) => matchesDoctor(a) && matchesSearch(a)),
        [allAppointments, matchesDoctor, matchesSearch]
    );

    const filteredCheckedInAppointments = useMemo(
        () => (checkedInAppointments as DailyAppointment[]).filter((a) => matchesDoctor(a) && matchesSearch(a)),
        [checkedInAppointments, matchesDoctor, matchesSearch]
    );

    // Stats reflect the active filters (doctor + search). Derived from the two
    // filtered lists, so they equal the server's whole-day stats when unfiltered
    // (checkedIn = present IS NOT NULL; waiting = checked-in but not seated/dismissed).
    const stats = useMemo<AppointmentStats>(() => {
        const checkedIn = filteredCheckedInAppointments.length;
        const absent = filteredAllAppointments.length;
        return {
            total: checkedIn + absent,
            checkedIn,
            absent,
            waiting: filteredCheckedInAppointments.filter((a) => !a.seated_time && !a.dismissed_time).length,
        };
    }, [filteredAllAppointments, filteredCheckedInAppointments]);

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
                doctors={doctors}
                selectedDrId={selectedDrId}
                onDoctorChange={setSelectedDrId}
                connectionStatus={connectionStatus as ConnectionStatusType}
                freshness={dataFreshness as FreshnessType}
                isViewingToday={selectedDate === getTodayDate()}
                showFlash={showFlash}
                stats={stats}
            />

            {/* Mobile view toggle */}
            <MobileViewToggle
                activeView={mobileView}
                onViewChange={setMobileView}
                allCount={filteredAllAppointments.length}
                checkedInCount={filteredCheckedInAppointments.length}
            />

            {/* Appointments lists */}
            <div className={styles.container}>
                <AppointmentsList
                    title="All Appointments"
                    appointments={filteredAllAppointments}
                    showStatus={false}
                    loading={loading}
                    doctorNames={doctorNames}
                    showDoctorName={showDoctorName}
                    onCheckIn={handleCheckIn}
                    emptyMessage={searchTerm ? "No matching patients found." : "No appointments scheduled for this date."}
                    className={mobileView === 'all' ? 'active-view' : ''}
                />

                <AppointmentsList
                    title="Checked-In Patients"
                    appointments={filteredCheckedInAppointments}
                    showStatus={true}
                    loading={loading}
                    doctorNames={doctorNames}
                    showDoctorName={showDoctorName}
                    onMarkSeated={handleMarkSeated}
                    onMarkDismissed={handleMarkDismissed}
                    onUndoState={handleUndoState}
                    emptyMessage={searchTerm ? "No matching patients found." : "No patients checked in yet."}
                    className={mobileView === 'checked-in' ? 'active-view' : ''}
                />
            </div>

        </div>
    );
};

export default DailyAppointments;
