/**
 * CalendarGrid Component for Appointment Calendar
 * 
 * Renders the main calendar grid with time columns and day columns
 * Handles dynamic height calculation for multiple appointments per time slot
 */

import React from 'react'
import TimeSlot from './TimeSlot.jsx'

const CalendarGrid = ({ calendarData, selectedSlot, onSlotClick, onDayContextMenu, mode = 'view', viewMode = 'week', showOnlyAvailable = false, showEarlySlots = false }) => {
    if (!calendarData || !calendarData.days || !calendarData.timeSlots) {
        return (
            <div className="calendar-grid loading">
                <p>Loading calendar data...</p>
            </div>
        );
    }

    const { days, timeSlots } = calendarData;

    // Filter days for day view - show only the first day (or current day)
    const filteredDays = viewMode === 'day' ? [days[0]] : days;

    // Filter out early time slots if showEarlySlots is false
    const earlySlotTimes = ['12:00', '12:30', '13:00', '13:30'];
    const filteredTimeSlots = showEarlySlots
        ? timeSlots
        : timeSlots.filter(slot => !earlySlotTimes.includes(slot));

    // Calculate maximum valid appointments per time slot across all days
    const getMaxValidAppointmentsForTimeSlot = (timeSlot) => {
        let maxValidAppointments = 0;
        filteredDays.forEach(day => {
            const slotData = day.appointments[timeSlot] || { appointments: [], appointmentCount: 0 };
            const appointments = slotData.appointments || slotData; // Handle both old and new format
            const appointmentArray = Array.isArray(appointments) ? appointments : [];

            // Filter valid appointments using the same logic as TimeSlot component
            const validAppointments = appointmentArray.filter(appointment =>
                appointment && (appointment.patientName || appointment.appointmentID)
            );
            if (validAppointments.length > maxValidAppointments) {
                maxValidAppointments = validAppointments.length;
            }
        });
        return maxValidAppointments;
    };

    // Calculate exact dynamic height for time slot based on actual CSS values
    const getTimeSlotHeight = (timeSlot) => {
        const maxValidAppointments = getMaxValidAppointmentsForTimeSlot(timeSlot);
        const baseHeight = 85; // MUST match --calendar-slot-min-height in CSS

        if (maxValidAppointments <= 1) {
            return baseHeight;
        }

        // EXACT calculation matching CSS values (appointment-calendar.css):
        // - .time-slot padding: 10px (top/bottom = 20px total) [line 525]
        // - .appointment-content.multiple padding: 2px (top/bottom = 4px total) [line 622]
        // - .appointment-count: font 12px + padding 6px top/bottom = ~26px [lines 625-636]
        // - Content gap: 8px (gap between count header and list) [line 620]
        // - .appointment-item: FIXED height 40px (4px padding + 16px name + 16px detail + 4px padding) [line 656]
        // - .appointments-list gap: 4px between items [line 642]
        // - .appointments-list bottom padding: 8px [line 644]
        //
        // Formula: height = 62 + (n × 44)
        // Where: 62 = timeSlotPadding(20) + contentPadding(4) + countHeader(26) + contentGap(8) + listBottomPadding(8) - itemGap(4)
        //        44 = itemHeight(40) + itemGap(4)

        const timeSlotPadding = 20;
        const contentPadding = 4;
        const countHeaderHeight = 26;
        const contentGap = 8;
        const itemHeight = 40; // FIXED HEIGHT - matches CSS line 656 (4+16+16+4=40px)
        const itemGap = 4;
        const listBottomPadding = 8;

        const calculatedHeight = timeSlotPadding + contentPadding + countHeaderHeight +
                                contentGap + (maxValidAppointments * itemHeight) +
                                ((maxValidAppointments - 1) * itemGap) + listBottomPadding;

        return calculatedHeight;
    };

    // Helper function to get slot status
    const getSlotStatus = (date, time) => {
        // All slots are available regardless of date/time
        return 'available';
    };

    // Helper to check if date is today
    const isToday = (date) => {
        const today = new Date();
        const checkDate = new Date(date);
        return today.toDateString() === checkDate.toDateString();
    };

    // Helper to check if day is weekend
    const isWeekend = (dayOfWeek) => {
        return dayOfWeek === 6 || dayOfWeek === 7; // Saturday or Sunday
    };

    return (
        <>
            {/* Day Headers Row - Sticky below calendar header */}
            <div className={`calendar-day-headers ${viewMode === 'day' ? 'view-day' : ''}`}>
                <div className="day-headers-time-label">Time</div>
                {filteredDays.map(day => {
                    const isHoliday = day.isHoliday || false;
                    const dayClasses = [
                        'day-header-cell',
                        isToday(day.date) ? 'today' : '',
                        isWeekend(day.dayOfWeek) ? 'weekend' : '',
                        isHoliday ? 'holiday' : ''
                    ].filter(Boolean).join(' ');

                    // Calculate total appointments for this day
                    const totalAppointments = Object.values(day.appointments).reduce((total, slotInfo) => {
                        const appointments = Array.isArray(slotInfo) ? slotInfo : (slotInfo.appointments || []);
                        const validAppointments = appointments.filter(apt =>
                            apt && (apt.patientName || apt.appointmentID)
                        );
                        return total + validAppointments.length;
                    }, 0);

                    // Format date as "Monday 17/11"
                    const dateObj = new Date(day.date);
                    const dayName = day.dayName;
                    const dayNumber = dateObj.getDate();
                    const month = dateObj.getMonth() + 1;
                    const dateText = `${dayName} ${dayNumber}/${month}`;

                    // Right-click handler for context menu (holiday management)
                    const handleContextMenu = (event) => {
                        event.preventDefault();
                        if (onDayContextMenu) {
                            onDayContextMenu(day, event);
                        }
                    };

                    return (
                        <div
                            key={day.date}
                            className={dayClasses}
                            onContextMenu={handleContextMenu}
                            title={isHoliday ? `Holiday: ${day.holidayName}` : undefined}
                        >
                            <div className="day-header-date-line">{dateText}</div>
                            {isHoliday && (
                                <div className="day-header-holiday" title={day.holidayName || 'Holiday'}>
                                    <i className="fas fa-calendar-times"></i>
                                </div>
                            )}
                            {!isHoliday && totalAppointments > 0 && (
                                <div className="day-header-count" title={`${totalAppointments} appointment${totalAppointments !== 1 ? 's' : ''}`}>
                                    {totalAppointments}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Calendar Grid - Scrolling content */}
            <div className={`calendar-grid ${viewMode === 'day' ? 'view-day' : ''}`}>
                {/* Time column */}
                <div className="time-column">
                    {filteredTimeSlots.map(timeSlot => {
                        const dynamicHeight = getTimeSlotHeight(timeSlot);

                        return (
                            <div
                                key={timeSlot}
                                className="time-slot-label"
                                style={{
                                    minHeight: `${dynamicHeight}px`,
                                    height: `${dynamicHeight}px`
                                }}
                            >
                                {timeSlot}
                            </div>
                        );
                    })}
                </div>

            {/* Day columns */}
            {filteredDays.map(day => {
                const isHoliday = day.isHoliday || false;
                const dayClasses = [
                    'day-column',
                    isToday(day.date) ? 'today' : '',
                    isWeekend(day.dayOfWeek) ? 'weekend' : '',
                    isHoliday ? 'holiday' : ''
                ].filter(Boolean).join(' ');

                // Calculate total appointments for this day
                const totalAppointments = Object.values(day.appointments).reduce((total, slotInfo) => {
                    const appointments = Array.isArray(slotInfo) ? slotInfo : (slotInfo.appointments || []);
                    const validAppointments = appointments.filter(apt =>
                        apt && (apt.patientName || apt.appointmentID)
                    );
                    return total + validAppointments.length;
                }, 0);

                return (
                    <div key={day.date} className={dayClasses}>
                        <div className="day-header">
                            <div className="day-name">{day.dayName}</div>
                            <div className="day-date">{new Date(day.date).getDate()}</div>
                            {isHoliday && (
                                <div className="day-holiday-badge" title={day.holidayName || 'Holiday'}>
                                    <i className="fas fa-calendar-times"></i>
                                </div>
                            )}
                            {!isHoliday && totalAppointments > 0 && (
                                <div className="day-appointment-count" title={`${totalAppointments} appointment${totalAppointments !== 1 ? 's' : ''}`}>
                                    {totalAppointments}
                                </div>
                            )}
                        </div>

                        {filteredTimeSlots.map(timeSlot => {
                            const slotInfo = day.appointments[timeSlot] || { appointments: [], appointmentCount: 0, slotStatus: 'available' };

                            // Handle both old array format and new object format
                            const appointments = Array.isArray(slotInfo) ? slotInfo : (slotInfo.appointments || []);
                            const slotStatus = slotInfo.slotStatus || (appointments.length > 0 ? 'booked' : getSlotStatus(day.date, timeSlot));

                            const uniformHeight = getTimeSlotHeight(timeSlot); // Use uniform height for all slots at this time
                            const slotData = {
                                date: day.date,
                                time: timeSlot,
                                dayName: day.dayName,
                                appointments: appointments,
                                slotStatus: slotStatus,
                                appointmentID: appointments.length > 0 ? appointments[0].appointmentID : null,
                                appDetail: appointments.length > 0 ? appointments[0].appDetail : null,
                                patientName: appointments.length > 0 ? appointments[0].patientName : null
                            };

                            return (
                                <TimeSlot
                                    key={`${day.date}-${timeSlot}`}
                                    slotData={slotData}
                                    onClick={onSlotClick}
                                    isSelected={selectedSlot &&
                                               selectedSlot.date === day.date &&
                                               selectedSlot.time === timeSlot}
                                    uniformHeight={uniformHeight}
                                    mode={mode}
                                    showOnlyAvailable={showOnlyAvailable}
                                    isHoliday={isHoliday}
                                    holidayName={day.holidayName}
                                />
                            );
                        })}
                    </div>
                );
            })}
            </div>
        </>
    );
};

export default CalendarGrid;