import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * AppointmentCard Component
 * Individual appointment card with actions and context menu support
 */
const AppointmentCard = ({
    appointment,
    showStatus,
    onCheckIn,
    onMarkSeated,
    onMarkDismissed,
    onUndoState,
    onContextMenu
}) => {
    const [touchStartTime, setTouchStartTime] = useState(null);
    const [touchMoved, setTouchMoved] = useState(false);
    const touchTimerRef = useRef(null);

    // Format SQL Server TIME value (HH:MM:SS) to 12-hour format
    const formatTime = (timeString) => {
        if (!timeString) return '';

        const timeParts = timeString.split(':');
        if (timeParts.length < 2) return timeString;

        let hours = parseInt(timeParts[0]);
        const minutes = timeParts[1];
        const period = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12; // 0 should be 12

        return `${hours}:${minutes} ${period}`;
    };

    // Determine current status
    const getCurrentStatus = () => {
        if (!showStatus) {
            return appointment.Present || appointment.Seated || appointment.Dismissed ? 'Checked In' : 'Scheduled';
        }

        if (appointment.Dismissed) return 'Dismissed';
        if (appointment.Seated) return 'Seated';
        if (appointment.Present) return 'Present';
        return 'Scheduled';
    };

    const status = getCurrentStatus();
    const statusClass = status.toLowerCase().replace(' ', '-');

    // Check if patient is waiting (Present but not Seated and not Dismissed)
    const isWaiting = showStatus && appointment.Present && !appointment.Seated && !appointment.Dismissed;

    const navigate = useNavigate();

    // Open patient using React Router navigation
    const handlePatientClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (appointment.PersonID) {
            navigate(`/patient/${appointment.PersonID}/works`);
        }
    };

    // Handle context menu (right-click)
    const handleContextMenu = (e) => {
        if (showStatus) {
            e.preventDefault();
            onContextMenu(e, appointment.appointmentID, status);
        }
    };

    // Touch event handlers for long-press on mobile
    const handleTouchStart = (e) => {
        setTouchMoved(false);
        setTouchStartTime(Date.now());

        if (showStatus) {
            touchTimerRef.current = setTimeout(() => {
                if (!touchMoved) {
                    const touch = e.touches[0];
                    const syntheticEvent = {
                        preventDefault: () => e.preventDefault(),
                        clientX: touch.clientX,
                        clientY: touch.clientY,
                        pageX: touch.pageX,
                        pageY: touch.pageY
                    };
                    onContextMenu(syntheticEvent, appointment.appointmentID, status);

                    // Haptic feedback if available
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }
            }, 500);
        }
    };

    const handleTouchMove = () => {
        setTouchMoved(true);
        if (touchTimerRef.current) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
        }
    };

    const handleTouchEnd = () => {
        if (touchTimerRef.current) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
        }
    };

    // Render action buttons based on status
    const renderActions = () => {
        if (!showStatus) {
            // All appointments table - show check-in button
            const isCheckedIn = status === 'Checked In';

            if (isCheckedIn) {
                return (
                    <span className="checked-in-indicator">
                        <i className="fas fa-check-circle"></i>
                        Checked In
                    </span>
                );
            } else {
                return (
                    <button
                        type="button"
                        className="btn-action btn-success"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onCheckIn(appointment.appointmentID);
                        }}
                    >
                        <i className="fas fa-sign-in-alt"></i>
                        <span>Check In</span>
                    </button>
                );
            }
        } else {
            // Checked-in patients - Sequential workflow: Present → Seat → Dismiss
            const currentStatus = status.toLowerCase();

            if (currentStatus === 'present') {
                return (
                    <>
                        <button
                            type="button"
                            className="btn-action btn-info"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMarkSeated(appointment.appointmentID);
                            }}
                        >
                            <img src="/images/dental_chair.svg" alt="" style={{ width: '1em', height: '1em' }} />
                            <span>Seat Patient</span>
                        </button>
                        <button
                            type="button"
                            className="btn-action btn-undo"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onUndoState(appointment.appointmentID, 'Present');
                            }}
                            title="Undo Check-in"
                        >
                            <i className="fas fa-undo"></i>
                        </button>
                    </>
                );
            } else if (currentStatus === 'seated') {
                return (
                    <>
                        <button
                            type="button"
                            className="btn-action btn-success"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMarkDismissed(appointment.appointmentID);
                            }}
                        >
                            <i className="fas fa-check-circle"></i>
                            <span>Complete Visit</span>
                        </button>
                        <button
                            type="button"
                            className="btn-action btn-undo"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onUndoState(appointment.appointmentID, 'Seated');
                            }}
                            title="Undo Seating"
                        >
                            <i className="fas fa-undo"></i>
                        </button>
                    </>
                );
            } else if (currentStatus === 'dismissed') {
                return (
                    <button
                        type="button"
                        className="btn-action btn-undo btn-undo-only"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onUndoState(appointment.appointmentID, 'Dismissed');
                        }}
                        title="Undo Dismiss"
                    >
                        <i className="fas fa-undo"></i>
                    </button>
                );
            }
        }

        return null;
    };

    // Get state times
    const presentTime = appointment.PresentTime ? formatTime(appointment.PresentTime) : null;
    const seatedTime = appointment.SeatedTime ? formatTime(appointment.SeatedTime) : null;
    const dismissedTime = appointment.DismissedTime ? formatTime(appointment.DismissedTime) : null;

    return (
        <div
            className={`appointment-card fade-in-up ${statusClass}${isWaiting ? ' waiting-patient' : ''}`}
            data-appointment-id={appointment.appointmentID}
            data-status={statusClass}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <div className="appointment-time">
                <i className="fas fa-clock appointment-time-icon"></i>
                {appointment.apptime || 'N/A'}
            </div>

            <div className="appointment-info">
                <div className="appointment-info-line-1">
                    <div className="patient-name">
                        <a
                            href="javascript:void(0)"
                            className="patient-link"
                            onClick={handlePatientClick}
                        >
                            <i className="fas fa-user-circle patient-link-icon"></i>
                            {appointment.PatientName || 'Unknown'}
                        </a>
                        {appointment.PatientType && (
                            <span className="patient-type-badge-inline">
                                <i className="fas fa-tag"></i>
                                {appointment.PatientType}
                            </span>
                        )}
                    </div>
                    {appointment.AppDetail && (
                        <div className="appointment-type-inline">
                            <i className="fas fa-stethoscope appointment-type-icon"></i>
                            {appointment.AppDetail}
                        </div>
                    )}
                </div>

                {showStatus && (
                    <div className="appointment-info-line-2">
                        <div className="state-times-compact">
                            {presentTime && (
                                <span className="status-time-icon status-time-present" title={`Checked in: ${presentTime}`}>
                                    <i className="fas fa-user-check"></i>
                                    {presentTime}
                                </span>
                            )}
                            {seatedTime && (
                                <span className="status-time-icon status-time-seated" title={`Seated: ${seatedTime}`}>
                                    <i className="fas fa-tooth"></i>
                                    {seatedTime}
                                </span>
                            )}
                            {dismissedTime && (
                                <span className="status-time-icon status-time-dismissed" title={`Dismissed: ${dismissedTime}`}>
                                    <i className="fas fa-check-circle"></i>
                                    {dismissedTime}
                                </span>
                            )}
                        </div>
                        {appointment.PatientType === 'Active' && (
                            <span
                                className={`visit-notes-icon ${appointment.HasVisit ? 'visit-notes-registered' : 'visit-notes-missing'}`}
                                title={appointment.HasVisit ? 'Visit notes registered ✓' : 'No visit notes yet'}
                            >
                                <i className={`fas fa-${appointment.HasVisit ? 'clipboard-check' : 'clipboard'}`}></i>
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="appointment-actions">
                {renderActions()}
            </div>
        </div>
    );
};

export default AppointmentCard;
