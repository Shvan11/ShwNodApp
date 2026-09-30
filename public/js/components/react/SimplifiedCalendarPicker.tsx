import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import { useLanguage } from '@/contexts/LanguageContext';
import { httpErrorMessage } from '@/core/http';
import { calendarWeekdayHeaders, formatClockTime, formatMonthName, formatScheduleDate } from '@/utils/formatters';
import { toLocalDateString } from '@/utils/calendarDate';
import { optionQuery, monthAvailabilityQuery, availableSlotsQuery } from '@/query/queries';
import type { AvailableSlotsResponse, MonthAvailabilityResponse } from '@shared/contracts/calendar.contract';
import styles from './SimplifiedCalendarPicker.module.css';

type TimeSlot = AvailableSlotsResponse['slots'][number];
type DayAvailability = MonthAvailabilityResponse['availability'][string];

interface DayInfo {
    date: Date;
    day: number;
    dateStr: string;
    isPast: boolean;
    isToday: boolean;
    isSelected: boolean;
    hasAvailability: boolean;
    appointmentCount: number;
    isHoliday: boolean;
    holidayName: string | null;
}

interface SimplifiedCalendarPickerProps {
    /** A slot was picked: its local 'YYYY-MM-DD' and 'HH:MM'. */
    onSelectDateTime: (date: string, time: string) => void;
    initialDate?: Date;
}

/** A comma-separated option value ('12:00,12:30') as a list. Missing/blank → none. */
const parseTimes = (value: string | null | undefined): string[] =>
    value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];

/**
 * SimplifiedCalendarPicker — the booking forms' month + day-schedule columns
 * (the details column is `BookingForm`'s).
 *
 * The early/late ("extended") slots come from Settings → Calendar Times alone.
 * The picker used to add `14:00`/`14:30` as "rarely used" whatever the settings
 * said, and fell back to this clinic's own early/late lists when the options were
 * missing — which they are on every fresh install — so a new center's midday
 * hid behind "Show early & late slots" (audit FE-F10-11). Missing options now
 * mean "nothing is extended", exactly as the calendar grid reads them.
 */
