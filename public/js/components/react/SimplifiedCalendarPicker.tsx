import { useState, useMemo, type ChangeEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import cn from 'classnames';
import { httpErrorMessage } from '@/core/http';
import { optionQuery, monthAvailabilityQuery, availableSlotsQuery } from '@/query/queries';
import styles from './SimplifiedCalendarPicker.module.css';

// Format a Date as YYYY-MM-DD in local time (avoids UTC conversion shifting the day).
const formatLocalDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

interface Appointment {
    patientName: string;
    appDetail?: string;
    [key: string]: unknown;
}

// GET /api/options/:name success shape ({ status:'success', optionName, value }).
interface OptionResponse {
    value?: string | null;
}

interface TimeSlot {
    date: string;
    time: string;
    slotStatus: 'available' | 'booked' | 'full' | 'past';
    appointments?: Appointment[];
}

interface DayAvailabilityInfo {
    availableCount: number;
    appointmentCount: number;
    isHoliday?: boolean;
    holidayName?: string | null;
}

interface DayInfo {
    date: Date;
    day: number;
    dateStr: string;
    isPast: boolean;
    isToday: boolean;
    isSelected: boolean;
    hasAvailability: boolean;
    availableCount: number;
    appointmentCount: number;
    isHoliday: boolean;
    holidayName: string | null;
}

interface SimplifiedCalendarPickerProps {
    onSelectDateTime: (dateTime: Date | string) => void;
    initialDate?: Date;
}

/**
 * SimplifiedCalendarPicker Component - CLEAN REWRITE
 *
 * Three-column layout:
 * LEFT: Monthly calendar
 * MIDDLE: Day schedule (2 slots per row grid)
 * RIGHT: Handled by parent (AppointmentForm)
 */

const SimplifiedCalendarPicker = ({ onSelectDateTime, initialDate = new Date() }: SimplifiedCalendarPickerProps) => {
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date(initialDate));
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [showAfternoonSlots, setShowAfternoonSlots] = useState(false);
    const [showExtendedSlotsDefault, setShowExtendedSlotsDefault] = useState(false);
    const [daysAhead, setDaysAhead] = useState('');
    const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

    // Early and late slot times (loaded from settings)
    const [earlySlotTimes, setEarlySlotTimes] = useState<string[]>(['12:00', '12:30', '13:00', '13:30']);
    const [lateSlotTimes, setLateSlotTimes] = useState<string[]>(['21:00', '21:30', '22:00', '22:30']);

    // Combined extended times for filtering (includes 14:00 and 14:30 which are also rarely used)
    const rareAfternoonTimes = useMemo(
        () => [...earlySlotTimes, '14:00', '14:30', ...lateSlotTimes],
        [earlySlotTimes, lateSlotTimes]
    );

    // --- Extended-slot settings (three option rows). optionQuery swallows a 404
    // to null, so a missing option falls back to its default below (the rows are
    // seeded today — audit N12/N20).
    const earlyOptionQuery = useQuery(optionQuery('CALENDAR_EARLY_SLOTS'));
    const lateOptionQuery = useQuery(optionQuery('CALENDAR_LATE_SLOTS'));
    const defaultOptionQuery = useQuery(optionQuery('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT'));

    // Seed the extended-slot settings from their option queries during render, keyed
    // on each query's result reference — no setState-in-effect.
    const [seededEarly, setSeededEarly] = useState<unknown>(null);
    if (earlyOptionQuery.data !== seededEarly) {
        setSeededEarly(earlyOptionQuery.data);
        const value = (earlyOptionQuery.data as OptionResponse | null | undefined)?.value;
        if (value) setEarlySlotTimes(value.split(',').filter(Boolean));
    }

    const [seededLate, setSeededLate] = useState<unknown>(null);
    if (lateOptionQuery.data !== seededLate) {
        setSeededLate(lateOptionQuery.data);
        const value = (lateOptionQuery.data as OptionResponse | null | undefined)?.value;
        if (value) setLateSlotTimes(value.split(',').filter(Boolean));
    }

    const [seededDefault, setSeededDefault] = useState<unknown>(null);
    if (defaultOptionQuery.data !== seededDefault) {
        setSeededDefault(defaultOptionQuery.data);
        const value = (defaultOptionQuery.data as OptionResponse | null | undefined)?.value;
        if (value != null) setShowExtendedSlotsDefault(value === 'true');
    }

    // --- Month availability, keyed on the viewed month's first/last day strings.
    const monthStartDate = formatLocalDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1));
    const monthEndDate = formatLocalDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0));
    const monthQuery = useQuery(monthAvailabilityQuery(monthStartDate, monthEndDate));
    const dayAvailability: Record<string, DayAvailabilityInfo> =
        (monthQuery.data?.availability as Record<string, DayAvailabilityInfo> | undefined) ?? {};

    // --- Available slots for the selected date, keyed on its YYYY-MM-DD string
    // (gated — the factory disables the query when no date is selected).
    const selectedDateStr = selectedDate ? formatLocalDate(selectedDate) : '';
    const slotsQuery = useQuery(availableSlotsQuery(selectedDateStr));
    const availableSlots: TimeSlot[] = (slotsQuery.data?.slots as TimeSlot[] | undefined) ?? [];

    // Slots loading/errors drive the day-schedule column; surface a month-fetch
    // error there too (it only shows once a date is picked). `isFetching` (not
    // `isLoading`) keeps the original per-click spinner on each date change.
    const loading = slotsQuery.isFetching;
    const error = slotsQuery.error
        ? httpErrorMessage(slotsQuery.error, 'Unknown error')
        : monthQuery.error
            ? httpErrorMessage(monthQuery.error, 'Unknown error')
            : null;

    // Auto-expand the extended slots when the default is on, or when any extended
    // slot already has appointments — re-runs when fresh slots arrive, the default
    // changes, or the extended-slot set changes (keyed adjust-during-render).
    const [autoExpandKey, setAutoExpandKey] = useState<{ data: unknown; def: boolean; rare: unknown }>(
        { data: null, def: showExtendedSlotsDefault, rare: rareAfternoonTimes }
    );
    if (
        autoExpandKey.data !== slotsQuery.data ||
        autoExpandKey.def !== showExtendedSlotsDefault ||
        autoExpandKey.rare !== rareAfternoonTimes
    ) {
        setAutoExpandKey({ data: slotsQuery.data, def: showExtendedSlotsDefault, rare: rareAfternoonTimes });
        const slots = (slotsQuery.data?.slots as TimeSlot[] | undefined) ?? [];
        const hasAppointmentsInExtendedSlots = slots.some(slot =>
            rareAfternoonTimes.includes(slot.time) &&
            slot.appointments &&
            slot.appointments.length > 0
        );
        setShowAfternoonSlots(showExtendedSlotsDefault || hasAppointmentsInExtendedSlots);
    }

    const handleDateClick = (date: Date) => {
        setSelectedDate(date);
    };

    const handleSlotClick = (slot: TimeSlot) => {
        setSelectedSlotKey(`${slot.date}T${slot.time}`);
        const dateTime = new Date(`${slot.date}T${slot.time}:00`);
        onSelectDateTime(dateTime);
    };

    // Clear the persistent selection marker when the day changes so it doesn't bleed
    // across days. The form retains the actual value.
    const [markerDay, setMarkerDay] = useState(selectedDate);
    if (markerDay !== selectedDate) {
        setMarkerDay(selectedDate);
        setSelectedSlotKey(null);
    }

    const goToPreviousMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
        setSelectedDate(null);
        setShowAfternoonSlots(false);
    };

    const goToNextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
        setSelectedDate(null);
        setShowAfternoonSlots(false);
    };

    const goToToday = () => {
        const today = new Date();
        setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        handleDateClick(today);
    };

    const handleJumpToDays = () => {
        const days = parseInt(daysAhead);
        if (!isNaN(days) && days >= 0) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + days);
            setCurrentMonth(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
            handleDateClick(targetDate);
            setDaysAhead(''); // Clear input after jump
        }
    };

    // Generate calendar days
    const generateCalendarDays = (): (DayInfo | null)[] => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay(); // 0 = Sunday, 6 = Saturday
        const daysInMonth = lastDay.getDate();
        const days: (DayInfo | null)[] = [];

        // Adjust start to Saturday (6) - if Saturday, offset is 0, if Sunday, offset is 1, etc.
        // The grid has 6 columns (Sat–Thu; Friday is omitted). When the 1st falls
        // on a Friday it isn't rendered, so the first shown day (Saturday) belongs
        // in column 0 — guard against (5+1)%7=6 producing an empty leading row.
        const offset = startDay === 5 ? 0 : (startDay + 1) % 7;
        for (let i = 0; i < offset; i++) {
            days.push(null);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dayOfWeek = date.getDay(); // 0 = Sunday, 5 = Friday

            // Skip Friday (5)
            if (dayOfWeek === 5) {
                continue;
            }

            // Format date in local timezone
            const dateYear = date.getFullYear();
            const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
            const dateDay = String(date.getDate()).padStart(2, '0');
            const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;
            const availability = dayAvailability[dateStr] || { availableCount: 0, appointmentCount: 0 };
            const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
            const isToday = date.toDateString() === new Date().toDateString();
            const isSelected = selectedDate !== null && date.toDateString() === selectedDate.toDateString();
            const hasAvailability = availability.availableCount > 0;
            const appointmentCount = availability.appointmentCount || 0;
            const isHoliday = availability.isHoliday || false;
            const holidayName = availability.holidayName || null;

            days.push({
                date,
                day,
                dateStr,
                isPast,
                isToday,
                isSelected,
                hasAvailability,
                availableCount: availability.availableCount,
                appointmentCount: appointmentCount,
                isHoliday,
                holidayName
            });
        }

        return days;
    };

    const calendarDays = generateCalendarDays();
    const monthNumber = currentMonth.getMonth() + 1;
    const monthNameOnly = currentMonth.toLocaleDateString(undefined, { month: 'long' });
    const year = currentMonth.getFullYear();
    const monthName = `${monthNumber}/${year}`;

    const renderSlot = (slot: TimeSlot) => {
        const isAvailable = slot.slotStatus === 'available';
        const isBooked = slot.slotStatus === 'booked';
        const isFull = slot.slotStatus === 'full';
        const isPast = slot.slotStatus === 'past';
        const canBook = isAvailable || isBooked;
        const slotKey = `${slot.date}T${slot.time}`;
        const isSelected = canBook && slotKey === selectedSlotKey;

        return (
            <div
                key={slot.time}
                className={cn(styles.timeSlot, {
                    [styles.available]: isAvailable,
                    [styles.booked]: isBooked,
                    [styles.full]: isFull,
                    [styles.past]: isPast,
                    [styles.clickable]: canBook,
                    [styles.selected]: isSelected
                })}
                role="button"
                tabIndex={0}
                onClick={() => canBook && handleSlotClick(slot)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); canBook && handleSlotClick(slot); } }}
            >
                <div className={styles.slotHeader}>
                    <span className={styles.slotTime}>{slot.time}</span>
                </div>

                {slot.appointments && slot.appointments.length > 0 ? (
                    <div className={styles.slotAppointments}>
                        {slot.appointments.map((apt, idx) => (
                            <div key={idx} className={styles.aptItem}>
                                <div className={styles.aptName}>{apt.patientName}</div>
                                <div className={styles.aptType}>{apt.appDetail}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.slotEmpty}>
                        <i className="fas fa-check-circle"></i> Available
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            {/* LEFT COLUMN: Monthly Calendar */}
            <div className={styles.calendarColumn}>
                {/* Jump to Days Ahead */}
                <div className={styles.jumpToDays}>
                    <input
                        type="number"
                        min="0"
                        placeholder="Days ahead..."
                        value={daysAhead}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setDaysAhead(e.target.value)}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleJumpToDays()}
                        className={styles.daysAheadInput}
                    />
                    <button className={styles.jumpBtn} onClick={handleJumpToDays} title="Jump to date">
                        <i className="fas fa-arrow-right"></i>
                    </button>
                </div>

                {/* View Full Calendar Button */}
                <Link to="/calendar" className={styles.fullCalendarLink}>
                    <i className="fas fa-calendar-alt"></i> Full Calendar
                </Link>

                <div className={styles.calendarHeader}>
                    <button className={styles.monthNavBtn} onClick={goToPreviousMonth}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className={styles.monthDisplay}>
                        <h3 className={styles.monthName}>{monthName}</h3>
                        <div className={styles.monthNameText}>{monthNameOnly}</div>
                    </div>
                    <button className={styles.monthNavBtn} onClick={goToNextMonth}>
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>

                <div className={styles.calendarWeekdays}>
                    {['S', 'S', 'M', 'T', 'W', 'T'].map((day, i) => (
                        <div key={i} className={styles.weekday}>{day}</div>
                    ))}
                </div>

                <div className={styles.calendarDays}>
                    {calendarDays.map((dayInfo, index) => {
                        if (!dayInfo) {
                            return <div key={`empty-${index}`} className={cn(styles.calendarDay, styles.empty)}></div>;
                        }

                        // Holiday days are not clickable
                        const isClickable = !dayInfo.isPast && dayInfo.hasAvailability && !dayInfo.isHoliday;

                        // Build tooltip
                        let tooltip: string;
                        if (dayInfo.isHoliday) {
                            tooltip = dayInfo.holidayName || 'Holiday';
                        } else if (dayInfo.appointmentCount > 0) {
                            tooltip = `${dayInfo.appointmentCount} appointments`;
                        } else {
                            tooltip = 'No appointments';
                        }

                        return (
                            <div
                                key={dayInfo.dateStr}
                                className={cn(styles.calendarDay, {
                                    [styles.past]: dayInfo.isPast,
                                    [styles.today]: dayInfo.isToday,
                                    [styles.selected]: dayInfo.isSelected,
                                    [styles.holiday]: dayInfo.isHoliday,
                                    [styles.hasSlots]: dayInfo.hasAvailability && !dayInfo.isHoliday,
                                    [styles.clickable]: isClickable
                                })}
                                role="button"
                                tabIndex={0}
                                onClick={() => isClickable && handleDateClick(dayInfo.date)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isClickable && handleDateClick(dayInfo.date); } }}
                                title={tooltip}
                            >
                                <span className={styles.dayNum}>{dayInfo.day}</span>
                                {dayInfo.isHoliday && (
                                    <span className={styles.holidayIndicator}><i className="fas fa-star"></i></span>
                                )}
                                {dayInfo.appointmentCount > 0 && !dayInfo.isPast && !dayInfo.isHoliday && (
                                    <span className={styles.slotCount}>{dayInfo.appointmentCount}</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <button className={styles.todayBtn} onClick={goToToday}>
                    <i className="fas fa-calendar-day"></i> Today
                </button>
            </div>

            {/* MIDDLE COLUMN: Day Schedule */}
            <div className={styles.scheduleColumn}>
                {!selectedDate ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-hand-pointer"></i>
                        <p>Select a date to view available time slots</p>
                    </div>
                ) : loading ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-spinner fa-spin"></i>
                        <p>Loading...</p>
                    </div>
                ) : error ? (
                    <div className={cn(styles.emptyState, styles.error)}>
                        <i className="fas fa-exclamation-triangle"></i>
                        <p>{error}</p>
                    </div>
                ) : availableSlots.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-calendar-times"></i>
                        <p>No slots for this date</p>
                    </div>
                ) : (
                    <>
                        <div className={styles.scheduleHeader}>
                            <h3>
                                {selectedDate.toLocaleDateString(undefined, {
                                    weekday: 'long',
                                    month: 'short',
                                    day: 'numeric'
                                })}
                            </h3>
                            <span className={styles.availableCount}>
                                {availableSlots.filter(s => s.slotStatus === 'available' || s.slotStatus === 'booked').length} available
                            </span>
                        </div>

                        <div className={styles.slotsGrid}>
                            {(() => {
                                // Separate slots into early, regular, and late
                                const earlySlots: TimeSlot[] = [];
                                const regularSlots: TimeSlot[] = [];
                                const lateSlots: TimeSlot[] = [];
                                const emptyExtendedSlots: TimeSlot[] = [];

                                // Extended times include 14:00 and 14:30 as early
                                const extendedEarlyTimes = [...earlySlotTimes, '14:00', '14:30'];

                                availableSlots.forEach(slot => {
                                    if (extendedEarlyTimes.includes(slot.time)) {
                                        earlySlots.push(slot);
                                        if (!slot.appointments || slot.appointments.length === 0) {
                                            emptyExtendedSlots.push(slot);
                                        }
                                    } else if (lateSlotTimes.includes(slot.time)) {
                                        lateSlots.push(slot);
                                        if (!slot.appointments || slot.appointments.length === 0) {
                                            emptyExtendedSlots.push(slot);
                                        }
                                    } else {
                                        regularSlots.push(slot);
                                    }
                                });

                                const hasEmptyExtendedSlots = emptyExtendedSlots.length > 0;

                                return (
                                    <>
                                        {hasEmptyExtendedSlots && (
                                            <div
                                                className={styles.afternoonToggle}
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => setShowAfternoonSlots(!showAfternoonSlots)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowAfternoonSlots(!showAfternoonSlots); } }}
                                            >
                                                <div className={styles.afternoonToggleText}>
                                                    <i className="fas fa-clock"></i>
                                                    {showAfternoonSlots ? 'Hide' : 'Show'} early & late slots
                                                </div>
                                                <i className={cn('fas fa-chevron-down', styles.afternoonToggleIcon, { [styles.expanded]: showAfternoonSlots })}></i>
                                            </div>
                                        )}

                                        {/* Early slots (12:00-14:30) */}
                                        {showAfternoonSlots && earlySlots.map(renderSlot)}

                                        {/* Regular slots (15:00-20:30) - always shown */}
                                        {regularSlots.map(renderSlot)}

                                        {/* Late slots (21:00-22:30) */}
                                        {showAfternoonSlots && lateSlots.map(renderSlot)}

                                        {/* Fallback: show extended slots if all have appointments */}
                                        {!hasEmptyExtendedSlots && earlySlots.map(renderSlot)}
                                        {!hasEmptyExtendedSlots && lateSlots.map(renderSlot)}
                                    </>
                                );
                            })()}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SimplifiedCalendarPicker;
