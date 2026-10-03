import { useRef, type KeyboardEvent } from 'react';
import { useFloatingMenu, type MenuAnchor } from '../../hooks/useFloatingMenu';
import { formatLocaleDate } from '../../utils/formatters';
import type { CalendarDay } from './calendar.types';

interface CalendarDayContextMenuProps {
    position: MenuAnchor;
    day: CalendarDay;
    /** Appointments on the day (the week grid and the month view count them differently). */
    appointmentCount: number;
    onClose: () => void;
    /** Omitted when the day is already the one on screen in day view. */
    onOpenDay?: (day: CalendarDay) => void;
    /**
     * Holiday writes go to `/api/admin/lookups/tblHolidays`, which is
     * `authorize(admin|front_desk)`. For any other role the three actions are not
     * offered: a clinical user used to fill in the modal and get a 403 at Save
     * (audit FE-F10-14).
     */
    canManageHolidays: boolean;
    onAddHoliday: (day: CalendarDay) => void;
    onEditHoliday: (day: CalendarDay) => void;
    onRemoveHoliday: (day: CalendarDay) => void;
}

/**
 * CalendarDayContextMenu Component
 * The menu for a day: open it in day view, and the holiday actions
 * (Add/Edit/Remove). Opened by right-click, by a click or Enter on the week
 * grid's day header, or from the month view's day panel, so it has a keyboard
 * and touch path (audit FE-F10-15d).
 */
const CalendarDayContextMenu = ({
    position: anchor,
    day,
    appointmentCount,
    onClose,
    onOpenDay,
    canManageHolidays,
    onAddHoliday,
    onEditHoliday,
    onRemoveHoliday
}: CalendarDayContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const { position, onKeyDown } = useFloatingMenu(menuRef, anchor, onClose);
    const isHoliday = !!day.isHoliday;

    // A LOCAL day — `new Date('YYYY-MM-DD')` is UTC, a day early west of UTC (FE-F10-16).
    const dateLabel = formatLocaleDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' });

    const run = (action: (d: CalendarDay) => void) => () => {
        onClose();
        action(day);
    };
    const activate = (action: () => void) => (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
        }
    };

    const item = (label: string, icon: string, action: () => void, danger = false) => (
        <div
            className={`context-menu-item${danger ? ' context-menu-item-danger' : ''}`}
            role="menuitem"
            tabIndex={-1}
            onClick={action}
            onKeyDown={activate(action)}
        >
            <i className={`fas ${icon}`} aria-hidden="true"></i>
            <span>{label}</span>
        </div>
    );

    return (
        <div
            ref={menuRef}
            className="calendar-context-menu calendar-day-context-menu"
            role="menu"
            tabIndex={-1}
            aria-label={dateLabel}
            style={{ left: `${position.x}px`, top: `${position.y}px` }}
            onKeyDown={onKeyDown}
        >
            <div className="context-menu-header">
                <i className="fas fa-calendar-day" aria-hidden="true"></i>
                <span>{dateLabel}</span>
            </div>

            {isHoliday && (
                <div className="context-menu-info holiday-info">
                    <i className="fas fa-calendar-times" aria-hidden="true"></i>
                    <span>{day.holidayName || 'Holiday'}</span>
                </div>
            )}
            {/* A number, never a bare `count && …`: that rendered a stray "0" (FE-F10-15c). */}
            {appointmentCount > 0 && (
                <div className="context-menu-info">
                    <i className="fas fa-calendar-check" aria-hidden="true"></i>
                    <span>{appointmentCount} appointment{appointmentCount === 1 ? '' : 's'}</span>
                </div>
            )}

            {onOpenDay && (
                <>
                    <div className="context-menu-divider" role="separator"></div>
                    {item('Open day view', 'fa-calendar-day', run(onOpenDay))}
                </>
            )}

            {canManageHolidays && (
                <>
                    <div className="context-menu-divider" role="separator"></div>
                    {isHoliday ? (
                        <>
                            {item('Edit Holiday', 'fa-edit', run(onEditHoliday))}
                            {item('Remove Holiday', 'fa-trash', run(onRemoveHoliday), true)}
                        </>
                    ) : (
                        item('Mark as Holiday', 'fa-calendar-times', run(onAddHoliday))
                    )}
                </>
            )}
        </div>
    );
};

export default CalendarDayContextMenu;
