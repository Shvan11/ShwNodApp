import { useEffect, useRef, type MouseEvent } from 'react';
import type { CalendarDay, MenuPosition } from './calendar.types';

interface CalendarDayContextMenuProps {
    position: MenuPosition;
    day: CalendarDay;
    onClose: () => void;
    onAddHoliday: (day: CalendarDay) => void;
    onEditHoliday: (day: CalendarDay) => void;
    onRemoveHoliday: (day: CalendarDay) => void;
}

/**
 * CalendarDayContextMenu Component
 * Context menu for calendar day cells
 * Handles holiday management actions (Add/Edit/Remove)
 */
const CalendarDayContextMenu = ({
    position,
    day,
    onClose,
    onAddHoliday,
    onEditHoliday,
    onRemoveHoliday
}: CalendarDayContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const isHoliday = day?.isHoliday;

    // Close on click outside - use mousedown for more reliable detection
    useEffect(() => {
        const handleClickOutside = (event: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        // Add listener on next frame to avoid catching the opening right-click
        const frameId = requestAnimationFrame(() => {
            document.addEventListener('mousedown', handleClickOutside);
        });

        return () => {
            cancelAnimationFrame(frameId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Close on ESC key
    useEffect(() => {
        const handleEscKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscKey);
        return () => {
            document.removeEventListener('keydown', handleEscKey);
        };
    }, [onClose]);

    // Adjust position to keep menu in viewport
    const adjustedPosition = { ...position };
    if (menuRef.current) {
        const rect = menuRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (position.x + rect.width > viewportWidth - 20) {
            adjustedPosition.x = viewportWidth - rect.width - 20;
        }
        if (position.y + rect.height > viewportHeight - 20) {
            adjustedPosition.y = viewportHeight - rect.height - 20;
        }
    }

    const formatDate = (dateStr: string): string => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    };

    const handleAddHoliday = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onAddHoliday(day);
        onClose();
    };

    const handleEditHoliday = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onEditHoliday(day);
        onClose();
    };

    const handleRemoveHoliday = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onRemoveHoliday(day);
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="calendar-context-menu calendar-day-context-menu"
            style={{
                left: `${adjustedPosition.x}px`,
                top: `${adjustedPosition.y}px`
            }}
        >
            {/* Date header */}
            <div className="context-menu-header">
                <i className="fas fa-calendar-day"></i>
                <span>{formatDate(day.date)}</span>
            </div>

            {isHoliday ? (
                <>
                    {/* Holiday info */}
                    <div className="context-menu-info holiday-info">
                        <i className="fas fa-calendar-times"></i>
                        <span>{day.holidayName || 'Holiday'}</span>
                    </div>

                    <div className="context-menu-divider"></div>

                    {/* Edit Holiday */}
                    <div className="context-menu-item" onClick={handleEditHoliday}>
                        <i className="fas fa-edit"></i>
                        <span>Edit Holiday</span>
                    </div>

                    {/* Remove Holiday */}
                    <div className="context-menu-item context-menu-item-danger" onClick={handleRemoveHoliday}>
                        <i className="fas fa-trash"></i>
                        <span>Remove Holiday</span>
                    </div>
                </>
            ) : (
                <>
                    {/* Appointment count info if any */}
                    {day.appointmentCount && day.appointmentCount > 0 && (
                        <div className="context-menu-info">
                            <i className="fas fa-calendar-check"></i>
                            <span>{day.appointmentCount} appointment(s)</span>
                        </div>
                    )}

                    <div className="context-menu-divider"></div>

                    {/* Add Holiday */}
                    <div className="context-menu-item" onClick={handleAddHoliday}>
                        <i className="fas fa-calendar-times"></i>
                        <span>Mark as Holiday</span>
                    </div>
                </>
            )}
        </div>
    );
};

export default CalendarDayContextMenu;
