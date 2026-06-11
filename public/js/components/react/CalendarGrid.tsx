/**
 * CalendarGrid Component for Appointment Calendar
 *
 * Renders the week/day grid on a uniform 112px slot system.
 * Row tinting is switchable via TINT_MODE (neutral 'zebra' default, or the
 * 'colorful' golden-angle hue-per-row). Appointment cards pack adaptively
 * (1/2/3/4/5+) and support drag-to-reschedule plus a "+N more" popover for
 * crowded slots.
 */

import { useEffect } from 'react';
import type { Dispatch, DragEvent, MouseEvent, Ref, SetStateAction } from 'react';
import { to12Hour, formatTime12 } from '../../utils/formatters';
import { parseLocalDate } from '../../utils/calendarDate';
import type {
    CalendarDay,
    CalendarData,
    CalendarAppointment,
    CalendarSlotInfo,
    SlotData,
    ViewMode,
    CalendarMode,
    DoctorColor
} from './calendar.types';

/* ────────────────────────────────────────────────────────────────────────
   Row tinting — flip TINT_MODE to switch the whole grid.
   'zebra'    : neutral alternating bands; the time-column label shares its
                row's shade, so each 30-min row (label + every day cell) reads
                as one horizontal unit. Easiest to trace a cell back to its
                time across the 6-day week.
   'colorful' : 14 golden-angle hues, one per 30-min row (the V4_TIME_TINT map
                below). Flip back here to restore it — nothing else changes.
   ──────────────────────────────────────────────────────────────────────── */
type TintMode = 'zebra' | 'colorful';
const TINT_MODE: TintMode = 'zebra';

/* Colourful mode — 14 hues stepped at the golden angle (~137.5°) so every
   consecutive pair of 30-minute rows sits on opposite sides of the wheel.
   Also the source of truth for the slot list (CORE_TIME_SLOTS), regardless
   of the active mode. */
const V4_TIME_TINT: Record<string, { row: string; label: string }> = {
    '14:00': { row: 'oklch(96% 0.038 220)', label: 'oklch(86% 0.078 220)' },
    '14:30': { row: 'oklch(96% 0.038 358)', label: 'oklch(86% 0.078 358)' },
    '15:00': { row: 'oklch(96% 0.040 135)', label: 'oklch(86% 0.082 135)' },
    '15:30': { row: 'oklch(96% 0.038 273)', label: 'oklch(86% 0.078 273)' },
    '16:00': { row: 'oklch(96% 0.040 50)',  label: 'oklch(86% 0.082 50)'  },
    '16:30': { row: 'oklch(96% 0.040 188)', label: 'oklch(86% 0.082 188)' },
    '17:00': { row: 'oklch(96% 0.038 325)', label: 'oklch(86% 0.078 325)' },
    '17:30': { row: 'oklch(96% 0.040 103)', label: 'oklch(86% 0.082 103)' },
    '18:00': { row: 'oklch(96% 0.038 240)', label: 'oklch(86% 0.078 240)' },
    '18:30': { row: 'oklch(96% 0.040 18)',  label: 'oklch(86% 0.082 18)'  },
    '19:00': { row: 'oklch(96% 0.040 155)', label: 'oklch(86% 0.082 155)' },
    '19:30': { row: 'oklch(96% 0.038 293)', label: 'oklch(86% 0.078 293)' },
    '20:00': { row: 'oklch(96% 0.040 70)',  label: 'oklch(86% 0.082 70)'  },
    '20:30': { row: 'oklch(96% 0.040 208)', label: 'oklch(86% 0.082 208)' }
};
/* The fixed 14 time rows the week/day grid always renders. Exported so the
   density-zoom Fit can divide the available board height by the row count. */
export const CORE_TIME_SLOTS = Object.keys(V4_TIME_TINT);

/* Zebra mode — on-the-hour rows tinted, half-hour rows clear (a proper
   every-other-row stripe, since slots strictly alternate :00 / :30). Label
   matches row so the band reads as one unit. */
const zebraFor = (t: string): { row: string; label: string } => {
    const shade = t.endsWith(':00') ? 'var(--cal-zebra)' : 'transparent';
    return { row: shade, label: shade };
};

const tintFor = (t: string): { row: string; label: string } =>
    TINT_MODE === 'zebra' ? zebraFor(t) : (V4_TIME_TINT[t] || V4_TIME_TINT['14:00']);

/* Per-doctor card tint now comes from the `doctorColors` prop — resolved from
   the appointment-eligible doctors (tblEmployees.getAppointments) and their
   AppointmentColor, see doctorColors.ts — so the grid, the legend, and Employee
   Settings stay in sync. A drID absent from the map renders neutral white
   (unassigned, or a deliberately-neutral bucket like "Clinic"). */
