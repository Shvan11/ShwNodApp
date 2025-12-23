import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * CalendarContextMenu Component
 * Context menu for calendar time slots
 * Handles both single and multiple appointments
 * - Single appointment: Shows Edit/Delete directly
 * - Multiple appointments: Shows appointment list, then Edit/Delete for selected
 */
const CalendarContextMenu = ({ position, appointments, onClose, onDelete }) => {
    const menuRef = useRef(null);
    const navigate = useNavigate();
    const [selectedAppointment, setSelectedAppointment] = useState(null);

    // Determine if single or multiple appointments
    const isSingleAppointment = appointments.length === 1;
    const appointment = isSingleAppointment ? appointments[0] : selectedAppointment;

    // Close on click outside - use mousedown for more reliable detection
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
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
        const handleEscKey = (event) => {
            if (event.key === 'Escape') {
                if (selectedAppointment) {
                    // Go back to appointment list
                    setSelectedAppointment(null);
                } else {
                    // Close menu
                    onClose();
                }
            }
        };

        document.addEventListener('keydown', handleEscKey);
        return () => {
            document.removeEventListener('keydown', handleEscKey);
        };
    }, [onClose, selectedAppointment]);

    const handleEdit = (e) => {
        e.stopPropagation();
        if (appointment?.PersonID && appointment?.appointmentID) {
            navigate(`/patient/${appointment.PersonID}/edit-appointment/${appointment.appointmentID}`, {
                state: { appointment }
            });
        }
        onClose();
    };

    const handleDelete = (e) => {
        e.stopPropagation();
        onDelete(appointment);
        onClose();
    };

    const handleSelectAppointment = (apt, event) => {
        event.stopPropagation(); // Prevent click from bubbling up
        setSelectedAppointment(apt);
    };

    const handleBack = (e) => {
        e.stopPropagation();
        setSelectedAppointment(null);
    };

    // Render appointment list for multiple appointments
    if (!isSingleAppointment && !selectedAppointment) {
        return (
            <div
                ref={menuRef}
                className="calendar-context-menu appointment-list-menu"
                key="appointment-list"
                style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`
                }}
            >
                <div className="context-menu-header">
                    <span>Select Appointment ({appointments.length})</span>
                </div>
                {appointments.map((apt, index) => (
                    <div
                        key={apt.appointmentID || index}
                        className="context-menu-item appointment-item"
                        onClick={(e) => handleSelectAppointment(apt, e)}
                    >
                        <div className="appointment-info">
                            <div className="appointment-name">
                                {apt.patientName || 'Unknown Patient'}
                            </div>
                            {apt.appDetail && (
                                <div className="appointment-detail-text">
                                    {apt.appDetail}
                                </div>
                            )}
                        </div>
                        <i className="fas fa-chevron-right"></i>
                    </div>
                ))}
            </div>
        );
    }

    // Render Edit/Delete options for selected appointment
    return (
        <div
            ref={menuRef}
            className="calendar-context-menu"
            key="edit-delete-menu"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`
            }}
        >
            {!isSingleAppointment && (
                <>
                    <div className="context-menu-item context-menu-back" onClick={handleBack}>
                        <i className="fas fa-arrow-left"></i>
                        <span>Back to List</span>
                    </div>
                    <div className="context-menu-divider"></div>
                    <div className="context-menu-header">
                        <span>{appointment?.patientName || 'Patient'}</span>
                    </div>
                </>
            )}
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
