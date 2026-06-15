import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import Modal from './Modal';
import { deleteJSON, httpErrorMessage } from '@/core/http';
import { patientAppointmentsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import styles from './PatientAppointments.module.css';

interface PatientAppointment {
    appointment_id: number;
    app_date: string;
    app_detail?: string | null;
    DrName?: string | null;
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
    const queryClient = useQueryClient();
    const { data, isLoading: loading, error: queryError, refetch } = useQuery({
        ...patientAppointmentsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const appointments: PatientAppointment[] = data?.appointments ?? [];
    const error = queryError ? httpErrorMessage(queryError, 'Unknown error') : null;
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    const handleEdit = (appointment: PatientAppointment): void => {
        // Navigate to edit page with appointment data as state
        navigate(`/patient/${personId}/edit-appointment/${appointment.appointment_id}`, {
            state: { appointment }
        });
    };

    const handleDelete = async (appointmentId: number): Promise<void> => {
        try {
            await deleteJSON(`/api/appointments/${appointmentId}`);

            // Refresh appointments after deletion
            await queryClient.invalidateQueries({ queryKey: qk.patient.appointments(personId ?? '') });
            setDeleteConfirm(null);
        } catch (err) {
            console.error('Error deleting appointment:', err);
            toast.error(httpErrorMessage(err, 'Failed to delete appointment'));
        }
    };

    const formatDateTime = (dateTime: string): string => {
        const date = new Date(dateTime);

        // Get day name
        const dayName = date.toLocaleString(undefined, { weekday: 'short' });

        // Get date components
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        // Get time
        const time = date.toLocaleString(undefined, {
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
                    <button onClick={() => refetch()} className={cn('btn', styles.btnRetry)}>
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
                        const isPast = isPastAppointment(appointment.app_date);

                        return (
                            <div
                                key={appointment.appointment_id}
                                className={cn(styles.card, isPast ? styles.past : styles.upcoming)}
                            >
                                <div className={styles.main}>
                                    <div className={styles.icon}>
                                        <i className={`fas ${isPast ? 'fa-check-circle' : 'fa-calendar'}`}></i>
                                    </div>
                                    <div className={styles.details}>
                                        <div className={styles.date}>
                                            {formatDateTime(appointment.app_date)}
                                        </div>
                                        <div className={styles.type}>
                                            {appointment.app_detail || 'No details'}
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
                                        onClick={() => setDeleteConfirm(appointment.appointment_id)}
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
            <Modal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                contentClassName={styles.modalContent}
                ariaLabelledBy="patient-appointments-delete-title"
            >
                <h3 id="patient-appointments-delete-title">
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
                        onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
                    >
                        Delete
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default PatientAppointments;