const SimplifiedCalendarPicker = ({ onSelectDateTime, initialDate }: SimplifiedCalendarPickerProps) => {
    const { t } = useTranslation('appointments');
    const { language } = useLanguage();
    const [currentMonth, setCurrentMonth] = useState<Date>(() => {
        const d = initialDate ?? new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1);
    });
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [showExtendedSlots, setShowExtendedSlots] = useState(false);
    const [daysAhead, setDaysAhead] = useState('');
    const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

    // --- Extended-slot settings (three option rows; optionQuery turns a 404 into null).
    const earlyOption = useQuery(optionQuery('CALENDAR_EARLY_SLOTS'));
    const lateOption = useQuery(optionQuery('CALENDAR_LATE_SLOTS'));
    const defaultOption = useQuery(optionQuery('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT'));
    const extendedTimes = new Set([
        ...parseTimes(earlyOption.data?.value),
        ...parseTimes(lateOption.data?.value),
    ]);
    const showExtendedByDefault = defaultOption.data?.value === 'true';

    // --- Month availability, keyed on the viewed month's first/last day strings.
    const monthStartDate = toLocalDateString(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1));
    const monthEndDate = toLocalDateString(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0));
    const monthQuery = useQuery(monthAvailabilityQuery(monthStartDate, monthEndDate));
    const dayAvailability: Record<string, DayAvailability> = monthQuery.data?.availability ?? {};

    // --- Available slots for the selected date (the factory is disabled until one is picked).
    const selectedDateStr = selectedDate ? toLocalDateString(selectedDate) : '';
    const slotsQuery = useQuery(availableSlotsQuery(selectedDateStr));
    const availableSlots: TimeSlot[] = slotsQuery.data?.slots ?? [];

    // `isFetching` (not `isLoading`) keeps a spinner on each date change.
    const loading = slotsQuery.isFetching;
    const failed = slotsQuery.error ?? monthQuery.error;
    const error = failed ? httpErrorMessage(failed, t('calendar.loadFailed')) : null;

    // Auto-expand the extended slots when the default is on, or when one of them
    // already has appointments — re-run when fresh slots arrive or the default
    // changes (keyed adjust-during-render).
    const [autoExpandKey, setAutoExpandKey] = useState<{ data: unknown; def: boolean; early: unknown; late: unknown }>(
        { data: null, def: showExtendedByDefault, early: null, late: null }
    );
    if (
        autoExpandKey.data !== slotsQuery.data ||
        autoExpandKey.def !== showExtendedByDefault ||
        autoExpandKey.early !== earlyOption.data ||
        autoExpandKey.late !== lateOption.data
    ) {
        setAutoExpandKey({ data: slotsQuery.data, def: showExtendedByDefault, early: earlyOption.data, late: lateOption.data });
        const bookedExtended = availableSlots.some(
            slot => extendedTimes.has(slot.time) && slot.appointments.length > 0
        );
        setShowExtendedSlots(showExtendedByDefault || bookedExtended);
    }

    const handleSlotClick = (slot: TimeSlot) => {
        setSelectedSlotKey(`${slot.date}T${slot.time}`);
        onSelectDateTime(slot.date, slot.time);
    };

    // Clear the persistent selection marker when the day changes so it doesn't bleed
    // across days. The form retains the actual value.
    const [markerDay, setMarkerDay] = useState(selectedDate);
    if (markerDay !== selectedDate) {
        setMarkerDay(selectedDate);
        setSelectedSlotKey(null);
    }

    const showMonth = (delta: number) => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
        setSelectedDate(null);
        setShowExtendedSlots(false);
    };

    const goToDate = (target: Date) => {
        setCurrentMonth(new Date(target.getFullYear(), target.getMonth(), 1));
        setSelectedDate(target);
    };

    const handleJumpToDays = () => {
        const days = parseInt(daysAhead, 10);
        if (!isNaN(days) && days >= 0) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + days);
            goToDate(targetDate);
            setDaysAhead('');
        }
    };

    // Generate calendar days
    const generateCalendarDays = (): (DayInfo | null)[] => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const startDay = new Date(year, month, 1).getDay(); // 0 = Sunday, 6 = Saturday
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
        const todayString = new Date().toDateString();
        const days: (DayInfo | null)[] = [];

        // The grid has 6 columns (Sat–Thu; Friday is omitted). When the 1st falls
        // on a Friday it isn't rendered, so the first shown day (Saturday) belongs
        // in column 0 — guard against (5+1)%7=6 producing an empty leading row.
        const offset = startDay === 5 ? 0 : (startDay + 1) % 7;
        for (let i = 0; i < offset; i++) days.push(null);

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            if (date.getDay() === 5) continue; // Friday

            const dateStr = toLocalDateString(date);
            const availability = dayAvailability[dateStr];
            days.push({
                date,
                day,
                dateStr,
                isPast: date < todayMidnight,
                isToday: date.toDateString() === todayString,
                isSelected: selectedDate !== null && date.toDateString() === selectedDate.toDateString(),
                hasAvailability: (availability?.availableCount ?? 0) > 0,
                appointmentCount: availability?.appointmentCount ?? 0,
                isHoliday: availability?.isHoliday ?? false,
                holidayName: availability?.holidayName ?? null
            });
        }

        return days;
    };

    const calendarDays = generateCalendarDays();
    const monthNameOnly = formatMonthName(currentMonth, language);
    const monthName = `${currentMonth.getMonth() + 1}/${currentMonth.getFullYear()}`;

    const renderSlot = (slot: TimeSlot) => {
        const isAvailable = slot.slotStatus === 'available';
        const isBooked = slot.slotStatus === 'booked';
        const canBook = isAvailable || isBooked;
        const isSelected = canBook && `${slot.date}T${slot.time}` === selectedSlotKey;

        return (
            <div
                key={slot.time}
                className={cn(styles.timeSlot, {
                    [styles.available]: isAvailable,
                    [styles.booked]: isBooked,
                    [styles.full]: slot.slotStatus === 'full',
                    [styles.past]: slot.slotStatus === 'past',
                    [styles.clickable]: canBook,
                    [styles.selected]: isSelected
                })}
                role="button"
                tabIndex={canBook ? 0 : -1}
                aria-disabled={!canBook}
                onClick={() => canBook && handleSlotClick(slot)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); canBook && handleSlotClick(slot); } }}
            >
                <div className={styles.slotHeader}>
                    {/* 12-hour with the language's marker, like the form's readout (FE-F10-17). */}
                    <span className={styles.slotTime}>{formatClockTime(slot.time, language)}</span>
                </div>

                {slot.appointments.length > 0 ? (
                    <div className={styles.slotAppointments}>
                        {slot.appointments.map((apt, idx) => (
                            <div key={apt.appointment_id ?? idx} className={styles.aptItem}>
                                <div className={styles.aptName}>{apt.patientName}</div>
                                <div className={styles.aptType}>{apt.appDetail}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.slotEmpty}>
                        <i className="fas fa-check-circle"></i> {t('calendar.slotAvailable')}
                    </div>
                )}
            </div>
        );
    };

    // The day's slots in time order. An extended slot is shown while the section
    // is expanded, or always when it is booked-out (no toggle can reveal it then).
    // They used to be rendered in three groups plus a fallback, and on a day
    // where every extended slot was booked the fallback drew them a second time,
    // with duplicate keys (audit FE-F10-12).
    const hasEmptyExtended = availableSlots.some(
        slot => extendedTimes.has(slot.time) && slot.appointments.length === 0
    );
    const extendedVisible = showExtendedSlots || !hasEmptyExtended;
    const visibleSlots = availableSlots.filter(slot => extendedVisible || !extendedTimes.has(slot.time));

    return (
        <div className={styles.container}>
            {/* LEFT COLUMN: Monthly Calendar */}
            <div className={styles.calendarColumn}>
                {/* Jump to Days Ahead */}
                <div className={styles.jumpToDays}>
                    <input
                        type="number"
                        min="0"
                        placeholder={t('calendar.daysAheadPlaceholder')}
                        aria-label={t('calendar.daysAheadPlaceholder')}
                        value={daysAhead}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setDaysAhead(e.target.value)}
                        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleJumpToDays()}
                        className={styles.daysAheadInput}
                    />
                    <button
                        type="button"
                        className={styles.jumpBtn}
                        onClick={handleJumpToDays}
                        title={t('calendar.jumpToDate')}
                        aria-label={t('calendar.jumpToDate')}
                    >
                        <i className="fas fa-arrow-right" aria-hidden="true"></i>
                    </button>
                </div>

                {/* View Full Calendar Button */}
                <Link to="/calendar" className={styles.fullCalendarLink}>
                    <i className="fas fa-calendar-alt"></i> {t('calendar.fullCalendar')}
                </Link>

                <div className={styles.calendarHeader}>
                    <button
                        type="button"
                        className={styles.monthNavBtn}
                        onClick={() => showMonth(-1)}
                        aria-label={t('calendar.previousMonth')}
                        title={t('calendar.previousMonth')}
                    >
                        <i className="fas fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <div className={styles.monthDisplay}>
                        <h3 className={styles.monthName}>{monthName}</h3>
                        <div className={styles.monthNameText}>{monthNameOnly}</div>
                    </div>
                    <button
                        type="button"
                        className={styles.monthNavBtn}
                        onClick={() => showMonth(1)}
                        aria-label={t('calendar.nextMonth')}
                        title={t('calendar.nextMonth')}
                    >
                        <i className="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>
                </div>

                <div className={styles.calendarWeekdays}>
                    {calendarWeekdayHeaders(language).map((day, i) => (
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

                        let tooltip: string;
                        if (dayInfo.isHoliday) {
                            tooltip = dayInfo.holidayName || t('calendar.holiday');
                        } else if (dayInfo.appointmentCount > 0) {
                            tooltip = t('calendar.appointmentsCount', { count: dayInfo.appointmentCount });
                        } else {
                            tooltip = t('calendar.noAppointmentsTooltip');
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
                                tabIndex={isClickable ? 0 : -1}
                                aria-disabled={!isClickable}
                                onClick={() => isClickable && setSelectedDate(dayInfo.date)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isClickable && setSelectedDate(dayInfo.date); } }}
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

                <button type="button" className={styles.todayBtn} onClick={() => goToDate(new Date())}>
                    <i className="fas fa-calendar-day"></i> {t('header.today')}
                </button>
            </div>

            {/* MIDDLE COLUMN: Day Schedule */}
            <div className={styles.scheduleColumn}>
                {!selectedDate ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-hand-pointer"></i>
                        <p>{t('calendar.selectDatePrompt')}</p>
                    </div>
                ) : loading ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-spinner fa-spin"></i>
                        <p>{t('calendar.loading')}</p>
                    </div>
                ) : error ? (
                    <div className={cn(styles.emptyState, styles.error)}>
                        <i className="fas fa-exclamation-triangle"></i>
                        <p>{error}</p>
                    </div>
                ) : availableSlots.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-calendar-times"></i>
                        <p>{t('calendar.noSlots')}</p>
                    </div>
                ) : (
                    <>
                        <div className={styles.scheduleHeader}>
                            <h3>
                                {formatScheduleDate(selectedDate, language)}
                            </h3>
                            <span className={styles.availableCount}>
                                {t('calendar.available', { count: availableSlots.filter(s => s.slotStatus === 'available' || s.slotStatus === 'booked').length })}
                            </span>
                        </div>

                        <div className={styles.slotsGrid}>
                            {hasEmptyExtended && (
                                <button
                                    type="button"
                                    className={styles.afternoonToggle}
                                    aria-expanded={showExtendedSlots}
                                    onClick={() => setShowExtendedSlots(!showExtendedSlots)}
                                >
                                    <span className={styles.afternoonToggleText}>
                                        <i className="fas fa-clock"></i>
                                        {showExtendedSlots ? t('calendar.hideExtended') : t('calendar.showExtended')}
                                    </span>
                                    <i className={cn('fas fa-chevron-down', styles.afternoonToggleIcon, { [styles.expanded]: showExtendedSlots })}></i>
                                </button>
                            )}
                            {visibleSlots.map(renderSlot)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SimplifiedCalendarPicker;
