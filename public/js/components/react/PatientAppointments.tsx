import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import styles from './PatientAppointments.module.css';

interface PatientAppointment {
    appointmentID: number;
    AppDate: string;
    AppDetail?: string;
    DrName?: string;
}

interface PatientAppointmentsProps {
    personId?: number | null;
}

/**
 * PatientAppointments Component
 * Display and manage all appointments for a specific patient
 */
const PatientAppointments = ({ personId }: PatientAppointmentsProps) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    useEffect(() => {
        loadAppointments();
    }, [personId]);

    const loadAppointments = async (): Promise<void> => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`/api/patient-appointments/${personId}`);

            if (!response.ok) {
                throw new Error('Failed to load appointments');
            }

            const data = await response.json();
            setAppointments(data.appointments || []);
        } catch (err) {
            console.error('Error loading appointments:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (appointment: PatientAppointment): void => {
        // Navigate to edit page with appointment data as state
        navigate(`/patient/${personId}/edit-appointment/${appointment.appointmentID}`, {
            state: { appointment }
        });
    };

    const handleDelete = async (appointmentId: number): Promise<void> => {
        try {
            const response = await fetch(`/api/appointments/${appointmentId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete appointment');
            }

            // Reload appointments after deletion
            await loadAppointments();
            setDeleteConfirm(null);
        } catch (err) {
            console.error('Error deleting appointment:', err);
            toast.error('Failed to delete appointment: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const formatDateTime = (dateTime: string): string => {
        const date = new Date(dateTime);

        // Get day name
        const dayName = date.toLocaleString('en-US', { weekday: 'short' });

        // Get date components
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        // Get time
        const time = date.toLocaleString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        // Format: "Mon 25/12/2024 2:30 PM"
        return `${dayName} ${day}/${month}/${year} ${time}`;
    };

    const isPastAppointment = (dateTime: string): boolean => {
        return new Date(dateTime) < new Date();
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading appointments...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.errorState}>
                    <i className="fas fa-exclamation-circle"></i>
                    <p>{error}</p>
                    <button onClick={loadAppointments} className={cn('btn', styles.btnRetry)}>
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>
                    <i className="fas fa-calendar-check"></i> Patient Appointments
                </h2>
                <button
                    className={cn('btn', styles.btnNewAppointment)}
                    onClick={() => navigate(`/patient/${personId}/new-appointment`)}
                >
                    <i className="fas fa-plus"></i> New Appointment
                </button>
            </div>

            {appointments.length === 0 ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-calendar-times"></i>
                    <h3>No Appointments</h3>
                    <p>This patient has no appointments scheduled.</p>
                    <button
                        className={cn('btn', styles.btnNewAppointment)}
                        onClick={() => navigate(`/patient/${personId}/new-appointment`)}
                    >
                        <i className="fas fa-plus"></i> Schedule First Appointment
                    </button>
                </div>
            ) : (
                <div className={styles.list}>
                    {appointments.map(appointment => {
                        const isPast = isPastAppointment(appointment.AppDate);

                        return (
                            <div
                                key={appointment.appointmentID}
                                className={cn(styles.card, isPast ? styles.past : styles.upcoming)}
                            >
                                <div className={styles.main}>
                                    <div className={styles.icon}>
                                        <i className={`fas ${isPast ? 'fa-check-circle' : 'fa-calendar'}`}></i>
                                    </div>
                                    <div className={styles.details}>
                                        <div className={styles.date}>
                                            {formatDateTime(appointment.AppDate)}
                                        </div>
                                        <div className={styles.type}>
                                            {appointment.AppDetail || 'No details'}
                                        </div>
                                        {appointment.DrName && (
                                            <div className={styles.doctor}>
                                                <i className="fas fa-user-md"></i> {appointment.DrName}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className={styles.actions}>
                                    {!isPast && (
                                        <button
                                            className="btn-edit"
                                            onClick={() => handleEdit(appointment)}
                                            title="Edit appointment"
                                        >
                                            Edit
                                        </button>
                                    )}
                                    <button
                                        className="btn-delete"
                                        onClick={() => setDeleteConfirm(appointment.appointmentID)}
                                        title="Delete appointment"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className={styles.modalOverlay} onClick={() => setDeleteConfirm(null)}>
                    <div className={styles.modalContent} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <h3>
                            <i className="fas fa-exclamation-triangle"></i> Confirm Delete
                        </h3>
                        <p>Are you sure you want to delete this appointment?</p>
                        <div className={styles.modalActions}>
                            <button
                                className={cn('btn', styles.btnCancel)}
                                onClick={() => setDeleteConfirm(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn-delete"
                                onClick={() => handleDelete(deleteConfirm)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PatientAppointments;
