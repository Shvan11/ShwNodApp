import { useState, useEffect, useCallback, useMemo, type MouseEvent } from 'react';
import CalendarGrid, { type DropTarget, type MoreMenu } from './CalendarGrid';
import CalendarHeader from './CalendarHeader';
import MonthlyCalendarGrid from './MonthlyCalendarGrid';
import CalendarContextMenu from './CalendarContextMenu';
import CalendarDayContextMenu from './CalendarDayContextMenu';
import HolidayQuickModal from './HolidayQuickModal';
import Modal from './Modal';
import CalendarLegend from './CalendarLegend';
import { useToast } from '../../contexts/ToastContext';
import { useAppointmentDoctors } from '../../hooks/useAppointmentDoctors';
import { parseLocalDate } from '../../utils/calendarDate';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
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
    const { byId: doctorColors, legend: doctorLegend } = useAppointmentDoctors();

    // State management
    const [currentDate, setCurrentDate] = useState<Date>(
        initialDate ? parseLocalDate(initialDate) : new Date()
    );
    const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
    const [calendarStats, setCalendarStats] = useState<CalendarStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [internalSelectedSlot, setInternalSelectedSlot] = useState<SlotData | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
    const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
    const [isMobile, setIsMobile] = useState(false);

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

    // Mobile detection - Force day view on mobile devices
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth <= 768;
            setIsMobile(mobile);

            // Force day view on mobile
            if (mobile && viewMode !== 'day') {
                setViewMode('day');
            }
        };

        // Check on mount
        checkMobile();

        // Add resize listener
        window.addEventListener('resize', checkMobile);

        return () => window.removeEventListener('resize', checkMobile);
    }, [viewMode]);

    // Utility functions
    // Week starts on Saturday (day 6)
    const getWeekStart = (date: Date): Date => {
        const start = new Date(date);
        const day = start.getDay();
        // Calculate days to subtract to get to Saturday
        const diff = day === 6 ? 0 : (day + 1);
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        return start;
    };

    const getWeekEnd = (weekStart: Date): Date => {
        const end = new Date(weekStart);
        // Week: Sat, Sun, Mon, Tue, Wed, Thu (6 days, excluding Friday)
        end.setDate(end.getDate() + 5); // Thursday (5 days after Saturday)
        end.setHours(23, 59, 59, 999);
        return end;
    };

    const validateCalendarData = (calendarResult: Partial<CalendarData> | null): CalendarData => {
        if (!calendarResult) {
            return { days: [], timeSlots: [] };
        }

        return {
            days: calendarResult.days || [],
            timeSlots: calendarResult.timeSlots || []
        };
    };

    // Computed values
    const weekStart = useMemo(() => {
        return getWeekStart(currentDate);
    }, [currentDate]);

    const weekEnd = useMemo(() => {
        return getWeekEnd(weekStart);
    }, [weekStart]);

    const weekDisplayText = useMemo(() => {
        const start = new Date(weekStart);
        const end = new Date(weekEnd);

        if (viewMode === 'day') {
            return currentDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        }

        if (viewMode === 'month') {
            return currentDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
            });
        }

        return `Week of ${start.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        })} - ${end.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        })}`;
    }, [weekStart, weekEnd, currentDate, viewMode]);

    // Toolbar title — main line (month + year) and sub line (context per view mode)
    const titleMain = useMemo(
        () => currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        [currentDate]
    );

    const titleSub = useMemo(() => {
        if (viewMode === 'day') {
            return currentDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        }
        if (viewMode === 'month') {
            return '';
        }
        // ISO week number
        const tmp = new Date(weekStart);
        tmp.setHours(0, 0, 0, 0);
        tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
        const week1 = new Date(tmp.getFullYear(), 0, 4);
        const weekNumber =
            1 +
            Math.round(
                ((tmp.getTime() - week1.getTime()) / 86400000 -
                    3 +
                    ((week1.getDay() + 6) % 7)) /
                    7
            );
        const fmt = (d: Date) =>
            d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
        return `Week ${weekNumber} · ${fmt(weekStart)} – ${fmt(weekEnd)}`;
    }, [weekStart, weekEnd, currentDate, viewMode]);

    // API functions
    const fetchCalendarData = useCallback(async (
        date: Date,
        doctorId: number | null = null,
        viewModeParam: ViewMode = viewMode
    ) => {
        setLoading(true);
        setError(null);

        try {
            // Format date in local timezone to avoid UTC conversion issues
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const targetDate = `${year}-${month}-${day}`;

            // Build query parameters
            const calendarParams = new URLSearchParams({ date: targetDate });
            if (doctorId) {
                calendarParams.append('doctorId', String(doctorId));
            }

            // Determine API endpoint based on view mode
            const endpoint = viewModeParam === 'month'
                ? `/api/calendar/month?${calendarParams}`
                : `/api/calendar/week?${calendarParams}`;

            // Fetch both calendar data and stats in parallel. Both are required,
            // so a bare fetchJSON in Promise.all (rejects on the first non-2xx)
            // matches the old per-response !ok throw.
            const [calendarResult, statsResult] = await Promise.all([
                fetchJSON<Partial<CalendarData> & { success?: boolean; error?: string }>(endpoint),
                fetchJSON<{ success?: boolean; error?: string; stats?: CalendarStats }>(
                    `/api/calendar/stats?date=${targetDate}`
                )
            ]);

            if (!calendarResult.success) {
                throw new Error(calendarResult.error || 'Failed to fetch calendar data');
            }

            if (!statsResult.success) {
                throw new Error(statsResult.error || 'Failed to fetch calendar stats');
            }

            // Validate and set calendar data
            const validatedCalendarData = validateCalendarData(calendarResult);
            setCalendarData(validatedCalendarData);
            setCalendarStats(statsResult.stats ?? null);

        } catch (err) {
            console.error('❌ Calendar fetch error:', err);
            setError(httpErrorMessage(err, 'Unknown error'));
            setCalendarData(null);
            setCalendarStats(null);
        } finally {
            setLoading(false);
        }
    }, [viewMode]);

    // Navigation handlers
    const navigateWeek = useCallback((direction: 'next' | 'prev') => {
        const newDate = new Date(currentDate);

        if (viewMode === 'month') {
            // Navigate by month
            newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
        } else if (viewMode === 'day') {
            // Navigate by day (mobile-friendly)
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
        } else {
            // Navigate by week
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        }

        setCurrentDate(newDate);
    }, [currentDate, viewMode]);

    const goToToday = useCallback(() => {
        setCurrentDate(new Date());
    }, []);

    // Event handlers
    const handleViewModeChange = useCallback((newViewMode: ViewMode) => {
        // On mobile, always stay in day view
        if (isMobile && newViewMode !== 'day') {
            return;
        }

        setViewMode(newViewMode);
        // Fetch new data for the new view mode
        fetchCalendarData(currentDate, selectedDoctorId, newViewMode);
    }, [currentDate, selectedDoctorId, fetchCalendarData, isMobile]);

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
                await fetchCalendarData(currentDate, selectedDoctorId);
            } catch (error) {
                toast.error(httpErrorMessage(error, 'Failed to reschedule appointment'));
            }
        },
        [currentDate, selectedDoctorId, fetchCalendarData, toast]
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
        // Switch to day view for the selected day
        setCurrentDate(parseLocalDate(day.date));
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
                `/api/holidays/appointments-on-date?date=${day.date}`
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
                ID: day.holidayId,
                HolidayName: day.holidayName,
                Description: day.holidayDescription
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
            await fetchCalendarData(currentDate, selectedDoctorId);
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to save holiday'));
        }
    }, [currentDate, selectedDoctorId, fetchCalendarData, toast]);

    // Confirm delete holiday
    const handleDeleteHolidayConfirm = useCallback(async () => {
        if (!deleteHolidayConfirm?.holidayId) return;

        try {
            await deleteJSON(`/api/admin/lookups/tblHolidays/${deleteHolidayConfirm.holidayId}`);

            toast.success('Holiday removed');
            setDeleteHolidayConfirm(null);

            // Refresh calendar
            await fetchCalendarData(currentDate, selectedDoctorId);
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to remove holiday'));
        }
    }, [deleteHolidayConfirm, currentDate, selectedDoctorId, fetchCalendarData, toast]);

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
            await fetchCalendarData(currentDate, selectedDoctorId);

            // Close delete confirmation modal
            setDeleteConfirmation(null);
        } catch (error) {
            console.error('Error deleting appointment:', error);
            toast.error('Failed to delete appointment: ' + httpErrorMessage(error, 'Unknown error'));
        }
    }, [deleteConfirmation, currentDate, selectedDoctorId, fetchCalendarData, toast]);

    // Handler to close context menu
    const handleCloseContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // Effects
    useEffect(() => {
        fetchCalendarData(currentDate, selectedDoctorId);
    }, [currentDate, selectedDoctorId, fetchCalendarData]);

    // Loading state
    if (loading) {
        return (
            <div className="appointment-calendar loading">
                <div className="calendar-loading">
                    <div className="loading-spinner">
                        <i className="fas fa-spinner fa-spin"></i>
                    </div>
                    <h3>Loading Calendar...</h3>
                    <p>Fetching appointment data for {weekDisplayText}</p>
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
                            onClick={() => fetchCalendarData(currentDate)}
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
        <div className="appointment-calendar">
            {/* Calendar Header */}
            <CalendarHeader
                titleMain={titleMain}
                titleSub={titleSub}
                onPreviousWeek={() => navigateWeek('prev')}
                onNextWeek={() => navigateWeek('next')}
                onTodayClick={goToToday}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                calendarStats={calendarStats}
                loading={loading}
                selectedDoctorId={selectedDoctorId}
                onDoctorChange={handleDoctorChange}
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
