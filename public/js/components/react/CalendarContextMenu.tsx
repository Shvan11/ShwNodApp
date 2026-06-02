import { useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalendarAppointment, MenuPosition } from './calendar.types';

interface CalendarContextMenuProps {
    position: MenuPosition;
    appointment: CalendarAppointment;
    onClose: () => void;
    onDelete: (appointment: CalendarAppointment) => void;
}

/**
 * CalendarContextMenu Component
 * Edit/Delete menu for a single appointment. The clicked card already
 * identifies which appointment, so there is no picker step — the menu opens
 * directly on Edit/Delete for that card.
 */
const CalendarContextMenu = ({ position, appointment, onClose, onDelete }: CalendarContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Close on click outside - use mousedown for more reliable detection
    useEffect(() => {
        const handleClickOutside = (event: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        // Add listener on next frame to avoid catching the opening click
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

    const handleEdit = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (appointment.personID && appointment.appointment_id) {
            navigate(`/patient/${appointment.personID}/edit-appointment/${appointment.appointment_id}`, {
                state: { appointment }
            });
        }
        onClose();
    };

    const handleDelete = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        onDelete(appointment);
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="calendar-context-menu"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`
            }}
        >
            <div className="context-menu-item" onClick={handleEdit}>
                <i className="fas fa-edit"></i>
                <span>Edit Appointment</span>
            </div>
            <div className="context-menu-divider"></div>
            <div className="context-menu-item context-menu-item-danger" onClick={handleDelete}>
                <i className="fas fa-trash"></i>
                <span>Delete Appointment</span>
            </div>
        </div>
    );
};

export default CalendarContextMenu;
