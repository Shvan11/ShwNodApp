import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AppointmentCard.module.css';

// Daily appointment interface with all fields from stored procedure
export interface DailyAppointment {
    appointmentID?: number;
    AppointmentID?: number;
    PersonID?: number;
    PatientName?: string;
    PatientType?: string | null;
    Phone?: string | null;
    apptime?: string | null;
    AppDetail?: string | null;
    Notes?: string | null;
    Present?: string | null;
    Seated?: string | null;
    Dismissed?: string | null;
    PresentTime?: string | null;
    SeatedTime?: string | null;
    DismissedTime?: string | null;
    hasActiveAlert?: boolean;
    IsOrthoVisit?: boolean;
    HasVisit?: boolean | number | null;
    DoctorID?: number | null;
    WorkID?: number | null;
}

interface AppointmentCardProps {
    appointment: DailyAppointment;
    showStatus: boolean;
    onCheckIn?: (appointmentId: number) => void;
    onMarkSeated?: (appointmentId: number) => void;
    onMarkDismissed?: (appointmentId: number) => void;
    onUndoState?: (appointmentId: number, state: string) => void;
}

/**
 * AppointmentCard Component
 * Individual appointment card with actions and context menu support
 *
 * Performance: Automatically optimized by React Compiler (React 19).
 * No manual memoization needed - the compiler handles it automatically.
 *
 * Note: IsOrthoVisit flag is computed in SQL stored procedure.
 * Business logic lives in database (single source of truth), not frontend.
 */
