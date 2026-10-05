import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import CalendarGrid, { type DropTarget, type MoreMenu } from './CalendarGrid';
import CalendarHeader from './CalendarHeader';
import MonthlyCalendarGrid from './MonthlyCalendarGrid';
import CalendarContextMenu from './CalendarContextMenu';
import CalendarDayContextMenu from './CalendarDayContextMenu';
import HolidayQuickModal from './HolidayQuickModal';
import CalendarLegend from './CalendarLegend';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { useAppointmentDoctors } from '../../hooks/useAppointmentDoctors';
import type { MenuAnchor } from '../../hooks/useFloatingMenu';
import {
    parseLocalDate,
    toLocalDateString,
    getWeekStartSaturday,
    addWorkingDays
} from '../../utils/calendarDate';
import { formatLocaleDate } from '../../utils/formatters';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import i18next from 'i18next';
import { sendAppointmentConfirmation } from './bookingError';
import { calendarRangeQuery, calendarMonthQuery } from '@/query/queries';
import * as holiday from '@shared/contracts/holiday.contract';
import type {
    ViewMode,
    CalendarAppointment,
    CalendarDay,
    CalendarData,
    CalendarStats,
    ExistingHoliday,
    AppointmentWarning,
    SaveHolidayData
} from './calendar.types';

/* ── Density-zoom model ─────────────────────────────────────────────────────
   A single day-count N drives the Week grid. The grid already lays out
   `repeat(N, 1fr)` columns from the days array, so zoom = relayout (more/narrower
   columns) — no transform/CSS-zoom, so text stays crisp and sticky/drag keep
   working. Row height couples to N as ROW_REF/N (ROW_REF = 112 × 6), which keeps
   the default-week cell aspect ratio at every N: for board width W, colW/rowH =
   ((W−T)/N)/(ROW_REF/N) = (W−T)/ROW_REF, independent of N. Zoom out → N↑ → smaller
   cells, more days, fills the screen, fits all rows; zoom in → N↓ → fewer/bigger
   days down to one. */
const N_MIN = 1;
const N_MAX = 30;
const N_DEFAULT = 6;
const ROW_REF = 672; // 112 × 6 — the default-week reference (px)
const ROW_MIN = 44;
const ROW_MAX = 132;
const MIN_COL_W = 90; // px — Fit keeps day columns at least this wide
const N_STORAGE_KEY = 'cal-day-count';
const FETCH_DEBOUNCE_MS = 250;
const MOBILE_MAX_WIDTH = 768;

const clampN = (n: number): number => Math.min(N_MAX, Math.max(N_MIN, Math.round(n)));

const rowHForN = (n: number): number =>
    Math.min(ROW_MAX, Math.max(ROW_MIN, Math.round(ROW_REF / n)));

// Font scales PROPORTIONALLY with row height (no floor) so text shrinks together
// with the rows instead of overflowing/clipping on heavy zoom-out. The natural
// minimum (~0.39) comes from the rowH clamp [44,132]; the card padding/gaps scale
// by the same factor in CSS so the whole card stays proportional.
const fontScaleForRowH = (h: number): number =>
    Math.min(1.12, Math.round((h / 112) * 100) / 100);

const readStoredDayCount = (): number => {
    try {
        const raw = localStorage.getItem(N_STORAGE_KEY);
        if (!raw) return N_DEFAULT;
        const n = Number(raw);
        return Number.isFinite(n) ? clampN(n) : N_DEFAULT;
    } catch {
        return N_DEFAULT;
    }
};

const isMobileWidth = (): boolean => typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;

const shortDate = (d: string): string =>
    formatLocaleDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

/** First of the month `delta` months from `d`. Always the 1st, so it never overflows. */
const monthStep = (d: Date, delta: number): Date => new Date(d.getFullYear(), d.getMonth() + delta, 1);

/** Appointments on a day: the month view lists them, the week grid buckets them per slot. */
const countDayAppointments = (day: CalendarDay): number => {
    const appts = day.appointments;
    if (!appts) return 0;
    if (Array.isArray(appts)) return appts.length;
    return Object.values(appts).reduce(
        (sum, slot) => sum + (Array.isArray(slot) ? slot.length : (slot.appointments?.length ?? 0)),
        0
    );
};

