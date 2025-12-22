/**
 * MonthlyCalendarGrid Component
 *
 * Renders a monthly calendar view with clean appointment indicators
 * Week starts from Saturday as per configuration
 */

import React, { useState, useEffect, useRef } from 'react'

const MonthlyCalendarGrid = ({
    calendarData,
    onDayClick,
    onDayContextMenu,
    currentDate,
    mode = 'view'
}) => {
    const [expandedDay, setExpandedDay] = useState(null);
    const gridRef = useRef(null);

    // Close expanded panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (expandedDay && gridRef.current && !e.target.closest('.month-day-cell')) {
                setExpandedDay(null);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [expandedDay]);

    if (!calendarData || !calendarData.days) {
        return (
            <div className="monthly-calendar-grid loading">
                <p>Loading monthly data...</p>
            </div>
        );
    }

    const { days } = calendarData;

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
        <div className="monthly-calendar-grid" ref={gridRef}>
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
                    const currentMonth = isCurrentMonth(day.date);
                    const todayClass = isToday(day.date);
                    const weekendClass = isWeekend(day.date);
                    const isHoliday = day.isHoliday || false;

                    const isExpanded = expandedDay === day.date;

                    const cellClasses = [
                        'month-day-cell',
                        !currentMonth ? 'other-month' : '',
                        todayClass ? 'today' : '',
                        weekendClass ? 'weekend' : '',
                        appointmentCount > 0 ? 'has-appointments' : '',
                        isHoliday ? 'holiday' : '',
                        isExpanded ? 'expanded' : ''
                    ].filter(Boolean).join(' ');

                    // Single click to expand/collapse appointment list
                    const handleClick = () => {
                        if (!currentMonth) return;
                        if (isHoliday) return; // Don't navigate to holiday dates

                        // Toggle expanded state for this day
                        if (expandedDay === day.date) {
                            setExpandedDay(null);
                        } else {
                            setExpandedDay(day.date);
                        }
                    };

                    // Double click to navigate to day view
                    const handleDoubleClick = () => {
                        if (!currentMonth) return;
                        if (isHoliday) return;
                        if (onDayClick) onDayClick(day);
                    };

                    // Right-click handler for context menu (holiday management)
                    const handleContextMenu = (event) => {
                        if (!currentMonth) return; // Don't show context menu for other month days
                        event.preventDefault();
                        if (onDayContextMenu) {
                            onDayContextMenu(day, event);
                        }
                    };

                    return (
                        <div
                            key={day.date}
                            className={cellClasses}
                            onClick={handleClick}
                            onDoubleClick={handleDoubleClick}
                            onContextMenu={handleContextMenu}
                            title={isHoliday ? day.holidayName : undefined}
                        >
                            {/* Day number */}
                            <div className="month-day-number">
                                {new Date(day.date).getDate()}
                            </div>

                            {/* Holiday badge */}
                            {currentMonth && isHoliday && (
                                <div className="holiday-badge" title={day.holidayName}>
                                    <i className="fas fa-calendar-times"></i>
                                </div>
                            )}

                            {/* Appointment badge - Clean neutral styling via CSS */}
                            {currentMonth && !isHoliday && appointmentCount > 0 && (
                                <div className="appointment-badge">
                                    {appointmentCount}
                                </div>
                            )}

                            {/* Expanded appointment list (shows on click) */}
                            {isExpanded && currentMonth && !isHoliday && appointmentCount > 0 && (
                                <div className="day-expanded-panel">
                                    <div className="expanded-header">
                                        {new Date(day.date).toLocaleDateString('en-US', {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric'
                                        })}
                                        <span className="expanded-count">{appointmentCount} appts</span>
                                    </div>
                                    {day.appointments && day.appointments.length > 0 && (
                                        <div className="expanded-appointments">
                                            {day.appointments.slice(0, 8).map((apt, idx) => (
                                                <div key={idx} className="expanded-appointment">
                                                    <span className="apt-time">{apt.time}</span>
                                                    <span className="apt-name">{apt.patientName}</span>
                                                </div>
                                            ))}
                                            {day.appointments.length > 8 && (
                                                <div className="expanded-more">
                                                    +{day.appointments.length - 8} more
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="expanded-action">
                                        Double-click to open day view
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
