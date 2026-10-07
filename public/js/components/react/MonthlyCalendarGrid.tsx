/**
 * MonthlyCalendarGrid Component
 *
 * Renders a monthly calendar view with clean appointment indicators.
 *
 * The clinic works a SIX-day week, Sat–Thu, with **Friday** the only day off —
 * so the grid has six columns and `CalendarViewService` never emits a Friday
 * (`if (d.getDay() === 5) continue`). Every cell rendered here is therefore a
 * WORKING day: there is no weekend cell to tint, which is why this component has
 * no weekend styling. It used to shade `getDay() === 0 || === 6` — the Western
 * Sat+Sun weekend — which greyed out two of the busiest days of the week.
 */

import { useState, useEffect, useRef, type MouseEvent } from 'react';
import type { CalendarDay, CalendarData, CalendarAppointment } from './calendar.types';
import { formatTime12, formatLocaleDate } from '../../utils/formatters';
import { parseLocalDate, toLocalDateString } from '../../utils/calendarDate';
import { anchorFrom, type MenuAnchor } from '../../hooks/useFloatingMenu';
import { useToday } from '../../hooks/useClock';
import styles from './MonthlyCalendarGrid.module.css';

interface MonthlyCalendarGridProps {
    calendarData: CalendarData | null;
    onOpenDay: (day: CalendarDay) => void;
    /** The day's menu (holiday actions); omitted when the user has none to offer. */
    onDayMenu?: (day: CalendarDay, anchor: MenuAnchor) => void;
    currentDate: Date;
}

const DAY_HEADERS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

const MonthlyCalendarGrid = ({
    calendarData,
    onOpenDay,
    onDayMenu,
    currentDate
}: MonthlyCalendarGridProps) => {
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    // From the clock store, not `new Date()`: compiled, a render-time clock read
    // is cached at mount and the highlight never leaves the day the page opened
    // on (FE-F26-2).
    const today = useToday();

    // Close expanded panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: globalThis.MouseEvent) => {
            if (expandedDay && gridRef.current && !(e.target as Element).closest('[data-month-cell]')) {
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
    const current = parseLocalDate(currentDate);

    return (
        <div className={styles.monthlyCalendarGrid} ref={gridRef}>
            {/* Day headers (starting with Saturday, excluding Friday) */}
            <div className={styles.monthGridHeader}>
                {DAY_HEADERS.map(day => (
                    <div key={day} className={styles.monthDayHeader}>
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar days */}
            <div className={styles.monthGridBody}>
                {days.map(day => {
                    const date = parseLocalDate(day.date);
                    const appointmentCount = day.appointmentCount || 0;
                    const currentMonth =
                        date.getMonth() === current.getMonth() &&
                        date.getFullYear() === current.getFullYear();
                    const isToday = toLocalDateString(date) === today;
                    const isHoliday = day.isHoliday || false;
                    const isExpanded = expandedDay === day.date;
                    const appointments = Array.isArray(day.appointments)
                        ? (day.appointments as CalendarAppointment[])
                        : [];

                    const cellClasses = [
                        styles.monthDayCell,
                        !currentMonth ? styles.otherMonth : '',
                        isToday ? styles.today : '',
                        isHoliday ? styles.holiday : '',
                        isExpanded ? styles.expanded : ''
                    ].filter(Boolean).join(' ');

                    // Click (or Enter) opens the day's panel — every day of the month,
                    // holidays included: a holiday declared over bookings still lists
                    // them, and the panel is the keyboard and touch path to day view and
                    // the day's menu (audit FE-F10-3, FE-F10-15d).
                    const togglePanel = () => {
                        if (!currentMonth) return;
                        setExpandedDay(isExpanded ? null : day.date);
                    };

                    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
                        if (!currentMonth || !onDayMenu) return;
                        event.preventDefault();
                        onDayMenu(day, anchorFrom(event));
                    };

                    return (
                        <div
                            key={day.date}
                            className={cellClasses}
                            data-month-cell
                            role="button"
                            tabIndex={currentMonth ? 0 : -1}
                            // A day of the neighbouring month is a dimmed placeholder: no
                            // click, no tab stop. Say so, or it is announced as a live button.
                            aria-disabled={!currentMonth || undefined}
                            aria-expanded={isExpanded}
                            onClick={togglePanel}
                            onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
                            }}
                            onDoubleClick={() => currentMonth && onOpenDay(day)}
                            onContextMenu={handleContextMenu}
                            title={isHoliday ? day.holidayName ?? undefined : undefined}
                        >
                            {/* Day number */}
                            <div className={styles.monthDayNumber}>
                                {date.getDate()}
                            </div>

                            {/* Holiday badge */}
                            {currentMonth && isHoliday && (
                                <div className={styles.holidayBadge} title={day.holidayName ?? undefined}>
                                    <i className="fas fa-calendar-times" aria-hidden="true"></i>
                                </div>
                            )}

                            {/* Appointment badge — on a holiday too, beside the holiday mark */}
                            {currentMonth && appointmentCount > 0 && (
                                <div className={`${styles.appointmentBadge} ${isHoliday ? styles.besideHoliday : ''}`}>
                                    {appointmentCount}
                                </div>
                            )}

                            {isExpanded && currentMonth && (
                                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stops the panel's clicks from toggling the cell; its buttons carry their own keyboard handling
                                <div className={styles.dayExpandedPanel} onClick={e => e.stopPropagation()}>
                                    <div className={styles.expandedHeader}>
                                        {formatLocaleDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}
                                        <span className={styles.expandedCount}>
                                            {isHoliday ? `${day.holidayName || 'Holiday'} · ` : ''}
                                            {appointmentCount} appt{appointmentCount === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    {appointments.length > 0 && (
                                        <div className={styles.expandedAppointments}>
                                            {appointments.slice(0, 8).map((apt, idx) => (
                                                <div key={apt.appointment_id ?? idx} className={styles.expandedAppointment}>
                                                    <span className={styles.aptTime}>{formatTime12(apt.time)}</span>
                                                    <span className={styles.aptName}>{apt.patientName || ''}</span>
                                                </div>
                                            ))}
                                            {appointments.length > 8 && (
                                                <div className={styles.expandedMore}>
                                                    +{appointments.length - 8} more
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className={styles.expandedAction}>
                                        <button type="button" className={styles.panelButton} onClick={() => onOpenDay(day)}>
                                            <i className="fas fa-calendar-day" aria-hidden="true"></i> Open day view
                                        </button>
                                        {onDayMenu && (
                                            <button
                                                type="button"
                                                className={styles.panelButton}
                                                aria-haspopup="menu"
                                                onClick={e => onDayMenu(day, anchorFrom(e))}
                                            >
                                                <i className="fas fa-calendar-times" aria-hidden="true"></i> Holiday…
                                            </button>
                                        )}
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