const EMPTY_DOCTOR_COLORS: Map<number, DoctorColor> = new Map();

export interface DropTarget {
    date: string;
    time: string;
    isHoliday?: boolean;
}

export interface MoreMenu {
    date: string;
    time: string;
}

interface CalendarGridProps {
    calendarData: CalendarData | null;
    selectedSlot: SlotData | null;
    onSlotClick: (slot: SlotData, event: MouseEvent<HTMLDivElement>) => void;
    onAppointmentClick: (
        appt: CalendarAppointment,
        date: string,
        time: string,
        event: MouseEvent<HTMLDivElement>
    ) => void;
    onDayContextMenu?: (day: CalendarDay, event: MouseEvent<HTMLDivElement>) => void;
    mode?: CalendarMode;
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
        appt: CalendarAppointment
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

const isToday = (date: string): boolean => {
    const today = new Date();
    const checkDate = parseLocalDate(date);
    return today.toDateString() === checkDate.toDateString();
};

const parseDragId = (id: string): { date: string; time: string; index: number } => {
    const [date, time, idx] = id.split('|');
    return { date, time, index: parseInt(idx, 10) };
};

const CalendarGrid = ({
    calendarData,
    onSlotClick,
    onAppointmentClick,
    onDayContextMenu,
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

    // Close the "+N more" popover on outside click or Escape.
    useEffect(() => {
        if (!moreMenu) return;
        const onMouseDown = (e: globalThis.MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.cal-popover') || target.closest('.cal-more-cell')) return;
            setMoreMenu(null);
        };
        const onKeyDown = (e: KeyboardEvent) => {
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
    const filteredDays = days;
    const columnCount = filteredDays.length;
    const gridTemplateColumns = `var(--cal-grid-time-w) repeat(${columnCount}, 1fr)`;

    // The time rows come from the configured slots the server sent (tbltimes —
    // reflects add/delete live). CORE_TIME_SLOTS is only a fallback for the brief
    // pre-load window. Zebra tinting + 12h formatting handle any HH:MM.
    const timeSlots =
        calendarData.timeSlots && calendarData.timeSlots.length > 0
            ? calendarData.timeSlots
            : CORE_TIME_SLOTS;

    const getSlotAppointments = (day: CalendarDay, time: string): CalendarAppointment[] => {
        const dayAppts = day.appointments as
            | Record<string, CalendarSlotInfo | CalendarAppointment[]>
            | undefined;
        return validOnly(extractAppointments(dayAppts?.[time]));
    };

    // When the doctor filter is on, drop the time rows that are empty across every
    // visible day (holidays never count) so the grid collapses to just the booked
    // rows. Otherwise show the full configured slot list.
    const visibleTimeSlots = hideEmptySlots
        ? timeSlots.filter(time =>
              filteredDays.some(
                  day => !day.isHoliday && getSlotAppointments(day, time).length > 0
              )
          )
        : timeSlots;

    const buildSlotData = (
        day: CalendarDay,
        time: string,
        appts: CalendarAppointment[]
    ): SlotData => ({
        date: day.date,
        time,
        dayName: day.dayName,
        appointments: appts,
        slotStatus: appts.length > 0 ? 'booked' : 'available',
        appointment_id: appts.length > 0 ? appts[0].appointment_id : undefined,
        appDetail: appts.length > 0 ? appts[0].appDetail : undefined,
        patientName: appts.length > 0 ? appts[0].patientName : undefined
    });

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
        (date: string, time: string, holiday: boolean) =>
        (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = holiday ? 'none' : 'move';
            setDropTarget(prev =>
                prev && prev.date === date && prev.time === time
                    ? prev
                    : { date, time, isHoliday: holiday }
            );
        };

    const onSlotDrop =
        (destDate: string, destTime: string) => (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain') || draggingId;
            handleLaneDragEnd();
            if (!id) return;
            const src = parseDragId(id);
            if (src.date === destDate && src.time === destTime) return;

            const srcDay = days.find(d => d.date === src.date);
            if (!srcDay) return;
            const appt = getSlotAppointments(srcDay, src.time)[src.index];
            if (!appt || appt.appointment_id == null) return;

            onReschedule(appt.appointment_id, destDate, destTime, appt);
        };

    const renderLane = (
        appt: CalendarAppointment,
        index: number,
        day: CalendarDay,
        time: string,
        span2: boolean
    ) => {
        const dragId = `${day.date}|${time}|${index}`;
        const isPast = new Date(`${day.date}T${time}:00`) < new Date();
        const dt = appt.drID != null ? doctorColors.get(appt.drID) : undefined;
        return (
            <div
                key={index}
                className={`cal-lane ${span2 ? 'span2' : ''} ${
                    draggingId === dragId ? 'dragging' : ''
                }`}
                style={dt ? { background: dt.fill, borderColor: dt.edge } : undefined}
                draggable={!isPast}
                onDragStart={handleLaneDragStart(dragId)}
                onDragEnd={handleLaneDragEnd}
                onClick={e => {
                    e.stopPropagation();
                    onAppointmentClick(appt, day.date, time, e);
                }}
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

        if (n === 0) {
            return <span className="cal-empty-mark">＋</span>;
        }
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
        return (
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
                        const absIdx = 3 + i;
                        const dragId = `${day.date}|${time}|${absIdx}`;
                        const isPast = new Date(`${day.date}T${time}:00`) < new Date();
                        const dt = appt.drID != null ? doctorColors.get(appt.drID) : undefined;
                        return (
                            <div
                                key={absIdx}
                                className={`cal-popover-row ${
                                    draggingId === dragId ? 'dragging' : ''
                                }`}
                                style={dt ? { background: dt.fill, borderLeft: `3px solid ${dt.edge}` } : undefined}
                                draggable={!isPast}
                                onDragStart={handleLaneDragStart(dragId)}
                                onDragEnd={handleLaneDragEnd}
                                onClick={e => {
                                    e.stopPropagation();
                                    setMoreMenu(null);
                                    onAppointmentClick(appt, day.date, time, e);
                                }}
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
            {/* Day headers */}
            <div className="cal-day-headers" style={{ gridTemplateColumns }}>
                <div className="cal-time-head">
                    <span>TIME</span>
                </div>
                {filteredDays.map(day => {
                    const holiday = day.isHoliday || false;
                    const total = timeSlots.reduce(
                        (sum, t) => sum + getSlotAppointments(day, t).length,
                        0
                    );
                    const dateNum = parseLocalDate(day.date).getDate();
                    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        onDayContextMenu?.(day, event);
                    };
                    return (
                        <div
                            key={day.date}
                            className={`cal-day-head ${isToday(day.date) ? 'today' : ''} ${
                                holiday ? 'holiday' : ''
                            }`}
                            onContextMenu={handleContextMenu}
                            title={holiday ? `Holiday: ${day.holidayName}` : undefined}
                        >
                            <div className="cal-day-row">
                                <span className="cal-day-name">
                                    {(day.dayName || '').slice(0, 3).toUpperCase()}
                                </span>
                                <span className="cal-day-num">{dateNum}</span>
                            </div>
                            {holiday ? (
                                <div className="cal-day-tag holiday">Holiday</div>
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
                className={`cal-grid tint-${TINT_MODE} ${viewMode === 'day' ? 'view-day' : ''}`}
                style={{ gridTemplateColumns }}
            >
                {/* Time column */}
                <div className="cal-time-col">
                    {visibleTimeSlots.map(t => {
                        const tint = tintFor(t);
                        const { hour, minute, meridiem } = to12Hour(t);
                        return (
                            <div
                                key={t}
                                className="cal-time-cell"
                                style={{ background: tint.label }}
                            >
                                <span className="cal-time-h">{hour}</span>
                                <span className="cal-time-m">{minute}</span>
                                <span className="cal-time-ap">{meridiem}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Day columns */}
                {filteredDays.map(day => {
                    const holiday = day.isHoliday || false;
                    return (
                        <div
                            key={day.date}
                            className={`cal-day-col ${isToday(day.date) ? 'today' : ''} ${
                                holiday ? 'holiday' : ''
                            }`}
                        >
                            {holiday && (
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
                                const tint = tintFor(time);
                                const appts = holiday
                                    ? []
                                    : getSlotAppointments(day, time);
                                const slotData = buildSlotData(day, time, appts);
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
                                            isDropTarget && holiday ? 'drop-forbidden' : ''
                                        } ${isPopOpen ? 'pop-open' : ''}`}
                                        style={holiday ? undefined : { background: tint.row }}
                                        onDragOver={onSlotDragOver(day.date, time, holiday)}
                                        onDrop={
                                            holiday ? undefined : onSlotDrop(day.date, time)
                                        }
                                    >
                                        {!holiday && (
                                            <div
                                                className={`cal-slot count-${
                                                    appts.length === 0
                                                        ? '0'
                                                        : appts.length >= 5
                                                          ? 'many'
                                                          : appts.length
                                                }`}
                                                onClick={e => onSlotClick(slotData, e)}
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
