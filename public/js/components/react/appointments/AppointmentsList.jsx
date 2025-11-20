import AppointmentCard from './AppointmentCard.jsx';

/**
 * AppointmentsList Component
 * Renders a grid of appointment cards with loading and empty states
 *
 * Performance: Automatically optimized by React Compiler (React 19).
 * No manual memoization needed - the compiler handles it automatically.
 */
const AppointmentsList = ({
    title,
    appointments,
    showStatus,
    loading,
    onCheckIn,
    onMarkSeated,
    onMarkDismissed,
    onUndoState,
    emptyMessage = 'No appointments found.',
    className = ''
}) => {
    // Trust database ordering - stored procedure already sorts by PresentTime
    const sortedAppointments = appointments;

    // Render loading skeleton
    if (loading) {
        return (
            <div className={`appointments-section ${className}`}>
                <h3>{title}</h3>
                <div className="appointments-grid">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="skeleton-card">
                            <div className="skeleton skeleton-line"></div>
                            <div className="skeleton skeleton-line"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Render empty state
    if (!sortedAppointments || sortedAppointments.length === 0) {
        return (
            <div className={`appointments-section ${className}`}>
                <h3>{title}</h3>
                <p className="no-appointments">{emptyMessage}</p>
            </div>
        );
    }

    // Render appointments grid
    return (
        <div className={`appointments-section ${className}`}>
            <h3>{title}</h3>
            <div className="appointments-grid">
                {sortedAppointments.map(appointment => (
                    <AppointmentCard
                        key={appointment.appointmentID}
                        appointment={appointment}
                        showStatus={showStatus}
                        onCheckIn={onCheckIn}
                        onMarkSeated={onMarkSeated}
                        onMarkDismissed={onMarkDismissed}
                        onUndoState={onUndoState}
                    />
                ))}
            </div>
        </div>
    );
};

export default AppointmentsList;
