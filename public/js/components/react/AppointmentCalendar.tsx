import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import CalendarGrid, { CORE_TIME_SLOTS, type DropTarget, type MoreMenu } from './CalendarGrid';
import CalendarHeader from './CalendarHeader';
import MonthlyCalendarGrid from './MonthlyCalendarGrid';
import CalendarContextMenu from './CalendarContextMenu';
import CalendarDayContextMenu from './CalendarDayContextMenu';
import HolidayQuickModal from './HolidayQuickModal';
import Modal from './Modal';
import CalendarLegend from './CalendarLegend';
import { useToast } from '../../contexts/ToastContext';
import { useAppointmentDoctors } from '../../hooks/useAppointmentDoctors';
import {
    parseLocalDate,
    toLocalDateString,
    getWeekStartSaturday,
    addWorkingDays
} from '../../utils/calendarDate';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { calendarRangeQuery, calendarMonthQuery, calendarStatsQuery } from '@/query/queries';
import * as holiday from '@shared/contracts/holiday.contract';
import type {
    ViewMode,
    CalendarMode,
    CalendarAppointment,
    CalendarDay,
    CalendarData,
    CalendarStats,
    SlotData,
    MenuPosition,
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

const shortDate = (d: string): string =>
    parseLocalDate(d).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });

interface ContextMenuState {
    position: MenuPosition;
    appointment: CalendarAppointment;
}

interface DayContextMenuState {
    position: MenuPosition;
    day: CalendarDay;
}

interface HolidayModalState {
    date: string;
    existingHoliday: ExistingHoliday | null;
    appointmentWarning: AppointmentWarning | null;
}

interface AppointmentCalendarProps {
    initialDate?: Date | string;
    initialViewMode?: ViewMode;
    mode?: CalendarMode;
    onSlotSelect?: (slot: SlotData) => void;
    selectedSlot?: SlotData | null;
}

/**
 * AppointmentCalendar Main Component
 *
 * The primary calendar component that orchestrates all calendar functionality
 * Integrates with existing tblcalender system via optimized API endpoints
 */
