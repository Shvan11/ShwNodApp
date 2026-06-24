import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import Modal from './Modal';
import { deleteJSON, httpErrorMessage } from '@/core/http';
import { formatAppointmentListDateTime } from '@/utils/formatters';
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
    const { t } = useTranslation('appointments');
    const { language } = useLanguage();
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
            toast.error(httpErrorMessage(err, t('list.deleteFailed')));
        }
    };

    // Day-prefixed date+time, e.g. "Mon 25/12/2024 2:30 PM" / "سبت 25/12/2026 2:30 م".
    // The weekday + meridiem localize; day/month/year stay Western digits.
    const formatDateTime = (dateTime: string): string => formatAppointmentListDateTime(new Date(dateTime), language);

    const isPastAppointment = (dateTime: string): boolean => {
        return new Date(dateTime) < new Date();
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>{t('list.loading')}</p>
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
                        <i className="fas fa-redo"></i> {t('list.retry')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>
                    <i className="fas fa-calendar-check"></i> {t('list.title')}
                </h2>
                <button
                    className={cn('btn', styles.btnNewAppointment)}
                    onClick={() => navigate(`/patient/${personId}/new-appointment`)}
                >
                    <i className="fas fa-plus"></i> {t('list.newAppointment')}
                </button>
            </div>

            {appointments.length === 0 ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-calendar-times"></i>
                    <h3>{t('list.emptyTitle')}</h3>
                    <p>{t('list.emptyText')}</p>
                    <button
                        className={cn('btn', styles.btnNewAppointment)}
                        onClick={() => navigate(`/patient/${personId}/new-appointment`)}
                    >
                        <i className="fas fa-plus"></i> {t('list.scheduleFirst')}
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
                                            {appointment.app_detail || t('list.noDetails')}
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
                                            title={t('list.editTitle')}
                                        >
                                            {t('list.edit')}
                                        </button>
                                    )}
                                    <button
                                        className="btn-delete"
                                        onClick={() => setDeleteConfirm(appointment.appointment_id)}
                                        title={t('list.deleteTitle')}
                                    >
                                        {t('list.delete')}
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
                    <i className="fas fa-exclamation-triangle"></i> {t('list.confirmDeleteTitle')}
                </h3>
                <p>{t('list.confirmDeleteText')}</p>
                <div className={styles.modalActions}>
                    <button
                        className={cn('btn', styles.btnCancel)}
                        onClick={() => setDeleteConfirm(null)}
                    >
                        {t('list.cancel')}
                    </button>
                    <button
                        className="btn-delete"
                        onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
                    >
                        {t('list.delete')}
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default PatientAppointments;
