import { useNavigate } from 'react-router-dom';
import styles from './AppointmentCard.module.css';

// Daily appointment interface matching getDailyAppointmentsOptimized output
export interface DailyAppointment {
    appointment_id?: number;
    person_id?: number;
    patient_name?: string;
    patient_type?: string | null;
    Phone?: string | null;
    apptime?: string | null;
    app_detail?: string | null;
    Notes?: string | null;
    present?: string | null;
    seated?: string | null;
    dismissed?: string | null;
    present_time?: string | null;
    seated_time?: string | null;
    dismissed_time?: string | null;
    hasActiveAlert?: boolean;
    is_ortho_visit?: boolean;
    has_visit?: boolean | number | null;
    app_date?: Date | string | null;
    app_cost?: number | null;
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
            return appointment.present || appointment.seated || appointment.dismissed ? 'Checked In' : 'Scheduled';
        }

        if (appointment.dismissed) return 'Dismissed';
        if (appointment.seated) return 'Seated';
        if (appointment.present) return 'Present';
        return 'Scheduled';
    };

    const status = getCurrentStatus();
    const statusClass = status.toLowerCase().replace(' ', '-');

    // Check if patient is waiting (present but not seated and not dismissed)
    const isWaiting = showStatus && appointment.present && !appointment.seated && !appointment.dismissed;

    const navigate = useNavigate();

    // Open patient using React Router navigation
    const handlePatientClick = (e: React.MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (appointment.person_id) {
            navigate(`/patient/${appointment.person_id}/works`);
        }
    };

    // Get state times
    const presentTime = appointment.present_time ? formatTime(appointment.present_time) : null;
    const seatedTime = appointment.seated_time ? formatTime(appointment.seated_time) : null;
    const dismissedTime = appointment.dismissed_time ? formatTime(appointment.dismissed_time) : null;

    // Helper to get button class based on state
    const getButtonClass = (isActive: boolean, isClickable: boolean, isWaitingState: boolean = false): string => {
        if (isWaitingState) return styles.statusWaiting;
        if (isActive) return styles.statusActive;
        if (isClickable) return styles.statusInactiveClickable;
        return styles.statusInactive;
    };

    // Render action buttons based on status
    const renderActions = (): React.ReactNode => {
        const appointmentId = appointment.appointment_id;
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
            // Use the *_time fields because the API returns present_time/seated_time/dismissed_time
            const isPresent = appointment.present_time;
            const isSeated = appointment.seated_time;
            const isDismissed = appointment.dismissed_time;

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
                                onUndoState(appointmentId, 'present');
                            }
                        }}
                        title={canUndoPresent ? `Checked In: ${presentTime} - Click to undo` : (isSeated ? "Cannot undo: Patient is already seated" : "Cannot undo: Visit is completed")}
                        disabled={!canUndoPresent}
                    >
                        <i className="fas fa-user-check"></i>
                        {presentTime && <span className={styles.statusTime}>{presentTime}</span>}
                    </button>

                    {/* Seated icon with time - Orange when seated (not dismissed), Green when dismissed, gray when not seated yet */}
                    <button
                        type="button"
                        className={isSeated ? (isDismissed ? styles.statusActive : styles.statusSeated) : styles.statusInactiveClickable}
                        onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isSeated && canUndoSeated && onUndoState) {
                                onUndoState(appointmentId, 'seated');
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
                                onUndoState(appointmentId, 'dismissed');
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

    // Build card classes dynamically. The fade-in animation plays once when the
    // card mounts: a CSS animation runs only on the element's first paint and
    // doesn't replay on re-render (the DOM node persists), so no mount flag is
    // needed — the previous setState-on-mount actually cut the animation short.
    const cardClass = isWaiting ? styles.waiting : styles.card;

    return (
        <div
            className={`${cardClass} ${styles.fadeInUp}`}
            data-appointment-id={appointment.appointment_id}
            data-status={statusClass}
        >
            <div className={styles.time}>
                {appointment.apptime || 'N/A'}
            </div>

            <div className={styles.info}>
                <div className={styles.infoLine1}>
                    <div className={styles.patientName}>
                        <a
                            href={appointment.person_id ? `/patient/${appointment.person_id}/works` : '#'}
                            className={styles.patientLink}
                            onClick={handlePatientClick}
                        >
                            {appointment.patient_name || 'Unknown'}
                        </a>
                        {appointment.hasActiveAlert && (
                            <i className={`fas fa-bell ${styles.alertIcon}`} title="Patient has an active alert"></i>
                        )}
                        {/* "Active" is the overwhelming default — badging it on every
                            row is noise. Only surface the exceptional types (New,
                            Walk in, …). */}
                        {appointment.patient_type && appointment.patient_type.toLowerCase() !== 'active' && (
                            <span className={styles.patientTypeBadge}>
                                <i className="fas fa-tag"></i>
                                {appointment.patient_type}
                            </span>
                        )}
                    </div>
                    {appointment.app_detail && (
                        <div className={styles.appointmentType}>
                            {appointment.app_detail}
                        </div>
                    )}
                </div>

                {showStatus && appointment.is_ortho_visit && (
                    <div className={styles.infoLine2}>
                        <span
                            className={appointment.has_visit ? styles.visitNotesRegistered : styles.visitNotesMissing}
                            title={appointment.has_visit ? 'Visit notes registered ✓' : 'No visit notes yet'}
                        >
                            <i className={`fas fa-${appointment.has_visit ? 'clipboard-check' : 'clipboard'}`}></i>
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
