import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * AppointmentCard Component
 * Individual appointment card with actions and context menu support
 *
 * Performance: Automatically optimized by React Compiler (React 19).
 * No manual memoization needed - the compiler handles it automatically.
 */
const AppointmentCard = ({
    appointment,
    showStatus,
    onCheckIn,
    onMarkSeated,
    onMarkDismissed,
    onUndoState
}) => {
    const [hasAnimated, setHasAnimated] = useState(false);

    // Set animation flag on mount only (prevents re-animation on re-renders)
    useEffect(() => {
        setHasAnimated(true);
    }, []); // Empty deps = run once on mount

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

    // Render action buttons based on status
    const renderActions = () => {
        if (!showStatus) {
            // All appointments table - show only check-in button (gray/dim - not checked in yet)
            const isCheckedIn = status === 'Checked In';

            return (
                <button
                    type="button"
                    className={`status-icon-btn ${isCheckedIn ? 'status-icon-active' : 'status-icon-inactive-clickable'}`}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isCheckedIn) {
                            onCheckIn(appointment.appointmentID);
                        }
                    }}
                    title={isCheckedIn ? "Checked In" : "Click to Check In"}
                >
                    <i className="fas fa-user-check"></i>
                </button>
            );
        } else {
            // Checked-in patients - Fixed icon workflow: Present → Seat → Dismiss
            // Use the *Time fields because the API returns PresentTime/SeatedTime/DismissedTime
            const isPresent = appointment.PresentTime;
            const isSeated = appointment.SeatedTime;
            const isDismissed = appointment.DismissedTime;

            // Validation rules for undo operations
            const canUndoPresent = !isSeated && !isDismissed; // Can only undo check-in if not seated/dismissed
            const canUndoSeated = !isDismissed; // Can only undo seated if not dismissed

            // Check if patient is waiting (checked in but not seated)
            const isWaitingForSeat = isPresent && !isSeated && !isDismissed;

            return (
                <div className="status-workflow-icons">
                    {/* Check-in icon with time - Can undo only if not seated/dismissed */}
                    <button
                        type="button"
                        className={`status-icon-btn status-icon-active ${isWaitingForSeat ? 'status-icon-waiting' : ''}`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (canUndoPresent) {
                                onUndoState(appointment.appointmentID, 'Present');
                            }
                        }}
                        title={canUndoPresent ? `Checked In: ${presentTime} - Click to undo` : (isSeated ? "Cannot undo: Patient is already seated" : "Cannot undo: Visit is completed")}
                        disabled={!canUndoPresent}
                    >
                        <i className="fas fa-user-check"></i>
                        {presentTime && <span className="status-icon-time">{presentTime}</span>}
                    </button>

                    {/* Seated icon with time - Green when seated, gray when not seated yet */}
                    <button
                        type="button"
                        className={`status-icon-btn status-icon-chair ${isSeated ? 'status-icon-active' : 'status-icon-inactive-clickable'}`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isSeated && canUndoSeated) {
                                onUndoState(appointment.appointmentID, 'Seated');
                            } else if (!isSeated) {
                                onMarkSeated(appointment.appointmentID);
                            }
                        }}
                        title={isSeated ? (canUndoSeated ? `Seated: ${seatedTime} - Click to undo` : "Cannot undo: Visit is completed") : "Click to Seat Patient"}
                        disabled={isSeated && !canUndoSeated}
                    >
                        <img
                            src={isSeated ? "/images/dental_chair.svg" : "/images/dental_chair_grey.svg"}
                            alt="Seat"
                            className="chair-icon"
                        />
                        {seatedTime && <span className="status-icon-time">{seatedTime}</span>}
                    </button>

                    {/* Complete icon with time - Green when dismissed, gray/clickable when seated, gray/disabled when not seated */}
                    <button
                        type="button"
                        className={`status-icon-btn ${isDismissed ? 'status-icon-active' : (isSeated ? 'status-icon-inactive-clickable' : 'status-icon-inactive')}`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isDismissed) {
                                onUndoState(appointment.appointmentID, 'Dismissed');
                            } else if (isSeated) {
                                onMarkDismissed(appointment.appointmentID);
                            }
                        }}
                        title={isDismissed ? `Completed: ${dismissedTime} - Click to undo` : (isSeated ? "Click to Complete Visit" : "Not seated yet")}
                        disabled={!isSeated && !isDismissed}
                    >
                        <i className="fas fa-check-circle"></i>
                        {dismissedTime && <span className="status-icon-time">{dismissedTime}</span>}
                    </button>
                </div>
            );
        }
    };

    // Get state times
    const presentTime = appointment.PresentTime ? formatTime(appointment.PresentTime) : null;
    const seatedTime = appointment.SeatedTime ? formatTime(appointment.SeatedTime) : null;
    const dismissedTime = appointment.DismissedTime ? formatTime(appointment.DismissedTime) : null;

    return (
        <div
            className={`appointment-card ${!hasAnimated ? 'fade-in-up' : ''} ${statusClass}${isWaiting ? ' waiting-patient' : ''}`}
            data-appointment-id={appointment.appointmentID}
            data-status={statusClass}
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
                        {appointment.hasActiveAlert && (
                            <i className="fas fa-bell patient-alert-icon" title="Patient has an active alert"></i>
                        )}
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

                {showStatus && appointment.PatientType === 'Active' && (
                    <div className="appointment-info-line-2">
                        <span
                            className={`visit-notes-icon ${appointment.HasVisit ? 'visit-notes-registered' : 'visit-notes-missing'}`}
                            title={appointment.HasVisit ? 'Visit notes registered ✓' : 'No visit notes yet'}
                        >
                            <i className={`fas fa-${appointment.HasVisit ? 'clipboard-check' : 'clipboard'}`}></i>
                        </span>
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
