/**
 * MonthlyCalendarGrid Component
 *
 * Renders a monthly calendar view with clean appointment indicators
 * Week starts from Saturday as per configuration
 */

import { useState, useEffect, useRef, type MouseEvent } from 'react';
import type { CalendarDay, CalendarData, CalendarAppointment, CalendarMode } from './calendar.types';
import styles from './MonthlyCalendarGrid.module.css';

interface MonthlyCalendarGridProps {
    calendarData: CalendarData | null;
    onDayClick?: (day: CalendarDay) => void;
    onDayContextMenu?: (day: CalendarDay, event: MouseEvent<HTMLDivElement>) => void;
    currentDate: Date;
    mode?: CalendarMode;
}

const MonthlyCalendarGrid = ({
    calendarData,
    onDayClick,
    onDayContextMenu,
    currentDate,
    mode = 'view'
}: MonthlyCalendarGridProps) => {
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    // Close expanded panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: globalThis.MouseEvent) => {
            if (expandedDay && gridRef.current && !(e.target as Element).closest('.month-day-cell')) {
                setExpandedDay(null);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [expandedDay]);

    if (!calendarData || !calendarData.days) {
        return (
            <div className={`${styles.monthlyCalendarGrid} ${styles.loading}`}>
                <p>Loading monthly data...</p>
            </div>
        );
    }

    const { days } = calendarData;

    // Helper to check if date is today
    const isToday = (date: string): boolean => {
        const today = new Date();
        const checkDate = new Date(date);
        return today.toDateString() === checkDate.toDateString();
    };

    // Helper to check if day is weekend (Saturday or Sunday)
    const isWeekend = (date: string): boolean => {
        const day = new Date(date).getDay();
        return day === 0 || day === 6; // Sunday = 0, Saturday = 6
    };

    // Helper to check if day is in current month
    const isCurrentMonth = (date: string): boolean => {
        const checkDate = new Date(date);
        const current = new Date(currentDate);
        return checkDate.getMonth() === current.getMonth() &&
               checkDate.getFullYear() === current.getFullYear();
    };

    // Day headers (starting with Saturday, excluding Friday)
    const dayHeaders = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

    return (
        <div className={styles.monthlyCalendarGrid} ref={gridRef}>
            {/* Day headers */}
            <div className={styles.monthGridHeader}>
                {dayHeaders.map(day => (
                    <div key={day} className={styles.monthDayHeader}>
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar days */}
            <div className={styles.monthGridBody}>
                {days.map(day => {
                    const appointmentCount = day.appointmentCount || 0;
                    const currentMonth = isCurrentMonth(day.date);
                    const todayClass = isToday(day.date);
                    const weekendClass = isWeekend(day.date);
                    const isHoliday = day.isHoliday || false;

                    const isExpanded = expandedDay === day.date;

                    const cellClasses = [
                        styles.monthDayCell,
                        !currentMonth ? styles.otherMonth : '',
                        todayClass ? styles.today : '',
                        weekendClass ? styles.weekend : '',
                        appointmentCount > 0 ? styles.hasAppointments : '',
                        isHoliday ? styles.holiday : '',
                        isExpanded ? styles.expanded : ''
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
                    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
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
                            <div className={styles.monthDayNumber}>
                                {new Date(day.date).getDate()}
                            </div>

                            {/* Holiday badge */}
                            {currentMonth && isHoliday && (
                                <div className={styles.holidayBadge} title={day.holidayName}>
                                    <i className="fas fa-calendar-times"></i>
                                </div>
                            )}

                            {/* Appointment badge - Clean neutral styling via CSS */}
                            {currentMonth && !isHoliday && appointmentCount > 0 && (
                                <div className={styles.appointmentBadge}>
                                    {appointmentCount}
                                </div>
                            )}

                            {/* Expanded appointment list (shows on click) */}
                            {isExpanded && currentMonth && !isHoliday && appointmentCount > 0 && (
                                <div className={styles.dayExpandedPanel}>
                                    <div className={styles.expandedHeader}>
                                        {new Date(day.date).toLocaleDateString('en-US', {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric'
                                        })}
                                        <span className={styles.expandedCount}>{appointmentCount} appts</span>
                                    </div>
                                    {day.appointments && Array.isArray(day.appointments) && day.appointments.length > 0 && (
                                        <div className={styles.expandedAppointments}>
                                            {(day.appointments as CalendarAppointment[]).slice(0, 8).map((apt, idx) => (
                                                <div key={idx} className={styles.expandedAppointment}>
                                                    <span className={styles.aptTime}>{apt.time || ''}</span>
                                                    <span className={styles.aptName}>{apt.patientName || ''}</span>
                                                </div>
                                            ))}
                                            {day.appointments.length > 8 && (
                                                <div className={styles.expandedMore}>
                                                    +{day.appointments.length - 8} more
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className={styles.expandedAction}>
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
