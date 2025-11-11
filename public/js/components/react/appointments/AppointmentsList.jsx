import React from 'react';
import AppointmentCard from './AppointmentCard.jsx';

/**
 * AppointmentsList Component
 * Renders a grid of appointment cards with loading and empty states
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
    onContextMenu,
    emptyMessage = 'No appointments found.'
}) => {
    // Sort checked-in appointments by check-in time (earliest first)
    const sortedAppointments = showStatus && appointments
        ? [...appointments].sort((a, b) => {
            const timeA = a.PresentTime || '99:99';
            const timeB = b.PresentTime || '99:99';

            const [hoursA, minutesA] = timeA.split(':').map(Number);
            const [hoursB, minutesB] = timeB.split(':').map(Number);

            const totalMinutesA = (hoursA || 0) * 60 + (minutesA || 0);
            const totalMinutesB = (hoursB || 0) * 60 + (minutesB || 0);

            return totalMinutesA - totalMinutesB;
        })
        : appointments;

    // Render loading skeleton
    if (loading) {
        return (
            <div className="appointments-section">
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
            <div className="appointments-section">
                <h3>{title}</h3>
                <p className="no-appointments">{emptyMessage}</p>
            </div>
        );
    }

    // Render appointments grid
    return (
        <div className="appointments-section">
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
                        onContextMenu={onContextMenu}
                    />
                ))}
            </div>
        </div>
    );
};

export default AppointmentsList;