interface ContextMenuState {
    position: MenuAnchor;
    appointment: CalendarAppointment;
}

interface DayMenuState {
    position: MenuAnchor;
    day: CalendarDay;
}

interface HolidayModalState {
    date: string;
    existingHoliday: ExistingHoliday | null;
    appointmentWarning: AppointmentWarning | null;
    /** The appointments-on-date check failed, so the modal cannot say whether any exist. */
    appointmentCheckFailed: boolean;
}

/**
 * AppointmentCalendar — the `/calendar` screen: the density-zoom week/day grid
 * (built from the appointments, see `CalendarViewService`) and the month view,
 * with drag-to-reschedule and holiday management.
 */
const AppointmentCalendar = () => {
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const user = useAuthUser();
    // Holiday writes go through `/api/admin/lookups`, which is admin + front desk.
    const canManageHolidays = roleCaps(user?.role as UserRole | undefined).manageLookups;
    const { byId: doctorColors, legend: doctorLegend } = useAppointmentDoctors();

    // State management. `currentDate` is the month view's month (always its 1st).
    const [currentDate, setCurrentDate] = useState<Date>(() => monthStep(new Date(), 0));
    const [viewMode, setViewMode] = useState<ViewMode>('week');
    const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
    const [isMobile, setIsMobile] = useState(isMobileWidth);

    // Density-zoom: the grid window is `dayCount` working days forward from
    // `anchorDate` (the current week's Saturday at init / on Today).
    const [anchorDate, setAnchorDate] = useState<string>(() =>
        toLocalDateString(getWeekStartSaturday(new Date()))
    );
    const [dayCount, setDayCount] = useState<number>(readStoredDayCount);
    const boardRef = useRef<HTMLDivElement>(null);

    // Drag-to-reschedule and "+N more" popover state
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const [moreMenu, setMoreMenu] = useState<MoreMenu | null>(null);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [dayMenu, setDayMenu] = useState<DayMenuState | null>(null);
    const [holidayModal, setHolidayModal] = useState<HolidayModalState | null>(null);
    const deletingRef = useRef(false);

    // Phones get a single-day grid. That is derived, not written into `dayCount`:
    // writing it used to persist `cal-day-count = 1`, so narrowing the window once
    // lost the desktop zoom for good (audit FE-F10-20).
    useEffect(() => {
        const onResize = () => setIsMobile(isMobileWidth());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const effectiveDayCount = isMobile ? 1 : dayCount;
    const effectiveView: ViewMode = isMobile && viewMode !== 'month' ? 'day' : viewMode;

    // Cell metrics derived from N — applied as CSS vars on the root.
    const rowH = rowHForN(effectiveDayCount);
    const fontScale = fontScaleForRowH(rowH);

    // The window's last working day (inclusive).
    const gridEnd = useMemo(
        () => addWorkingDays(anchorDate, effectiveDayCount - 1),
        [anchorDate, effectiveDayCount]
    );

    // Toolbar title — main line (month + year) + sub line (range / single day).
    const titleMain = formatLocaleDate(
        effectiveView === 'month' ? currentDate : anchorDate,
        { month: 'long', year: 'numeric' }
    );

    let titleSub = '';
    if (effectiveView !== 'month') {
        titleSub = effectiveDayCount === 1
            ? formatLocaleDate(anchorDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : `${shortDate(anchorDate)} – ${shortDate(gridEnd)} · ${effectiveDayCount} days`;
    }

    // ── Data fetching (React Query) ─────────────────────────────────────────
    // Grid (day/week/zoom): one round-trip to /range returns days + timeSlots +
    // stats. The grid window's end depends on the day count; debounce it into the
    // query key so dragging the zoom slider through several N values issues one
    // request (the live count still drives the layout/labels immediately). Both
    // reads keep the previous data on screen while the next loads (FE-F10-4).
    const isGrid = effectiveView !== 'month';
    const [debouncedDayCount, setDebouncedDayCount] = useState(effectiveDayCount);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedDayCount(effectiveDayCount), FETCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [effectiveDayCount]);
    const queryEnd = useMemo(
        () => addWorkingDays(anchorDate, debouncedDayCount - 1),
        [anchorDate, debouncedDayCount]
    );
    const rangeQ = useQuery({
        ...calendarRangeQuery(anchorDate, queryEnd, selectedDoctorId),
        enabled: isGrid,
    });
    const monthQ = useQuery({
        ...calendarMonthQuery(toLocalDateString(currentDate), selectedDoctorId),
        enabled: !isGrid,
    });

    const calendarData: CalendarData | null = useMemo(
        () =>
            isGrid
                ? rangeQ.data
                    ? { days: rangeQ.data.days, timeSlots: rangeQ.data.timeSlots }
                    : null
                : monthQ.data
                  ? { days: monthQ.data.days, timeSlots: [] }
                  : null,
        [isGrid, rangeQ.data, monthQ.data]
    );
    // Each view's strip covers what that view shows, and follows the doctor
    // filter: the month used to show one week's numbers (FE-F10-6).
    const calendarStats: CalendarStats | null = isGrid
        ? (rangeQ.data?.stats ?? null)
        : (monthQ.data?.stats ?? null);
    const fetching = isGrid ? rangeQ.isFetching : monthQ.isFetching;
    const activeQuery = isGrid ? rangeQ : monthQ;
    const error = activeQuery.isError ? httpErrorMessage(activeQuery.error, 'Unknown error') : null;

    // Refetch the active view (used after reschedule/delete/holiday mutations) —
    // invalidating the whole calendar prefix covers grid + month + the picker.
    const refetch = useCallback(
        () => queryClient.invalidateQueries({ queryKey: qk.calendar.all() }),
        [queryClient]
    );

    // An appointment moved or deleted here also changes the patient's own list
    // and the daily boards (audit FE-F10-10).
    const refreshAppointmentReads = useCallback(
        (personID: number | null | undefined) => {
            void queryClient.invalidateQueries({ queryKey: qk.appointments.all() });
            if (personID) void queryClient.invalidateQueries({ queryKey: qk.patient.all(personID) });
        },
        [queryClient]
    );

    // A holiday written here is also a row in Settings → Holidays (FE-F10-10).
    const refreshHolidayReads = useCallback(async () => {
        void queryClient.invalidateQueries({ queryKey: qk.adminLookups.table('tblHolidays') });
        await refetch();
    }, [queryClient, refetch]);

    // ── Navigation ──────────────────────────────────────────────────────────
    const navigate = useCallback(
        (direction: 'next' | 'prev') => {
            if (effectiveView === 'month') {
                // From the 1st, so Jan 31 → Next is February, not March (FE-F10-5).
                setCurrentDate(prev => monthStep(prev, direction === 'next' ? 1 : -1));
                return;
            }
            // Page the anchor by exactly the visible span (gap-free, forward-extend).
            setAnchorDate(prev =>
                addWorkingDays(prev, direction === 'next' ? effectiveDayCount : -effectiveDayCount)
            );
        },
        [effectiveView, effectiveDayCount]
    );

    const goToToday = useCallback(() => {
        const today = new Date();
        setCurrentDate(monthStep(today, 0));
        setAnchorDate(toLocalDateString(getWeekStartSaturday(today)));
    }, []);

    // Set the column count and keep the segmented control in sync (1 → Day).
    const applyDayCount = useCallback((next: number) => {
        const n = clampN(next);
        setDayCount(n);
        setViewMode(n === 1 ? 'day' : 'week');
    }, []);

    // Zoom: in = fewer/bigger days, out = more/smaller days.
    const handleZoomIn = useCallback(() => applyDayCount(dayCount - 1), [applyDayCount, dayCount]);
    const handleZoomOut = useCallback(() => applyDayCount(dayCount + 1), [applyDayCount, dayCount]);
    const handleZoomSlider = useCallback((n: number) => applyDayCount(n), [applyDayCount]);

    // Fit: largest cells that still show every time row, columns kept readable.
    const handleZoomFit = useCallback(() => {
        const board = boardRef.current;
        const rowCount = calendarData?.timeSlots?.length ?? 0;
        if (!board || rowCount === 0) return;
        const headers = board.querySelector<HTMLElement>('.cal-day-headers');
        const headerH = headers?.getBoundingClientRect().height ?? 0;
        const availH = board.clientHeight - headerH - 4;
        const timeW =
            parseFloat(getComputedStyle(board).getPropertyValue('--cal-grid-time-w')) || 70;
        const availW = board.clientWidth - timeW;
        if (availH <= 0 || availW <= 0) return;
        const byHeight = Math.ceil((rowCount * ROW_REF) / availH);
        const byWidth = Math.floor(availW / MIN_COL_W);
        applyDayCount(Math.min(byHeight, byWidth));
    }, [applyDayCount, calendarData]);

    // ── View mode ───────────────────────────────────────────────────────────
    const handleViewModeChange = useCallback(
        (newViewMode: ViewMode) => {
            if (isMobile && newViewMode !== 'day') return;

            if (newViewMode === 'month') {
                // Open the month containing the current grid anchor.
                setCurrentDate(monthStep(parseLocalDate(anchorDate), 0));
                setViewMode('month');
                return;
            }

            // Leaving month → re-anchor the grid on the visible month.
            if (viewMode === 'month') {
                setAnchorDate(toLocalDateString(getWeekStartSaturday(currentDate)));
            }
            setViewMode(newViewMode);
            setDayCount(newViewMode === 'day' ? 1 : N_DEFAULT);
        },
        [isMobile, viewMode, currentDate, anchorDate]
    );

    const openDay = useCallback((day: CalendarDay) => {
        setAnchorDate(day.date);
        setDayCount(1);
        setViewMode('day');
    }, []);

    // ── Reschedule (drag) ───────────────────────────────────────────────────
    const handleReschedule = useCallback(
        async (
            appointmentID: number | string,
            newDate: string,
            newTime: string,
            appt: CalendarAppointment,
            fromDate: string
        ) => {
            const personID = appt.personID;
            if (!personID || !appt.drID || !appt.appDetail) {
                toast.error('Cannot reschedule: appointment is missing required details');
                return;
            }
            // The grid refuses the drop too; the server refuses it as PAST_SLOT (FE-F10-8).
            if (new Date(`${newDate}T${newTime}:00`) < new Date()) {
                toast.error('You cannot move an appointment into the past');
                return;
            }

            try {
                await putJSON(`/api/appointments/${appointmentID}`, {
                    person_id: personID,
                    dr_id: appt.drID,
                    app_detail: appt.appDetail,
                    app_date: `${newDate}T${newTime}:00`
                });
            } catch (error) {
                toast.error(httpErrorMessage(error, 'Failed to reschedule appointment'));
                return;
            }

            toast.success('Appointment rescheduled');
            refreshAppointmentReads(personID);
            void refetch();

            // A move to another DAY tells the patient, as the edit form does on a
            // date change; the drag used to move them silently (FE-F10-8).
            // The calendar isn't translated, so it reports in English whatever the
            // language — the same per-case messages as the booking forms (FE-F16-9).
            if (newDate !== fromDate) {
                sendAppointmentConfirmation(appointmentID, toast, i18next.getFixedT('en', 'appointments'));
            }
        },
        [refetch, refreshAppointmentReads, toast]
    );

    // Clicking a card opens its Edit/Delete menu.
    const handleAppointmentClick = useCallback((
        appt: CalendarAppointment,
        date: string,
        time: string,
        anchor: MenuAnchor
    ) => {
        // Block edits/deletes on past appointments.
        if (new Date(`${date}T${time}:00`) < new Date()) {
            toast.error('You cannot edit or delete past appointments');
            return;
        }
        setContextMenu({ position: anchor, appointment: appt });
    }, [toast]);

    const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

    // ── Delete ──────────────────────────────────────────────────────────────
    const handleDeleteRequest = useCallback(async (appointment: CalendarAppointment) => {
        if (!appointment.appointment_id || deletingRef.current) return;
        const who = appointment.patientName || 'this patient';
        const ok = await confirm(
            `Delete the appointment for ${who}${appointment.appDetail ? ` (${appointment.appDetail})` : ''}?`,
            { title: 'Delete appointment', danger: true, confirmText: 'Delete' }
        );
        if (!ok || deletingRef.current) return;

        // One DELETE per confirmation, however fast the second click (FE-F10-20).
        deletingRef.current = true;
        try {
            await deleteJSON(`/api/appointments/${appointment.appointment_id}`);
            toast.success('Appointment deleted');
            refreshAppointmentReads(appointment.personID);
            await refetch();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to delete appointment'));
        } finally {
            deletingRef.current = false;
        }
    }, [confirm, refetch, refreshAppointmentReads, toast]);

    // ── Day menu + holidays ─────────────────────────────────────────────────
    const handleDayMenu = useCallback((day: CalendarDay, anchor: MenuAnchor) => {
        setDayMenu({ position: anchor, day });
    }, []);
    const handleCloseDayMenu = useCallback(() => setDayMenu(null), []);

    const handleAddHoliday = useCallback(async (day: CalendarDay) => {
        // Check for existing appointments on this date. A failed check no longer
        // disappears silently: the modal says it could not check (FE-F10-14).
        try {
            const data = await fetchJSON<AppointmentWarning>(
                `/api/holidays/appointments-on-date?date=${day.date}`,
                { schema: holiday.appointmentsOnDate.response }
            );
            setHolidayModal({
                date: day.date,
                existingHoliday: null,
                appointmentWarning: data.count > 0 ? data : null,
                appointmentCheckFailed: false
            });
        } catch {
            setHolidayModal({
                date: day.date,
                existingHoliday: null,
                appointmentWarning: null,
                appointmentCheckFailed: true
            });
        }
    }, []);

    const handleEditHoliday = useCallback((day: CalendarDay) => {
        setHolidayModal({
            date: day.date,
            existingHoliday: {
                ID: day.holidayId ?? undefined,
                HolidayName: day.holidayName ?? undefined,
                Description: day.holidayDescription ?? undefined
            },
            appointmentWarning: null,
            appointmentCheckFailed: false
        });
    }, []);

    const handleRemoveHoliday = useCallback(async (day: CalendarDay) => {
        if (!day.holidayId) return;
        const ok = await confirm(
            `Remove ${day.holidayName || 'this holiday'}? Appointments can be booked on this date again.`,
            { title: 'Remove holiday', danger: true, confirmText: 'Remove holiday' }
        );
        if (!ok) return;
        try {
            await deleteJSON(`/api/admin/lookups/tblHolidays/${day.holidayId}`);
            toast.success('Holiday removed');
            await refreshHolidayReads();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to remove holiday'));
        }
    }, [confirm, refreshHolidayReads, toast]);

    const handleCloseHolidayModal = useCallback(() => setHolidayModal(null), []);

    const handleSaveHoliday = useCallback(async ({ date, holidayName, description, existingId }: SaveHolidayData) => {
        try {
            const isEdit = !!existingId;
            const body = {
                holiday_date: date,
                holiday_name: holidayName,
                description: description
            };

            if (isEdit) {
                await putJSON(`/api/admin/lookups/tblHolidays/${existingId}`, body);
            } else {
                await postJSON('/api/admin/lookups/tblHolidays', body);
            }

            toast.success(isEdit ? 'Holiday updated' : 'Holiday added');
            setHolidayModal(null);
            await refreshHolidayReads();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to save holiday'));
        }
    }, [refreshHolidayReads, toast]);

    // Persist the zoom (day count) per-browser — the user's choice only; the
    // phone's single day is derived above and never written here.
    useEffect(() => {
        try {
            localStorage.setItem(N_STORAGE_KEY, String(dayCount));
        } catch {
            // Ignore storage failures (private mode / quota).
        }
    }, [dayCount]);

    // The day menu has something to offer: day view (unless it is the day already
    // open) and/or the holiday actions.
    const dayMenuOpenDay = dayMenu && !(effectiveView === 'day' && dayMenu.day.date === anchorDate)
        ? openDay
        : undefined;
    const showDayMenu = !!dayMenu && (!!dayMenuOpenDay || canManageHolidays);

    // The toolbar stays on screen through loads and errors; only the body below
    // it changes (FE-F10-4).
    return (
        <div
            className="appointment-calendar"
            style={{ '--cal-row-h': `${rowH}px`, '--cal-font-scale': fontScale } as CSSProperties}
        >
            <CalendarHeader
                titleMain={titleMain}
                titleSub={titleSub}
                onPreviousWeek={() => navigate('prev')}
                onNextWeek={() => navigate('next')}
                onTodayClick={goToToday}
                viewMode={effectiveView}
                onViewModeChange={handleViewModeChange}
                calendarStats={calendarStats}
                fetching={fetching}
                selectedDoctorId={selectedDoctorId}
                onDoctorChange={setSelectedDoctorId}
                showZoom={effectiveView !== 'month' && !isMobile}
                dayCount={effectiveDayCount}
                minDayCount={N_MIN}
                maxDayCount={N_MAX}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomSlider={handleZoomSlider}
                onZoomFit={handleZoomFit}
            />

            {/* Doctor colour legend (week/day views only — month cells aren't tinted) */}
            {effectiveView !== 'month' && <CalendarLegend doctors={doctorLegend} />}

            {error ? (
                <div className="calendar-error" role="alert">
                    <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                    <h3>Calendar Loading Error</h3>
                    <p className="error-message">{error}</p>
                    <div className="calendar-error-actions">
                        <button className="btn btn-primary" onClick={() => void refetch()}>
                            <i className="fas fa-refresh" aria-hidden="true"></i> Retry
                        </button>
                        <button className="btn btn-secondary" onClick={goToToday}>
                            <i className="fas fa-calendar-day" aria-hidden="true"></i> Go to Today
                        </button>
                    </div>
                </div>
            ) : effectiveView === 'month' ? (
                <MonthlyCalendarGrid
                    calendarData={calendarData}
                    onOpenDay={openDay}
                    onDayMenu={canManageHolidays ? handleDayMenu : undefined}
                    currentDate={currentDate}
                />
            ) : (
                <CalendarGrid
                    calendarData={calendarData}
                    doctorColors={doctorColors}
                    hideEmptySlots={selectedDoctorId != null}
                    onAppointmentClick={handleAppointmentClick}
                    onDayMenu={handleDayMenu}
                    viewMode={effectiveView}
                    draggingId={draggingId}
                    setDraggingId={setDraggingId}
                    dropTarget={dropTarget}
                    setDropTarget={setDropTarget}
                    moreMenu={moreMenu}
                    setMoreMenu={setMoreMenu}
                    onReschedule={handleReschedule}
                    boardRef={boardRef}
                />
            )}

            {contextMenu && (
                <CalendarContextMenu
                    position={contextMenu.position}
                    appointment={contextMenu.appointment}
                    onClose={handleCloseContextMenu}
                    onDelete={handleDeleteRequest}
                />
            )}

            {dayMenu && showDayMenu && (
                <CalendarDayContextMenu
                    position={dayMenu.position}
                    day={dayMenu.day}
                    appointmentCount={countDayAppointments(dayMenu.day)}
                    onClose={handleCloseDayMenu}
                    onOpenDay={dayMenuOpenDay}
                    canManageHolidays={canManageHolidays}
                    onAddHoliday={handleAddHoliday}
                    onEditHoliday={handleEditHoliday}
                    onRemoveHoliday={handleRemoveHoliday}
                />
            )}

            <HolidayQuickModal
                isOpen={!!holidayModal}
                onClose={handleCloseHolidayModal}
                onSave={handleSaveHoliday}
                date={holidayModal?.date}
                existingHoliday={holidayModal?.existingHoliday}
                appointmentWarning={holidayModal?.appointmentWarning}
                appointmentCheckFailed={holidayModal?.appointmentCheckFailed ?? false}
            />
        </div>
    );
};

export default AppointmentCalendar;
