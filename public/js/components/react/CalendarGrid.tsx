/**
 * CalendarGrid Component for Appointment Calendar
 *
 * Renders the week/day grid on a uniform 112px slot system, zebra-banded by
 * row. Appointment cards pack adaptively (1/2/3/4/5+) and support
 * drag-to-reschedule plus a "+N more" popover for crowded slots.
 */

import { useEffect } from 'react';
import type { Dispatch, DragEvent, KeyboardEvent, MouseEvent, Ref, SetStateAction } from 'react';
import { to12Hour, formatTime12 } from '../../utils/formatters';
import { parseLocalDate } from '../../utils/calendarDate';
import { anchorFrom, type MenuAnchor } from '../../hooks/useFloatingMenu';
import { useToday, useNowMinute } from '../../hooks/useClock';
import type {
    CalendarDay,
    CalendarData,
    CalendarAppointment,
    CalendarSlotInfo,
    ViewMode,
    DoctorColor
} from './calendar.types';

/* On-the-hour rows tinted, half-hour rows clear. The label shares its row's
   shade, so each row (label + every day cell) reads as one horizontal band. */
const zebraFor = (t: string): string => (t.endsWith(':00') ? 'var(--cal-zebra)' : 'transparent');

/* Per-doctor card tint comes from the `doctorColors` prop (see doctorColors.ts),
   so the grid, the legend and Employee Settings stay in sync. A drID absent from
   the map renders neutral. */
const EMPTY_DOCTOR_COLORS: Map<number, DoctorColor> = new Map();

export interface DropTarget {
    date: string;
    time: string;
    /** A holiday or a slot already in the past: nothing may be dropped there. */
    forbidden?: boolean;
}

export interface MoreMenu {
    date: string;
    time: string;
}

interface CalendarGridProps {
    calendarData: CalendarData | null;
    onAppointmentClick: (
        appt: CalendarAppointment,
        date: string,
        time: string,
        anchor: MenuAnchor
    ) => void;
    /** Right-click, click or Enter on a day header. */
    onDayMenu: (day: CalendarDay, anchor: MenuAnchor) => void;
    viewMode?: ViewMode;
    doctorColors?: Map<number, DoctorColor>;
    /* When a doctor filter is active the grid goes mostly empty, so collapse it
       to only the time rows that still hold an appointment in the visible days. */
    hideEmptySlots?: boolean;
    draggingId: string | null;
    setDraggingId: Dispatch<SetStateAction<string | null>>;
    dropTarget: DropTarget | null;
    setDropTarget: Dispatch<SetStateAction<DropTarget | null>>;
    moreMenu: MoreMenu | null;
    setMoreMenu: Dispatch<SetStateAction<MoreMenu | null>>;
    onReschedule: (
        appointmentID: number | string,
        newDate: string,
        newTime: string,
        appt: CalendarAppointment,
        fromDate: string
    ) => void;
    /* Forwarded onto the scrolling .cal-board so the parent can measure the
       available height/width for Fit-to-screen zoom. */
    boardRef?: Ref<HTMLDivElement>;
}

const extractAppointments = (
    slotData: CalendarSlotInfo | CalendarAppointment[] | undefined
): CalendarAppointment[] => {
    if (!slotData) return [];
    if (Array.isArray(slotData)) return slotData;
    return slotData.appointments || [];
};

const validOnly = (appts: CalendarAppointment[]): CalendarAppointment[] =>
    appts.filter(a => a && (a.patientName || a.appointment_id));

// Both take the clock as an ARGUMENT (the component reads it through useClock).
// They used to call `new Date()` themselves, from render: the React Compiler
// caches a render block on its inputs, and the clock was not one, so a calendar
// left open overnight kept yesterday's column as "today" and a slot stayed
// "future" after its time had passed, until a week step or an appointment write
// changed `days` (audit FE-F26-8, the week-grid twin of FE-F26-2).
const isToday = (date: string, today: string): boolean => date.slice(0, 10) === today;

/** `nowMinute` is floored to the minute, so a slot is past from its own minute on. */
const isPastSlot = (date: string, time: string, nowMinute: number): boolean =>
    new Date(`${date}T${time}:00`).getTime() <= nowMinute;

const onActivate = (action: (e: KeyboardEvent<HTMLElement>) => void) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        action(e);
    }
};

