import AppointmentCard, { type DailyAppointment } from './AppointmentCard';
import styles from './AppointmentsList.module.css';

interface AppointmentsListProps {
    title: string;
    appointments: DailyAppointment[];
    showStatus: boolean;
    loading: boolean;
    onCheckIn?: (appointmentId: number) => void;
    onMarkSeated?: (appointmentId: number) => void;
    onMarkDismissed?: (appointmentId: number) => void;
    onUndoState?: (appointmentId: number, state: string) => void;
    emptyMessage?: string;
    className?: string;
}

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
}: AppointmentsListProps) => {
    // Trust database ordering - stored procedure already sorts by PresentTime
    const sortedAppointments = appointments;

    // Only show skeletons on INITIAL load (no data yet)
    // During refresh, keep existing list visible to prevent height collapse
    const showSkeletons = loading && (!sortedAppointments || sortedAppointments.length === 0);

    // Check if we're refreshing (loading with existing data)
    const isRefreshing = loading && sortedAppointments && sortedAppointments.length > 0;

    // Helper to get section class based on state
    const getSectionClass = (isActiveView: boolean, isRefreshingState: boolean): string => {
        if (isActiveView) {
            return isRefreshingState ? `${styles.activeView} ${styles.refreshing}` : styles.activeView;
        }
        return isRefreshingState ? styles.refreshing : styles.section;
    };

    const isActiveView = className.includes('active-view');

    // Render loading skeleton (initial load only)
    if (showSkeletons) {
        return (
            <div className={getSectionClass(isActiveView, false)}>
                <h3 className={styles.title}>{title}</h3>
                <div className={styles.grid}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className={styles.skeletonCard}>
                            <div className={styles.skeletonLine}></div>
                            <div className={styles.skeletonLine}></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Render empty state
    if (!sortedAppointments || sortedAppointments.length === 0) {
        return (
            <div className={getSectionClass(isActiveView, false)}>
                <h3 className={styles.title}>{title}</h3>
                <p className={styles.empty}>{emptyMessage}</p>
            </div>
        );
    }

    // Render appointments grid
    // Add 'refreshing' class during reload to dim list and prevent clicks
    return (
        <div className={getSectionClass(isActiveView, isRefreshing)}>
            <h3 className={styles.title}>{title}</h3>
            <div className={styles.grid}>
                {sortedAppointments.map(appointment => (
                    <AppointmentCard
                        key={appointment.appointmentID || appointment.AppointmentID}
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

export type { AppointmentsListProps };
export default AppointmentsList;