const AppointmentCard = ({
    appointment,
    showStatus,
    onCheckIn,
    onMarkSeated,
    onMarkDismissed,
    onUndoState
}: AppointmentCardProps) => {
    const [hasAnimated, setHasAnimated] = useState<boolean>(false);

    // Set animation flag on mount only (prevents re-animation on re-renders)
    useEffect(() => {
        setHasAnimated(true);
    }, []); // Empty deps = run once on mount

    // Format SQL Server TIME value (HH:MM:SS) to 12-hour format
    const formatTime = (timeString: string | null | undefined): string => {
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
    const getCurrentStatus = (): string => {
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
    const handlePatientClick = (e: React.MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (appointment.PersonID) {
            navigate(`/patient/${appointment.PersonID}/works`);
        }
    };

    // Get state times
    const presentTime = appointment.PresentTime ? formatTime(appointment.PresentTime) : null;
    const seatedTime = appointment.SeatedTime ? formatTime(appointment.SeatedTime) : null;
    const dismissedTime = appointment.DismissedTime ? formatTime(appointment.DismissedTime) : null;

    // Helper to get button class based on state
    const getButtonClass = (isActive: boolean, isClickable: boolean, isWaitingState: boolean = false): string => {
        if (isWaitingState) return styles.statusWaiting;
        if (isActive) return styles.statusActive;
        if (isClickable) return styles.statusInactiveClickable;
        return styles.statusInactive;
    };

    // Render action buttons based on status
    const renderActions = (): React.ReactNode => {
        const appointmentId = appointment.appointmentID || appointment.AppointmentID;
        if (!appointmentId) return <></>;

        if (!showStatus) {
            // All appointments table - show only check-in button (gray/dim - not checked in yet)
            const isCheckedIn = status === 'Checked In';

            return (
                <button
                    type="button"
                    className={isCheckedIn ? styles.statusActive : styles.statusInactiveClickable}
                    onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isCheckedIn && onCheckIn) {
                            onCheckIn(appointmentId);
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
                <div className={styles.workflowIcons}>
                    {/* Check-in icon with time - Can undo only if not seated/dismissed */}
                    <button
                        type="button"
                        className={getButtonClass(true, true, Boolean(isWaitingForSeat))}
                        onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (canUndoPresent && onUndoState) {
                                onUndoState(appointmentId, 'Present');
                            }
                        }}
                        title={canUndoPresent ? `Checked In: ${presentTime} - Click to undo` : (isSeated ? "Cannot undo: Patient is already seated" : "Cannot undo: Visit is completed")}
                        disabled={!canUndoPresent}
                    >
                        <i className="fas fa-user-check"></i>
                        {presentTime && <span className={styles.statusTime}>{presentTime}</span>}
                    </button>

                    {/* Seated icon with time - Green when seated, gray when not seated yet */}
                    <button
                        type="button"
                        className={isSeated ? styles.statusActive : styles.statusInactiveClickable}
                        onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isSeated && canUndoSeated && onUndoState) {
                                onUndoState(appointmentId, 'Seated');
                            } else if (!isSeated && onMarkSeated) {
                                onMarkSeated(appointmentId);
                            }
                        }}
                        title={isSeated ? (canUndoSeated ? `Seated: ${seatedTime} - Click to undo` : "Cannot undo: Visit is completed") : "Click to Seat Patient"}
                        disabled={Boolean(isSeated && !canUndoSeated)}
                    >
                        <img
                            src={isSeated ? "/images/dental_chair.svg" : "/images/dental_chair_grey.svg"}
                            alt="Seat"
                            className={styles.chairIcon}
                        />
                        {seatedTime && <span className={styles.statusTime}>{seatedTime}</span>}
                    </button>

                    {/* Complete icon with time - Green when dismissed, gray/clickable when seated, gray/disabled when not seated */}
                    <button
                        type="button"
                        className={getButtonClass(Boolean(isDismissed), Boolean(isSeated), false)}
                        onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isDismissed && onUndoState) {
                                onUndoState(appointmentId, 'Dismissed');
                            } else if (isSeated && onMarkDismissed) {
                                onMarkDismissed(appointmentId);
                            }
                        }}
                        title={isDismissed ? `Completed: ${dismissedTime} - Click to undo` : (isSeated ? "Click to Complete Visit" : "Not seated yet")}
                        disabled={!isSeated && !isDismissed}
                    >
                        <i className="fas fa-check-circle"></i>
                        {dismissedTime && <span className={styles.statusTime}>{dismissedTime}</span>}
                    </button>
                </div>
            );
        }
    };

    // Build card classes dynamically
    const cardClass = isWaiting ? styles.waiting : styles.card;
    const animationClass = !hasAnimated ? styles.fadeInUp : '';

    return (
        <div
            className={`${cardClass}${animationClass ? ' ' + animationClass : ''}`}
            data-appointment-id={appointment.appointmentID || appointment.AppointmentID}
            data-status={statusClass}
        >
            <div className={styles.time}>
                <i className={`fas fa-clock ${styles.timeIcon}`}></i>
                {appointment.apptime || 'N/A'}
            </div>

            <div className={styles.info}>
                <div className={styles.infoLine1}>
                    <div className={styles.patientName}>
                        <a
                            href="javascript:void(0)"
                            className={styles.patientLink}
                            onClick={handlePatientClick}
                        >
                            <i className={`fas fa-user-circle ${styles.patientLinkIcon}`}></i>
                            {appointment.PatientName || 'Unknown'}
                        </a>
                        {appointment.hasActiveAlert && (
                            <i className={`fas fa-bell ${styles.alertIcon}`} title="Patient has an active alert"></i>
                        )}
                        {appointment.PatientType && (
                            <span className={styles.patientTypeBadge}>
                                <i className="fas fa-tag"></i>
                                {appointment.PatientType}
                            </span>
                        )}
                    </div>
                    {appointment.AppDetail && (
                        <div className={styles.appointmentType}>
                            <i className={`fas fa-stethoscope ${styles.appointmentTypeIcon}`}></i>
                            {appointment.AppDetail}
                        </div>
                    )}
                </div>

                {showStatus && appointment.IsOrthoVisit && (
                    <div className={styles.infoLine2}>
                        <span
                            className={appointment.HasVisit ? styles.visitNotesRegistered : styles.visitNotesMissing}
                            title={appointment.HasVisit ? 'Visit notes registered ✓' : 'No visit notes yet'}
                        >
                            <i className={`fas fa-${appointment.HasVisit ? 'clipboard-check' : 'clipboard'}`}></i>
                        </span>
                    </div>
                )}
            </div>

            <div className={styles.actions}>
                {renderActions()}
            </div>
        </div>
    );
};

export type { AppointmentCardProps };
export default AppointmentCard;