const CalendarGrid = ({
    calendarData,
    onAppointmentClick,
    onDayMenu,
    viewMode = 'week',
    doctorColors = EMPTY_DOCTOR_COLORS,
    hideEmptySlots = false,
    draggingId,
    setDraggingId,
    dropTarget,
    setDropTarget,
    moreMenu,
    setMoreMenu,
    onReschedule,
    boardRef
}: CalendarGridProps) => {
    const { days = [] } = calendarData || {};
    // The clock as state: the "today" column moves at midnight and a slot turns
    // past on its minute, with no data change needed (see isToday / isPastSlot).
    const today = useToday();
    const nowMinute = useNowMinute();

    // Close the "+N more" popover on outside click or Escape.
    useEffect(() => {
        if (!moreMenu) return;
        const onMouseDown = (e: globalThis.MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.cal-popover') || target.closest('.cal-more-cell')) return;
            setMoreMenu(null);
        };
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setMoreMenu(null);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [moreMenu, setMoreMenu]);

    if (!calendarData || !days.length) {
        return (
            <div className="cal-board">
                <div className="cal-grid loading">
                    <p>Loading calendar data...</p>
                </div>
            </div>
        );
    }

    // Render every day the parent fetched — the column count IS the zoom level
    // (1 for a single day, N for the density-zoom Week). Columns are 1fr so they
    // always fill the width; row height/fonts scale via --cal-row-h/--cal-font-scale.
    const columnCount = days.length;
    const gridTemplateColumns = `var(--cal-grid-time-w) repeat(${columnCount}, 1fr)`;

    // The rows are the server's: the configured times plus every time that holds
    // an appointment (audit FE-F10-2).
    const timeSlots = calendarData.timeSlots ?? [];

    const getSlotAppointments = (day: CalendarDay, time: string): CalendarAppointment[] => {
        const dayAppts = day.appointments as
            | Record<string, CalendarSlotInfo | CalendarAppointment[]>
            | undefined;
        return validOnly(extractAppointments(dayAppts?.[time]));
    };

    const dayTotal = (day: CalendarDay): number =>
        timeSlots.reduce((sum, t) => sum + getSlotAppointments(day, t).length, 0);

    // When the doctor filter is on, drop the time rows that are empty across every
    // visible day so the grid collapses to just the booked rows. Otherwise show
    // every row.
    const visibleTimeSlots = hideEmptySlots
        ? timeSlots.filter(time => days.some(day => getSlotAppointments(day, time).length > 0))
        : timeSlots;

    // The drag payload is the appointment's own id, re-found at drop time. It used
    // to be `date|time|index`, so a refetch landing mid-drag (the grid now keeps
    // showing the previous data while it loads) would have moved whoever was then
    // at that index (audit FE-F10-8).
    const findAppointment = (
        id: string
    ): { appt: CalendarAppointment; date: string; time: string } | null => {
        for (const day of days) {
            for (const time of timeSlots) {
                const appt = getSlotAppointments(day, time).find(a => String(a.appointment_id) === id);
                if (appt) return { appt, date: day.date, time };
            }
        }
        return null;
    };

    const handleLaneDragStart =
        (dragId: string) => (e: DragEvent<HTMLElement>) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragId);
            setDraggingId(dragId);
        };

    const handleLaneDragEnd = () => {
        setDraggingId(null);
        setDropTarget(null);
    };

    const onSlotDragOver =
        (date: string, time: string, forbidden: boolean) =>
        (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = forbidden ? 'none' : 'move';
            setDropTarget(prev =>
                prev && prev.date === date && prev.time === time
                    ? prev
                    : { date, time, forbidden }
            );
        };

    const onSlotDrop =
        (destDate: string, destTime: string) => (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain') || draggingId;
            handleLaneDragEnd();
            if (!id) return;
            const src = findAppointment(id);
            if (!src || src.appt.appointment_id == null) return;
            if (src.date === destDate && src.time === destTime) return;
            onReschedule(src.appt.appointment_id, destDate, destTime, src.appt, src.date);
        };

    const renderLane = (
        appt: CalendarAppointment,
        index: number,
        day: CalendarDay,
        time: string,
        span2: boolean
    ) => {
        const dragId = String(appt.appointment_id ?? '');
        const isPast = isPastSlot(day.date, time, nowMinute);
        const dt = appt.drID != null ? doctorColors.get(appt.drID) : undefined;
        return (
            <div
                key={appt.appointment_id ?? index}
                role="button"
                tabIndex={0}
                className={`cal-lane ${span2 ? 'span2' : ''} ${
                    draggingId === dragId ? 'dragging' : ''
                }`}
                style={dt ? { background: dt.fill, borderColor: dt.edge } : undefined}
                draggable={!isPast && !!dragId}
                onDragStart={handleLaneDragStart(dragId)}
                onDragEnd={handleLaneDragEnd}
                onClick={(e: MouseEvent<HTMLDivElement>) => {
                    e.stopPropagation();
                    onAppointmentClick(appt, day.date, time, anchorFrom(e));
                }}
                onKeyDown={onActivate(e => onAppointmentClick(appt, day.date, time, anchorFrom(e)))}
                title={`${appt.patientName || 'Scheduled'}${
                    appt.appDetail ? `\n${appt.appDetail}` : ''
                }`}
            >
                <div className="cal-name">{appt.patientName || 'Scheduled'}</div>
                {appt.appDetail && <div className="cal-proc">{appt.appDetail}</div>}
            </div>
        );
    };

    const renderSlot = (day: CalendarDay, time: string, appts: CalendarAppointment[]) => {
        const n = appts.length;

        if (n === 0) return null;
        if (n === 1) {
            return renderLane(appts[0], 0, day, time, true);
        }
        if (n === 2) {
            return (
                <>
                    {renderLane(appts[0], 0, day, time, true)}
                    {renderLane(appts[1], 1, day, time, true)}
                </>
            );
        }
        if (n === 3) {
            return (
                <>
                    {renderLane(appts[0], 0, day, time, false)}
                    {renderLane(appts[1], 1, day, time, false)}
                    {renderLane(appts[2], 2, day, time, true)}
                </>
            );
        }
        if (n === 4) {
            return (
                <>
                    {renderLane(appts[0], 0, day, time, false)}
                    {renderLane(appts[1], 1, day, time, false)}
                    {renderLane(appts[2], 2, day, time, false)}
                    {renderLane(appts[3], 3, day, time, false)}
                </>
            );
        }
        // 5+
        const overflow = n - 3;
        const isPopOpen = !!moreMenu && moreMenu.date === day.date && moreMenu.time === time;
        return (
            <>
                {renderLane(appts[0], 0, day, time, false)}
                {renderLane(appts[1], 1, day, time, false)}
                {renderLane(appts[2], 2, day, time, false)}
                <button
                    type="button"
                    className={`cal-more-cell ${isPopOpen ? 'open' : ''}`}
                    aria-expanded={isPopOpen}
                    onClick={e => {
                        e.stopPropagation();
                        setMoreMenu(isPopOpen ? null : { date: day.date, time });
                    }}
                >
                    <span className="cal-more-plus">+{overflow}</span>
                    <span className="cal-more-label">more</span>
                </button>
            </>
        );
    };

    const renderPopover = (
        day: CalendarDay,
        time: string,
        appts: CalendarAppointment[]
    ) => {
        const hidden = appts.slice(3);
        const isPast = isPastSlot(day.date, time, nowMinute);
        return (
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- container stops mousedown from reaching the click-away dismiss
            <div className="cal-popover" onMouseDown={e => e.stopPropagation()}>
                <div className="cal-popover-head">
                    <div>
                        <div className="cal-popover-title">
                            {formatTime12(time)} · {appts.length} appointments
                        </div>
                        <div className="cal-popover-sub">
                            Showing the {hidden.length} hidden — drag to reschedule
                        </div>
                    </div>
                    <button
                        type="button"
                        className="cal-popover-close"
                        onClick={() => setMoreMenu(null)}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                <div className="cal-popover-list">
                    {hidden.map((appt, i) => {
                        const dragId = String(appt.appointment_id ?? '');
                        const dt = appt.drID != null ? doctorColors.get(appt.drID) : undefined;
                        const open = (anchor: MenuAnchor) => {
                            setMoreMenu(null);
                            onAppointmentClick(appt, day.date, time, anchor);
                        };
                        return (
                            <div
                                key={appt.appointment_id ?? i}
                                role="button"
                                tabIndex={0}
                                className={`cal-popover-row ${
                                    draggingId === dragId ? 'dragging' : ''
                                }`}
                                style={dt ? { background: dt.fill, borderLeft: `3px solid ${dt.edge}` } : undefined}
                                draggable={!isPast && !!dragId}
                                onDragStart={handleLaneDragStart(dragId)}
                                onDragEnd={handleLaneDragEnd}
                                onClick={(e: MouseEvent<HTMLDivElement>) => {
                                    e.stopPropagation();
                                    open(anchorFrom(e));
                                }}
                                onKeyDown={onActivate(e => open(anchorFrom(e)))}
                            >
                                <div className="cal-popover-name">
                                    {appt.patientName || 'Scheduled'}
                                </div>
                                {appt.appDetail && (
                                    <div className="cal-popover-proc">{appt.appDetail}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="cal-board" ref={boardRef}>
            {/* Day headers — right-click, click or Enter opens the day's menu. */}
            <div className="cal-day-headers" style={{ gridTemplateColumns }}>
                <div className="cal-time-head">
                    <span>TIME</span>
                </div>
                {days.map(day => {
                    const holiday = day.isHoliday || false;
                    const total = dayTotal(day);
                    const dateNum = parseLocalDate(day.date).getDate();
                    const openMenu = (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLElement>) =>
                        onDayMenu(day, anchorFrom(e));
                    return (
                        <div
                            key={day.date}
                            className={`cal-day-head ${isToday(day.date, today) ? 'today' : ''} ${
                                holiday ? 'holiday' : ''
                            }`}
                            role="button"
                            tabIndex={0}
                            aria-haspopup="menu"
                            onClick={openMenu}
                            onKeyDown={onActivate(openMenu)}
                            onContextMenu={e => {
                                e.preventDefault();
                                openMenu(e);
                            }}
                            title={holiday ? `Holiday: ${day.holidayName}` : undefined}
                        >
                            <div className="cal-day-row">
                                <span className="cal-day-name">
                                    {(day.dayName || '').slice(0, 3).toUpperCase()}
                                </span>
                                <span className="cal-day-num">{dateNum}</span>
                            </div>
                            {holiday ? (
                                <div className="cal-day-tag holiday">
                                    Holiday{total > 0 ? ` · ${total} appt${total === 1 ? '' : 's'}` : ''}
                                </div>
                            ) : (
                                <div className="cal-day-tag">
                                    {total} appt{total === 1 ? '' : 's'}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Grid */}
            <div
                className={`cal-grid tint-zebra ${viewMode === 'day' ? 'view-day' : ''}`}
                style={{ gridTemplateColumns }}
            >
                {/* Time column */}
                <div className="cal-time-col">
                    {visibleTimeSlots.map(t => {
                        const { hour, minute, meridiem } = to12Hour(t);
                        return (
                            <div
                                key={t}
                                className="cal-time-cell"
                                style={{ background: zebraFor(t) }}
                            >
                                <span className="cal-time-h">{hour}</span>
                                <span className="cal-time-m">{minute}</span>
                                <span className="cal-time-ap">{meridiem}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Day columns */}
                {days.map(day => {
                    const holiday = day.isHoliday || false;
                    // A holiday declared over existing bookings still shows them —
                    // the modal says they are NOT cancelled, and this is the screen
                    // used to move them (audit FE-F10-3). The sash covers the column
                    // only when there is nothing under it.
                    const holidayHasAppointments = holiday && dayTotal(day) > 0;
                    return (
                        <div
                            key={day.date}
                            className={`cal-day-col ${isToday(day.date, today) ? 'today' : ''} ${
                                holiday ? 'holiday' : ''
                            }`}
                        >
                            {holiday && !holidayHasAppointments && (
                                <div className="cal-holiday-sash">
                                    <div className="cal-holiday-card">
                                        <div className="cal-holiday-eyebrow">Holiday</div>
                                        <div className="cal-holiday-name">
                                            {day.holidayName || 'Holiday'}
                                        </div>
                                        <div className="cal-holiday-note">Clinic closed</div>
                                    </div>
                                </div>
                            )}
                            {visibleTimeSlots.map(time => {
                                const appts = getSlotAppointments(day, time);
                                // Nothing may land on a holiday or in the past; the
                                // server refuses both too (FE-F10-8).
                                const forbidden = holiday || isPastSlot(day.date, time, nowMinute);
                                const isDropTarget =
                                    !!dropTarget &&
                                    dropTarget.date === day.date &&
                                    dropTarget.time === time;
                                const isPopOpen =
                                    !!moreMenu &&
                                    moreMenu.date === day.date &&
                                    moreMenu.time === time;
                                return (
                                    <div
                                        key={time}
                                        className={`cal-slot-wrap ${
                                            isDropTarget ? 'drop-target' : ''
                                        } ${
                                            isDropTarget && forbidden ? 'drop-forbidden' : ''
                                        } ${isPopOpen ? 'pop-open' : ''}`}
                                        style={holiday ? undefined : { background: zebraFor(time) }}
                                        onDragOver={onSlotDragOver(day.date, time, forbidden)}
                                        onDrop={forbidden ? undefined : onSlotDrop(day.date, time)}
                                    >
                                        {(!holiday || appts.length > 0) && (
                                            <div
                                                className={`cal-slot count-${
                                                    appts.length === 0
                                                        ? '0'
                                                        : appts.length >= 5
                                                          ? 'many'
                                                          : appts.length
                                                }`}
                                            >
                                                {renderSlot(day, time, appts)}
                                            </div>
                                        )}
                                        {isPopOpen &&
                                            renderPopover(day, time, appts)}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            {hideEmptySlots && visibleTimeSlots.length === 0 && (
                <div className="cal-empty-filter">
                    No appointments for the selected doctor in this range.
                </div>
            )}
        </div>
    );
};

export default CalendarGrid;
