import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoaderData, useSearchParams } from 'react-router-dom';
import AppointmentsHeader, { type DoctorFilter } from './AppointmentsHeader';
import MobileViewToggle, { type ViewType } from './MobileViewToggle';
import AppointmentsList from './AppointmentsList';
import type { DailyAppointmentRow, DailyAppointmentStats } from '@shared/contracts/appointment.contract';
import styles from './DailyAppointments.module.css';

import { useAppointments } from '../../../hooks/useAppointments';
import { useAppointmentsSync } from '../../../hooks/useAppointmentsSync';
import { useAppointmentDoctors } from '../../../hooks/useAppointmentDoctors';
import { toLocalDateString } from '../../../utils/calendarDate';
import type { dailyAppointmentsLoader } from '../../../router/loaders';

// Parse the URL `?dr=` param into a DoctorFilter (defaults to 'all').
const parseDrParam = (raw: string | null): DoctorFilter => {
    if (raw) {
        const n = Number(raw);
        if (Number.isInteger(n)) return n;
    }
    return 'all';
};

/**
 * DailyAppointments Component
 * Main application for daily appointments management
 *
 * HYBRID APPROACH:
 * - Loader fetches the day into the query cache (eliminates loading flash)
 * - URL searchParams as single source of truth for date
 * - SSE for real-time updates
 * - Native scroll restoration via React Router
 */
const DailyAppointments = () => {
    const { t } = useTranslation('appointments');

    // 1. The date the loader fetched into the query cache
    const loaderData = useLoaderData<typeof dailyAppointmentsLoader>();

    // 2. Get/set URL search params (source of truth for date)
    const [searchParams, setSearchParams] = useSearchParams();

    const getTodayDate = (): string => toLocalDateString(new Date());

    // 3. Initialize date from URL (the loader resolved a missing one to today)
    const [selectedDate, setSelectedDate] = useState<string>(
        loaderData.loadedDate || searchParams.get('date') || getTodayDate()
    );

    // 4. React Query owns the read, keyed by selectedDate; the loader already
    // put the loaded date in the cache (no first-paint flash).
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
    } = useAppointments(selectedDate);

    // Before anyone arrives the checked-in list is an empty screen on mobile —
    // land on whichever list actually has content.
    const [mobileView, setMobileView] = useState<ViewType>(() =>
        checkedInAppointments.length > 0 ? 'checked-in' : 'all'
    );
    const [showFlash, setShowFlash] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    // Doctor filter (URL is the source of truth for the initial value).
    const [selectedDrId, setSelectedDrId] = useState<DoctorFilter>(() =>
        parseDrParam(searchParams.get('dr'))
    );

    // Appointment-eligible doctors (shared with the calendar) — drives the header
    // dropdown plus the drID → name/colour lookups for the per-card doctor icon.
    // `byId` carries the calendar colour (neutral doctors intentionally omitted).
    const { legend: doctors, byId: doctorColors } = useAppointmentDoctors();
    const doctorNames = useMemo(
        () => new Map(doctors.map((d) => [d.id, d.name])),
        [doctors]
    );
    // The per-card doctor icon is only useful when viewing all doctors; once the
    // list is filtered to one doctor it's redundant noise on every card.
    const showDoctorName = selectedDrId === 'all';

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

    // The four workflow actions. Failures are reported by the hook (a toast), so
    // there is nothing to catch here.
    const handleCheckIn = (appointmentId: number): void => {
        void checkInPatient(appointmentId, selectedDate);
    };
    const handleMarkSeated = (appointmentId: number): void => {
        void markSeated(appointmentId, selectedDate);
    };
    const handleMarkDismissed = (appointmentId: number): void => {
        void markDismissed(appointmentId, selectedDate);
    };
    const handleUndoState = (appointmentId: number, stateToUndo: string): void => {
        void undoState(appointmentId, stateToUndo, selectedDate);
    };

    // A day that hasn't come yet: the server refuses check-in / seat / dismiss
    // there (FE-F11-4), so the board doesn't offer them. Undo stays available.
    const isFutureDay = selectedDate > getTodayDate();

    // Doctor + patient-name predicates, applied together to each list.
    const matchesDoctor = useCallback(
        (apt: DailyAppointmentRow): boolean => {
            if (selectedDrId === 'all') return true;
            return apt.dr_id === selectedDrId;
        },
        [selectedDrId]
    );

    const matchesSearch = useCallback(
        (apt: DailyAppointmentRow): boolean =>
            !searchTerm || !!apt.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()),
        [searchTerm]
    );

    const filteredAllAppointments = useMemo(
        () => allAppointments.filter((a) => matchesDoctor(a) && matchesSearch(a)),
        [allAppointments, matchesDoctor, matchesSearch]
    );

    const filteredCheckedInAppointments = useMemo(
        () => checkedInAppointments.filter((a) => matchesDoctor(a) && matchesSearch(a)),
        [checkedInAppointments, matchesDoctor, matchesSearch]
    );

    // Stats reflect the active filters (doctor + search). Derived from the two
    // filtered lists, so they equal the server's whole-day stats when unfiltered
    // (checkedIn = present IS NOT NULL; waiting = checked-in but not seated/dismissed).
    const stats = useMemo<DailyAppointmentStats>(() => {
        const checkedIn = filteredCheckedInAppointments.length;
        const absent = filteredAllAppointments.length;
        return {
            total: checkedIn + absent,
            checkedIn,
            absent,
            waiting: filteredCheckedInAppointments.filter((a) => !a.seated_time && !a.dismissed_time).length,
        };
    }, [filteredAllAppointments, filteredCheckedInAppointments]);

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
                connectionStatus={connectionStatus}
                freshness={dataFreshness}
                isViewingToday={selectedDate === getTodayDate()}
                showFlash={showFlash}
                stats={stats}
            />

            {/* A failed READ keeps the header (so another date is one click away)
                and offers a retry, instead of replacing the whole screen. */}
            {error && (
                <div className={styles.errorMessage} role="alert">
                    <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                    <span>{error}</span>
                    <button type="button" className={styles.retryButton} onClick={() => void loadAppointments(selectedDate)}>
                        {t('errors.retry')}
                    </button>
                </div>
            )}

            {!error && (<>
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
                    title={t('lists.allTitle')}
                    appointments={filteredAllAppointments}
                    showStatus={false}
                    loading={loading}
                    doctorNames={doctorNames}
                    doctorColors={doctorColors}
                    showDoctorName={showDoctorName}
                    onCheckIn={isFutureDay ? undefined : handleCheckIn}
                    emptyMessage={searchTerm ? t('lists.noMatching') : t('lists.noAppointments')}
                    className={mobileView === 'all' ? 'active-view' : ''}
                />

                <AppointmentsList
                    title={t('lists.checkedInTitle')}
                    appointments={filteredCheckedInAppointments}
                    showStatus={true}
                    loading={loading}
                    doctorNames={doctorNames}
                    doctorColors={doctorColors}
                    showDoctorName={showDoctorName}
                    onMarkSeated={isFutureDay ? undefined : handleMarkSeated}
                    onMarkDismissed={isFutureDay ? undefined : handleMarkDismissed}
                    onUndoState={handleUndoState}
                    emptyMessage={searchTerm ? t('lists.noMatching') : t('lists.noCheckedIn')}
                    className={mobileView === 'checked-in' ? 'active-view' : ''}
                />
            </div>
            </>)}
        </div>
    );
};

export default DailyAppointments;