const AppointmentCalendar = ({
    initialDate,
    initialViewMode = 'week',
    mode = 'view',
    onSlotSelect,
    selectedSlot: externalSelectedSlot
}: AppointmentCalendarProps) => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const { byId: doctorColors, legend: doctorLegend } = useAppointmentDoctors();

    // State management
    const [currentDate, setCurrentDate] = useState<Date>(
        initialDate ? parseLocalDate(initialDate) : new Date()
    );
    const [internalSelectedSlot, setInternalSelectedSlot] = useState<SlotData | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
    const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
    const [isMobile, setIsMobile] = useState(false);

    // Density-zoom: the grid window is `dayCount` working days forward from
    // `anchorDate` (the current week's Saturday at init / on Today).
    const [anchorDate, setAnchorDate] = useState<string>(() =>
        toLocalDateString(getWeekStartSaturday(initialDate ?? new Date()))
    );
    const [dayCount, setDayCount] = useState<number>(readStoredDayCount);
    const boardRef = useRef<HTMLDivElement>(null);

    // Drag-to-reschedule and "+N more" popover state
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const [moreMenu, setMoreMenu] = useState<MoreMenu | null>(null);

    // Context menu and delete confirmation state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState<CalendarAppointment | null>(null);

    // Day context menu and holiday modal state
    const [dayContextMenu, setDayContextMenu] = useState<DayContextMenuState | null>(null);
    const [holidayModal, setHolidayModal] = useState<HolidayModalState | null>(null);
    const [deleteHolidayConfirm, setDeleteHolidayConfirm] = useState<CalendarDay | null>(null);

    // Use external selected slot if provided (for controlled mode)
    const selectedSlot = externalSelectedSlot || internalSelectedSlot;

    // Mobile detection — force a single-day grid on phones.
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth <= 768;
            setIsMobile(mobile);
            if (mobile) {
                setViewMode(prev => (prev === 'month' ? prev : 'day'));
                setDayCount(prev => (prev === 1 ? prev : 1));
            }
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Cell metrics derived from N — applied as CSS vars on the root.
    const rowH = rowHForN(dayCount);
    const fontScale = fontScaleForRowH(rowH);

    // The window's last working day (inclusive).
    const gridEnd = useMemo(
        () => addWorkingDays(anchorDate, dayCount - 1),
        [anchorDate, dayCount]
    );

    // Toolbar title — main line (month + year) + sub line (range / single day).
    const titleMain = useMemo(() => {
        const base = viewMode === 'month' ? currentDate : parseLocalDate(anchorDate);
        return base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }, [viewMode, currentDate, anchorDate]);

    const titleSub = useMemo(() => {
        if (viewMode === 'month') return '';
        if (dayCount === 1) {
            return parseLocalDate(anchorDate).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        }
        return `${shortDate(anchorDate)} – ${shortDate(gridEnd)} · ${dayCount} days`;
    }, [viewMode, dayCount, anchorDate, gridEnd]);

    const rangeLabel = titleSub || titleMain;

    // ── Data fetching (React Query) ─────────────────────────────────────────
    // Grid (day/week/zoom): one round-trip to /range returns days + timeSlots +
    // stats. The grid window's end depends on `dayCount`; debounce it into the
    // query key so dragging the zoom slider through several N values issues one
    // request (the live `dayCount` still drives the layout/labels immediately).
    const isGrid = viewMode !== 'month';
    const [debouncedDayCount, setDebouncedDayCount] = useState(dayCount);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedDayCount(dayCount), FETCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [dayCount]);
    const queryEnd = useMemo(
        () => addWorkingDays(anchorDate, debouncedDayCount - 1),
        [anchorDate, debouncedDayCount]
    );
    const rangeQ = useQuery({
        ...calendarRangeQuery(anchorDate, queryEnd, selectedDoctorId),
        enabled: isGrid,
    });

    // Month view keeps its own endpoints (separate summary grid).
    const monthDateStr = toLocalDateString(currentDate);
    const monthParams = `date=${monthDateStr}${selectedDoctorId ? `&doctorId=${selectedDoctorId}` : ''}`;
    const monthQ = useQuery({ ...calendarMonthQuery(monthParams), enabled: !isGrid });
    const statsQ = useQuery({ ...calendarStatsQuery(`date=${monthDateStr}`), enabled: !isGrid });

    // The contract's day/stat rows (shared/contracts/calendar.contract.ts) are now
    // structurally assignable to the local CalendarData/CalendarStats view models —
    // calendar.types.ts widened the holiday/patient fields to `… | null` to match — so
    // the grid/month/stats payloads flow in cast-free, and contract drift surfaces as a
    // compile error right here on the render path. Month view doesn't render time rows.
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
    const calendarStats: CalendarStats | null = isGrid
        ? (rangeQ.data?.stats ?? null)
        : (statsQ.data?.stats ?? null);
    const loading = isGrid ? rangeQ.isFetching : monthQ.isFetching || statsQ.isFetching;
    const activeError = isGrid ? rangeQ.error : (monthQ.error ?? statsQ.error);
    const error = activeError ? httpErrorMessage(activeError, 'Unknown error') : null;

    // Refetch the active view (used after reschedule/delete/holiday mutations) —
    // invalidating the whole calendar prefix covers grid + month + stats.
    const refetch = useCallback(
        () => queryClient.invalidateQueries({ queryKey: qk.calendar.all() }),
        [queryClient]
    );

    // ── Navigation ──────────────────────────────────────────────────────────
    const navigate = useCallback(
        (direction: 'next' | 'prev') => {
            if (viewMode === 'month') {
                setCurrentDate(prev => {
                    const d = new Date(prev);
                    d.setMonth(d.getMonth() + (direction === 'next' ? 1 : -1));
                    return d;
                });
                return;
            }
            // Page the anchor by exactly the visible span (gap-free, forward-extend).
            setAnchorDate(prev =>
                addWorkingDays(prev, direction === 'next' ? dayCount : -dayCount)
            );
        },
        [viewMode, dayCount]
    );

    const goToToday = useCallback(() => {
        const today = new Date();
        setCurrentDate(today);
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

    // Fit: largest cells that still show every configured time row, columns kept
    // readable. Row count comes from the live time slots (falls back to the
    // hardcoded set before the first load).
    const handleZoomFit = useCallback(() => {
        const board = boardRef.current;
        if (!board) return;
        const headers = board.querySelector<HTMLElement>('.cal-day-headers');
        const headerH = headers?.getBoundingClientRect().height ?? 0;
        const availH = board.clientHeight - headerH - 4;
        const timeW =
            parseFloat(getComputedStyle(board).getPropertyValue('--cal-grid-time-w')) || 70;
        const availW = board.clientWidth - timeW;
        if (availH <= 0 || availW <= 0) return;
        const rowCount = calendarData?.timeSlots?.length || CORE_TIME_SLOTS.length;
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
                setCurrentDate(parseLocalDate(anchorDate));
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

    const handleDoctorChange = useCallback((doctorId: number | null) => {
        setSelectedDoctorId(doctorId);
    }, []);

    const handleReschedule = useCallback(
        async (
            appointmentID: number | string,
            newDate: string,
            newTime: string,
            appt: CalendarAppointment
        ) => {
            const personID = appt.personID ?? appt.person_id;
            if (!personID || !appt.drID || !appt.appDetail) {
                toast.error('Cannot reschedule: appointment is missing required details');
                return;
            }

            try {
                await putJSON(`/api/appointments/${appointmentID}`, {
                    person_id: personID,
                    dr_id: appt.drID,
                    app_detail: appt.appDetail,
                    app_date: `${newDate}T${newTime}:00`
                });

                toast.success('Appointment rescheduled');
                await refetch();
            } catch (error) {
                toast.error(httpErrorMessage(error, 'Failed to reschedule appointment'));
            }
        },
        [refetch, toast]
    );

    const handleSlotClick = useCallback((slot: SlotData, _event: MouseEvent<HTMLDivElement>) => {
        if (mode === 'selection') {
            // In selection mode, only allow selecting available slots
            if (slot.slotStatus !== 'available') {
                return;
            }

            // Update internal state if no external control
            if (!externalSelectedSlot) {
                setInternalSelectedSlot(slot);
            }

            // Call external selection handler
            if (onSlotSelect) {
                onSlotSelect(slot);
            }
        } else {
            // View mode: appointments are managed via their individual cards
            // (handleAppointmentClick) or the "+N more" overflow popover. A bare
            // slot click only updates highlighting — no redundant picker list.
            setInternalSelectedSlot(slot);
        }
    }, [mode, externalSelectedSlot, onSlotSelect]);

    // Clicking a specific appointment card goes straight to its Edit/Delete
    // menu — each card is individually rendered, so there's no list to pick from.
    const handleAppointmentClick = useCallback((
        appt: CalendarAppointment,
        date: string,
        time: string,
        event: MouseEvent<HTMLDivElement>
    ) => {
        // Card clicks are for managing existing appointments; selection mode
        // books empty slots, so ignore them there.
        if (mode === 'selection') return;

        // Block edits/deletes on past appointments, matching slot-click behaviour.
        if (new Date(`${date}T${time}:00`) < new Date()) {
            toast.error('You cannot edit or delete past appointments');
            return;
        }

        setContextMenu({
            position: { x: event.clientX, y: event.clientY },
            appointment: appt
        });
    }, [mode, toast]);

    // Handler for clicking on a day in monthly view
    const handleDayClick = useCallback((day: CalendarDay) => {
        // Switch to a single-day grid for the selected day
        setAnchorDate(day.date);
        setDayCount(1);
        setViewMode('day');
    }, []);

    // Handler for right-clicking on a day in monthly view (holiday management)
    const handleDayContextMenu = useCallback((day: CalendarDay, event: MouseEvent<HTMLDivElement>) => {
        setDayContextMenu({
            position: { x: event.clientX, y: event.clientY },
            day
        });
    }, []);

    // Close day context menu
    const handleCloseDayContextMenu = useCallback(() => {
        setDayContextMenu(null);
    }, []);

    // Add holiday from context menu
    const handleAddHoliday = useCallback(async (day: CalendarDay) => {
        // Check for existing appointments on this date
        try {
            const data = await fetchJSON<AppointmentWarning>(
                `/api/holidays/appointments-on-date?date=${day.date}`,
                { schema: holiday.appointmentsOnDate.response }
            );

            setHolidayModal({
                date: day.date,
                existingHoliday: null,
                appointmentWarning: data.count > 0 ? data : null
            });
        } catch {
            // If check fails, still allow adding holiday
            setHolidayModal({
                date: day.date,
                existingHoliday: null,
                appointmentWarning: null
            });
        }
    }, []);

    // Edit holiday from context menu
    const handleEditHoliday = useCallback((day: CalendarDay) => {
        setHolidayModal({
            date: day.date,
            existingHoliday: {
                ID: day.holidayId ?? undefined,
                HolidayName: day.holidayName ?? undefined,
                Description: day.holidayDescription ?? undefined
            },
            appointmentWarning: null
        });
    }, []);

    // Remove holiday from context menu
    const handleRemoveHoliday = useCallback((day: CalendarDay) => {
        setDeleteHolidayConfirm(day);
    }, []);

    // Close holiday modal
    const handleCloseHolidayModal = useCallback(() => {
        setHolidayModal(null);
    }, []);

    // Save holiday (add or update)
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

            // Refresh calendar to show updated holidays
            await refetch();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to save holiday'));
        }
    }, [refetch, toast]);

    // Confirm delete holiday
    const handleDeleteHolidayConfirm = useCallback(async () => {
        if (!deleteHolidayConfirm?.holidayId) return;

        try {
            await deleteJSON(`/api/admin/lookups/tblHolidays/${deleteHolidayConfirm.holidayId}`);

            toast.success('Holiday removed');
            setDeleteHolidayConfirm(null);

            // Refresh calendar
            await refetch();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to remove holiday'));
        }
    }, [deleteHolidayConfirm, refetch, toast]);

    // Handler for delete action from context menu
    const handleDeleteRequest = useCallback((appointment: CalendarAppointment) => {
        setDeleteConfirmation(appointment);
    }, []);

    // Handler for confirmed delete
    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteConfirmation?.appointment_id) return;

        try {
            await deleteJSON(`/api/appointments/${deleteConfirmation.appointment_id}`);

            // Refresh calendar data after successful delete
            await refetch();

            // Close delete confirmation modal
            setDeleteConfirmation(null);
        } catch (error) {
            console.error('Error deleting appointment:', error);
            toast.error('Failed to delete appointment: ' + httpErrorMessage(error, 'Unknown error'));
        }
    }, [deleteConfirmation, refetch, toast]);

    // Handler to close context menu
    const handleCloseContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // Effects
    // (The grid/month data now loads via React Query above — the query keys carry
    //  viewMode/date/anchor/dayCount/doctor, so navigation refetches automatically;
    //  the zoom debounce lives in the debouncedDayCount effect.)

    // Persist the zoom (day count) per-browser.
    useEffect(() => {
        try {
            localStorage.setItem(N_STORAGE_KEY, String(dayCount));
        } catch {
            // Ignore storage failures (private mode / quota).
        }
    }, [dayCount]);

    // Loading state — only the initial load replaces the grid with a spinner;
    // refetches (nav, zoom, mutations) keep the current grid visible.
    if (loading && !calendarData) {
        return (
            <div className="appointment-calendar loading">
                <div className="calendar-loading">
                    <div className="loading-spinner">
                        <i className="fas fa-spinner fa-spin"></i>
                    </div>
                    <h3>Loading Calendar...</h3>
                    <p>Fetching appointment data for {rangeLabel}</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="appointment-calendar error">
                <div className="calendar-error">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h3>Calendar Loading Error</h3>
                    <p className="error-message">{error}</p>
                    <div className="error-actions">
                        <button
                            className="btn btn-primary"
                            onClick={() => refetch()}
                        >
                            <i className="fas fa-refresh"></i>
                            Retry
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={goToToday}
                        >
                            <i className="fas fa-calendar-day"></i>
                            Go to Today
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Main render
    return (
        <div
            className="appointment-calendar"
            style={{ '--cal-row-h': `${rowH}px`, '--cal-font-scale': fontScale } as CSSProperties}
        >
            {/* Calendar Header */}
            <CalendarHeader
                titleMain={titleMain}
                titleSub={titleSub}
                onPreviousWeek={() => navigate('prev')}
                onNextWeek={() => navigate('next')}
                onTodayClick={goToToday}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                calendarStats={calendarStats}
                loading={loading}
                selectedDoctorId={selectedDoctorId}
                onDoctorChange={handleDoctorChange}
                showZoom={viewMode !== 'month' && !isMobile}
                dayCount={dayCount}
                minDayCount={N_MIN}
                maxDayCount={N_MAX}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomSlider={handleZoomSlider}
                onZoomFit={handleZoomFit}
            />

            {/* Doctor colour legend (week/day views only — month cells aren't tinted) */}
            {viewMode !== 'month' && <CalendarLegend doctors={doctorLegend} />}

            {/* Calendar Grid - Show different grid based on view mode */}
            {viewMode === 'month' ? (
                <MonthlyCalendarGrid
                    calendarData={calendarData}
                    onDayClick={handleDayClick}
                    onDayContextMenu={handleDayContextMenu}
                    currentDate={currentDate}
                    mode={mode}
                />
            ) : (
                <CalendarGrid
                    calendarData={calendarData}
                    doctorColors={doctorColors}
                    hideEmptySlots={selectedDoctorId != null}
                    selectedSlot={selectedSlot}
                    onSlotClick={handleSlotClick}
                    onAppointmentClick={handleAppointmentClick}
                    onDayContextMenu={handleDayContextMenu}
                    mode={mode}
                    viewMode={viewMode}
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

            {/* Context Menu */}
            {contextMenu && (
                <CalendarContextMenu
                    position={contextMenu.position}
                    appointment={contextMenu.appointment}
                    onClose={handleCloseContextMenu}
                    onDelete={handleDeleteRequest}
                />
            )}

            {/* Delete Confirmation Modal */}
            <Modal
                isOpen={deleteConfirmation !== null}
                onClose={() => setDeleteConfirmation(null)}
                contentClassName="modal-content delete-modal"
                ariaLabelledBy="appt-delete-modal-title"
            >
                {deleteConfirmation && (
                    <>
                        <h3 id="appt-delete-modal-title">
                            <i className="fas fa-exclamation-triangle"></i> Confirm Delete
                        </h3>
                        <p>
                            Are you sure you want to delete the appointment for{' '}
                            <strong>{deleteConfirmation.patientName || 'this patient'}</strong>
                            {deleteConfirmation.appDetail && ` (${deleteConfirmation.appDetail})`}?
                        </p>
                        <div className="modal-actions">
                            <button
                                className="btn btn-cancel"
                                onClick={() => setDeleteConfirmation(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-delete"
                                onClick={handleDeleteConfirm}
                            >
                                <i className="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            {/* Day Context Menu (for holiday management) */}
            {dayContextMenu && (
                <CalendarDayContextMenu
                    position={dayContextMenu.position}
                    day={dayContextMenu.day}
                    onClose={handleCloseDayContextMenu}
                    onAddHoliday={handleAddHoliday}
                    onEditHoliday={handleEditHoliday}
                    onRemoveHoliday={handleRemoveHoliday}
                />
            )}

            {/* Holiday Quick Modal */}
            <HolidayQuickModal
                isOpen={!!holidayModal}
                onClose={handleCloseHolidayModal}
                onSave={handleSaveHoliday}
                date={holidayModal?.date}
                existingHoliday={holidayModal?.existingHoliday}
                appointmentWarning={holidayModal?.appointmentWarning}
            />

            {/* Delete Holiday Confirmation Modal */}
            <Modal
                isOpen={deleteHolidayConfirm !== null}
                onClose={() => setDeleteHolidayConfirm(null)}
                contentClassName="modal-content delete-modal"
                ariaLabelledBy="holiday-delete-modal-title"
            >
                {deleteHolidayConfirm && (
                    <>
                        <h3 id="holiday-delete-modal-title">
                            <i className="fas fa-exclamation-triangle"></i> Remove Holiday
                        </h3>
                        <p>
                            Are you sure you want to remove{' '}
                            <strong>{deleteHolidayConfirm.holidayName || 'this holiday'}</strong>?
                        </p>
                        <p className="text-muted">
                            This will allow appointments to be scheduled on this date again.
                        </p>
                        <div className="modal-actions">
                            <button
                                className="btn btn-cancel"
                                onClick={() => setDeleteHolidayConfirm(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-delete"
                                onClick={handleDeleteHolidayConfirm}
                            >
                                <i className="fas fa-trash"></i> Remove Holiday
                            </button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default AppointmentCalendar;
