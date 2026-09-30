import { useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFloatingMenu, type MenuAnchor } from '../../hooks/useFloatingMenu';
import type { CalendarAppointment } from './calendar.types';

interface CalendarContextMenuProps {
    position: MenuAnchor;
    appointment: CalendarAppointment;
    onClose: () => void;
    onDelete: (appointment: CalendarAppointment) => void;
}

/**
 * CalendarContextMenu Component
 * Edit/Delete menu for a single appointment. The clicked card already
 * identifies which appointment, so there is no picker step — the menu opens
 * directly on Edit/Delete for that card. Positioning, focus and dismissal are
 * `useFloatingMenu`'s (audit FE-F10-15).
 */
const CalendarContextMenu = ({ position: anchor, appointment, onClose, onDelete }: CalendarContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const { position, onKeyDown } = useFloatingMenu(menuRef, anchor, onClose);

    const handleEdit = () => {
        onClose();
        if (appointment.personID && appointment.appointment_id) {
            // The form reads the appointment by id itself (audit FE-F10-1).
            navigate(`/patient/${appointment.personID}/edit-appointment/${appointment.appointment_id}`);
        }
    };

    const handleDelete = () => {
        onClose();
        onDelete(appointment);
    };

    const activate = (action: () => void) => (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
        }
    };

    return (
        <div
            ref={menuRef}
            className="calendar-context-menu"
            role="menu"
            tabIndex={-1}
            aria-label={appointment.patientName ?? 'Appointment'}
            style={{ left: `${position.x}px`, top: `${position.y}px` }}
            onKeyDown={onKeyDown}
        >
            <div
                className="context-menu-item"
                role="menuitem"
                tabIndex={-1}
                onClick={handleEdit}
                onKeyDown={activate(handleEdit)}
            >
                <i className="fas fa-edit" aria-hidden="true"></i>
                <span>Edit Appointment</span>
            </div>
            <div className="context-menu-divider" role="separator"></div>
            <div
                className="context-menu-item context-menu-item-danger"
                role="menuitem"
                tabIndex={-1}
                onClick={handleDelete}
                onKeyDown={activate(handleDelete)}
            >
                <i className="fas fa-trash" aria-hidden="true"></i>
                <span>Delete Appointment</span>
            </div>
        </div>
    );
};

export default CalendarContextMenu;
