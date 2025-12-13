import React, { useState, useEffect, useCallback, useMemo } from 'react'
import CalendarGrid from './CalendarGrid.jsx'
import CalendarHeader from './CalendarHeader.jsx'
import MonthlyCalendarGrid from './MonthlyCalendarGrid.jsx'
import CalendarContextMenu from './CalendarContextMenu.jsx'
import Notification from './appointments/Notification.jsx'
import { useToast } from '../../contexts/ToastContext.jsx';

/**
 * AppointmentCalendar Main Component
 *
 * The primary calendar component that orchestrates all calendar functionality
 * Integrates with existing tblcalender system via optimized API endpoints
 */

const AppointmentCalendar = ({
    initialDate,
    initialViewMode = 'week',
    mode = 'view', // 'view' or 'selection'
    onSlotSelect,
    selectedSlot: externalSelectedSlot,
    showOnlyAvailable = false
}) => {
    const toast = useToast();
    // State management
    const [currentDate, setCurrentDate] = useState(initialDate ? new Date(initialDate) : new Date());
    const [calendarData, setCalendarData] = useState(null);
    const [calendarStats, setCalendarStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [internalSelectedSlot, setInternalSelectedSlot] = useState(null);
    const [viewMode, setViewMode] = useState(initialViewMode);
    const [selectedDoctorId, setSelectedDoctorId] = useState(null);
    const [showEarlySlots, setShowEarlySlots] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Context menu and delete confirmation state
    const [contextMenu, setContextMenu] = useState(null); // { position: {x, y}, appointment }
    const [deleteConfirmation, setDeleteConfirmation] = useState(null); // appointment to delete

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
    const getWeekStart = (date) => {
        const start = new Date(date);
        const day = start.getDay();
        // Calculate days to subtract to get to Saturday
        // Saturday = 6, Sunday = 0, Monday = 1, etc.
        const diff = day === 6 ? 0 : (day + 1);
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        return start;
    };
    
    const getWeekEnd = (weekStart) => {
        const end = new Date(weekStart);
        // Week: Sat, Sun, Mon, Tue, Wed, Thu (6 days, excluding Friday)
        end.setDate(end.getDate() + 5); // Thursday (5 days after Saturday)
        end.setHours(23, 59, 59, 999);
        return end;
    };
    
    const validateCalendarData = (calendarResult) => {
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
    
    // API functions
    const fetchCalendarData = useCallback(async (date, doctorId = null, viewModeParam = viewMode) => {
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
                calendarParams.append('doctorId', doctorId);
            }

            // Determine API endpoint based on view mode
            const endpoint = viewModeParam === 'month'
                ? `/api/calendar/month?${calendarParams}`
                : `/api/calendar/week?${calendarParams}`;

            // Fetch both calendar data and stats in parallel
            const [calendarResponse, statsResponse] = await Promise.all([
                fetch(endpoint),
                fetch(`/api/calendar/stats?date=${targetDate}`)
            ]);

            if (!calendarResponse.ok) {
                throw new Error(`Calendar API error: ${calendarResponse.status}`);
            }

            if (!statsResponse.ok) {
                throw new Error(`Stats API error: ${statsResponse.status}`);
            }

            const calendarResult = await calendarResponse.json();
            const statsResult = await statsResponse.json();

            if (!calendarResult.success) {
                throw new Error(calendarResult.error || 'Failed to fetch calendar data');
            }

            if (!statsResult.success) {
                throw new Error(statsResult.error || 'Failed to fetch calendar stats');
            }

            // Validate and set calendar data
            const validatedCalendarData = validateCalendarData(calendarResult);
            setCalendarData(validatedCalendarData);
            setCalendarStats(statsResult.stats);


        } catch (err) {
            console.error('❌ Calendar fetch error:', err);
            setError(err.message);
            setCalendarData(null);
            setCalendarStats(null);
        } finally {
            setLoading(false);
        }
    }, [viewMode]);
    
    // Navigation handlers
    const navigateWeek = useCallback((direction) => {
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
    const handleViewModeChange = useCallback((newViewMode) => {
        // On mobile, always stay in day view
        if (isMobile && newViewMode !== 'day') {
            return;
        }

        setViewMode(newViewMode);
        // Fetch new data for the new view mode
        fetchCalendarData(currentDate, selectedDoctorId, newViewMode);
    }, [currentDate, selectedDoctorId, fetchCalendarData, isMobile]);

    const handleDoctorChange = useCallback((doctorId) => {
        setSelectedDoctorId(doctorId);
    }, []);

    const handleToggleEarlySlots = useCallback(() => {
        setShowEarlySlots(prev => !prev);
    }, []);

    const handleSlotClick = useCallback((slot, event) => {
        if (mode === 'selection') {
            // In selection mode, only allow selecting available slots (not past, full, or booked)
            if (slot.slotStatus !== 'available') {
                return; // Don't allow selection of non-available slots
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
            // Normal view mode - show context menu for slots with appointments
            const validAppointments = slot.appointments?.filter(apt =>
                apt && (apt.patientName || apt.appointmentID)
            ) || [];

            if (validAppointments.length > 0) {
                // Check if the appointment is in the past
                const slotDateTime = new Date(`${slot.date}T${slot.time}:00`);
                const now = new Date();

                if (slotDateTime < now) {
                    // Show toast notification for past appointments
                    toast.error('You cannot edit or delete past appointments');
                    return;
                }

                // Show context menu for future appointments only
                setContextMenu({
                    position: { x: event.clientX, y: event.clientY },
                    appointments: validAppointments
                });
            }

            // Update selected slot for highlighting
            setInternalSelectedSlot(slot);
        }
    }, [mode, externalSelectedSlot, onSlotSelect]);

    // Handler for clicking on a day in monthly view
    const handleDayClick = useCallback((day) => {
        // Switch to day view for the selected day
        setCurrentDate(new Date(day.date));
        setViewMode('day');
    }, []);

    // Handler for delete action from context menu
    const handleDeleteRequest = useCallback((appointment) => {
        setDeleteConfirmation(appointment);
    }, []);

    // Handler for confirmed delete
    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteConfirmation?.appointmentID) return;

        try {
            const response = await fetch(`/api/appointments/${deleteConfirmation.appointmentID}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete appointment');
            }

            // Refresh calendar data after successful delete
            await fetchCalendarData(currentDate, selectedDoctorId);

            // Close delete confirmation modal
            setDeleteConfirmation(null);
        } catch (error) {
            console.error('Error deleting appointment:', error);
            toast.error('Failed to delete appointment: ' + error.message);
        }
    }, [deleteConfirmation, currentDate, selectedDoctorId, fetchCalendarData]);

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
                weekDisplayText={weekDisplayText}
                onPreviousWeek={() => navigateWeek('prev')}
                onNextWeek={() => navigateWeek('next')}
                onTodayClick={goToToday}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                calendarStats={calendarStats}
                loading={loading}
                selectedDoctorId={selectedDoctorId}
                onDoctorChange={handleDoctorChange}
                showEarlySlots={showEarlySlots}
                onToggleEarlySlots={handleToggleEarlySlots}
            />

            {/* Calendar Grid - Show different grid based on view mode */}
            {viewMode === 'month' ? (
                <MonthlyCalendarGrid
                    calendarData={calendarData}
                    onDayClick={handleDayClick}
                    currentDate={currentDate}
                    mode={mode}
                />
            ) : (
                <CalendarGrid
                    calendarData={calendarData}
                    selectedSlot={selectedSlot}
                    onSlotClick={handleSlotClick}
                    mode={mode}
                    viewMode={viewMode}
                    showOnlyAvailable={showOnlyAvailable}
                    showEarlySlots={showEarlySlots}
                />
            )}

            {/* Context Menu */}
            {contextMenu && (
                <CalendarContextMenu
                    position={contextMenu.position}
                    appointments={contextMenu.appointments}
                    onClose={handleCloseContextMenu}
                    onDelete={handleDeleteRequest}
                />
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmation && (
                <div className="modal-overlay" onClick={() => setDeleteConfirmation(null)}>
                    <div className="modal-content delete-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>
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
                    </div>
                </div>
            )}

            {/* Toast Notifications now handled globally by ToastProvider in App.jsx */}
        </div>
    );
};

export default AppointmentCalendar;