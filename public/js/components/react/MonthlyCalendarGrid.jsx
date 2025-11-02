/**
 * MonthlyCalendarGrid Component
 *
 * Renders a monthly calendar view with clean appointment indicators
 * Week starts from Saturday as per configuration
 */

import React, { useState } from 'react'

const MonthlyCalendarGrid = ({
    calendarData,
    onDayClick,
    currentDate,
    mode = 'view'
}) => {
    const [hoveredDay, setHoveredDay] = useState(null);

    if (!calendarData || !calendarData.days) {
        return (
            <div className="monthly-calendar-grid loading">
                <p>Loading monthly data...</p>
            </div>
        );
    }

    const { days } = calendarData;

    // Helper function to get utilization color
    const getUtilizationColor = (utilizationPercent) => {
        if (utilizationPercent === 0) return '#f5f5f5';
        if (utilizationPercent < 30) return '#e8f5e9';
        if (utilizationPercent < 60) return '#fff3e0';
        if (utilizationPercent < 80) return '#ffe0b2';
        return '#ffccbc';
    };

    // Helper function to get appointment badge color
    const getAppointmentBadgeColor = (count) => {
        if (count === 0) return { bg: '#f5f5f5', text: '#9e9e9e', border: '#e0e0e0' };
        if (count <= 3) return { bg: '#e3f2fd', text: '#1976d2', border: '#2196f3' };
        if (count <= 6) return { bg: '#fff3e0', text: '#e65100', border: '#ff9800' };
        return { bg: '#ffebee', text: '#c62828', border: '#f44336' };
    };

    // Helper to check if date is today
    const isToday = (date) => {
        const today = new Date();
        const checkDate = new Date(date);
        return today.toDateString() === checkDate.toDateString();
    };

    // Helper to check if day is weekend (Saturday or Sunday)
    const isWeekend = (date) => {
        const day = new Date(date).getDay();
        return day === 0 || day === 6; // Sunday = 0, Saturday = 6
    };

    // Helper to check if day is in current month
    const isCurrentMonth = (date) => {
        const checkDate = new Date(date);
        const current = new Date(currentDate);
        return checkDate.getMonth() === current.getMonth() &&
               checkDate.getFullYear() === current.getFullYear();
    };

    // Day headers (starting with Saturday, excluding Friday)
    const dayHeaders = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

    return (
        <div className="monthly-calendar-grid">
            {/* Day headers */}
            <div className="month-grid-header">
                {dayHeaders.map(day => (
                    <div key={day} className="month-day-header">
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar days */}
            <div className="month-grid-body">
                {days.map(day => {
                    const appointmentCount = day.appointmentCount || 0;
                    const utilizationPercent = day.utilizationPercent || 0;
                    const badgeColor = getAppointmentBadgeColor(appointmentCount);
                    const bgColor = getUtilizationColor(utilizationPercent);
                    const currentMonth = isCurrentMonth(day.date);
                    const todayClass = isToday(day.date);
                    const weekendClass = isWeekend(day.date);

                    const cellClasses = [
                        'month-day-cell',
                        !currentMonth ? 'other-month' : '',
                        todayClass ? 'today' : '',
                        weekendClass ? 'weekend' : '',
                        appointmentCount > 0 ? 'has-appointments' : ''
                    ].filter(Boolean).join(' ');

                    return (
                        <div
                            key={day.date}
                            className={cellClasses}
                            style={{ backgroundColor: currentMonth ? bgColor : '#fafafa' }}
                            onClick={() => currentMonth && onDayClick && onDayClick(day)}
                            onMouseEnter={() => setHoveredDay(day.date)}
                            onMouseLeave={() => setHoveredDay(null)}
                        >
                            {/* Day number */}
                            <div className="month-day-number">
                                {new Date(day.date).getDate()}
                            </div>

                            {/* Appointment badge */}
                            {currentMonth && appointmentCount > 0 && (
                                <div
                                    className="appointment-badge"
                                    style={{
                                        backgroundColor: badgeColor.bg,
                                        color: badgeColor.text,
                                        borderColor: badgeColor.border
                                    }}
                                >
                                    {appointmentCount}
                                </div>
                            )}

                            {/* Utilization bar */}
                            {currentMonth && appointmentCount > 0 && (
                                <div className="utilization-bar">
                                    <div
                                        className="utilization-fill"
                                        style={{
                                            width: `${utilizationPercent}%`,
                                            backgroundColor: badgeColor.border
                                        }}
                                    />
                                </div>
                            )}

                            {/* Hover tooltip with appointment details */}
                            {hoveredDay === day.date && currentMonth && appointmentCount > 0 && (
                                <div className="day-tooltip">
                                    <div className="tooltip-header">
                                        {new Date(day.date).toLocaleDateString('en-US', {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric'
                                        })}
                                    </div>
                                    <div className="tooltip-stats">
                                        <div className="tooltip-stat">
                                            <span className="stat-label">Appointments:</span>
                                            <span className="stat-value">{appointmentCount}</span>
                                        </div>
                                        <div className="tooltip-stat">
                                            <span className="stat-label">Utilization:</span>
                                            <span className="stat-value">{utilizationPercent}%</span>
                                        </div>
                                    </div>
                                    {day.appointments && day.appointments.length > 0 && (
                                        <div className="tooltip-appointments">
                                            <div className="tooltip-section-title">Patients:</div>
                                            {day.appointments.slice(0, 5).map((apt, idx) => (
                                                <div key={idx} className="tooltip-appointment">
                                                    <span className="apt-time">{apt.time}</span>
                                                    <span className="apt-name">{apt.patientName}</span>
                                                </div>
                                            ))}
                                            {day.appointments.length > 5 && (
                                                <div className="tooltip-more">
                                                    +{day.appointments.length - 5} more
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="tooltip-action">
                                        Click to view details
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MonthlyCalendarGrid;
