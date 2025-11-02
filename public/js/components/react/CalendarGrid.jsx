/**
 * CalendarGrid Component for Appointment Calendar
 * 
 * Renders the main calendar grid with time columns and day columns
 * Handles dynamic height calculation for multiple appointments per time slot
 */

import React from 'react'
import TimeSlot from './TimeSlot.jsx'

const CalendarGrid = ({ calendarData, selectedSlot, onSlotClick, mode = 'view', showOnlyAvailable = false }) => {
    if (!calendarData || !calendarData.days || !calendarData.timeSlots) {
        return (
            <div className="calendar-grid loading">
                <p>Loading calendar data...</p>
            </div>
        );
    }

    const { days, timeSlots } = calendarData;

    // Calculate maximum valid appointments per time slot across all days
    const getMaxValidAppointmentsForTimeSlot = (timeSlot) => {
        let maxValidAppointments = 0;
        days.forEach(day => {
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
        const baseHeight = 80; // Minimum height in pixels
        
        if (maxValidAppointments <= 1) {
            return baseHeight;
        }
        
        // FINE-TUNED calculation with extra padding for safety:
        // appointment-content.multiple padding: 4px (top/bottom = 8px total)
        // appointment-count: font-size 13px + padding 4px + margin-bottom 4px = ~30px
        // appointments-list padding: 2px (top/bottom = 4px total)
        // appointment-item: min-height 25px + padding 8px + margin-bottom 2px = 40px per item
        // gap between items: 2px * (count-1)
        // extra safety margin: 20px
        
        const contentPadding = 8; // 4px top + 4px bottom
        const countHeaderHeight = 30; // font + padding + margin
        const listPadding = 4; // 2px top + 2px bottom
        const itemHeight = 40; // 25px min-height + 8px padding + 2px margin + safety
        const gapBetweenItems = Math.max(0, (maxValidAppointments - 1) * 2); // 2px gap between items
        const safetyMargin = 20; // Extra space to prevent truncation
        
        const calculatedHeight = contentPadding + countHeaderHeight + listPadding + 
                                (maxValidAppointments * itemHeight) + gapBetweenItems + safetyMargin;
        
        // Debug logging (remove after testing)
        console.log(`TimeSlot ${timeSlot}: ${maxValidAppointments} appointments = ${calculatedHeight}px`);
        
        return calculatedHeight;
    };

    // Helper function to get slot status
    const getSlotStatus = (date, time) => {
        const now = new Date();
        const slotDateTime = new Date(`${date}T${time}:00`);
        
        if (slotDateTime < now) return 'past';
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
        <div className="calendar-grid">
            {/* Time column */}
            <div className="time-column">
                <div className="time-header">Time</div>
                {timeSlots.map(timeSlot => {
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
            {days.map(day => {
                const dayClasses = [
                    'day-column',
                    isToday(day.date) ? 'today' : '',
                    isWeekend(day.dayOfWeek) ? 'weekend' : ''
                ].filter(Boolean).join(' ');

                return (
                    <div key={day.date} className={dayClasses}>
                        <div className="day-header">
                            <div className="day-name">{day.dayName}</div>
                            <div className="day-date">{new Date(day.date).getDate()}</div>
                        </div>
                        
                        {timeSlots.map(timeSlot => {
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
                                />
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};

export default CalendarGrid;