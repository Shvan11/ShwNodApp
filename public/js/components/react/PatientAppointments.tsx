import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { deleteJSON, httpErrorMessage } from '@/core/http';
import { formatAppointmentListDateTime } from '@/utils/formatters';
import { patientAppointmentsQuery } from '@/query/queries';
import { refreshAfterBooking } from './bookingError';
import styles from './PatientAppointments.module.css';

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
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const { data, isLoading: loading, error: queryError, refetch } = useQuery({
        ...patientAppointmentsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const appointments = data?.appointments ?? [];
    const error = queryError ? httpErrorMessage(queryError, t('form.errorUnknown')) : null;
    const deletingRef = useRef(false);

    const handleEdit = (appointmentId: number): void => {
        // The form reads the appointment by id itself (audit FE-F10-1).
        navigate(`/patient/${personId}/edit-appointment/${appointmentId}`);
    };

    // The shared confirm dialog, a success toast, and one DELETE per confirmation
    // however fast the second click (audit FE-F10-20: this was a bespoke modal).
    const handleDelete = async (appointmentId: number): Promise<void> => {
        if (deletingRef.current) return;
        const ok = await confirm(t('list.confirmDeleteText'), {
            title: t('list.confirmDeleteTitle'),
            danger: true,
            confirmText: t('list.delete'),
            cancelText: t('list.cancel'),
        });
        if (!ok || deletingRef.current) return;
        deletingRef.current = true;
        try {
            await deleteJSON(`/api/appointments/${appointmentId}`);
            toast.success(t('list.deleted'));
            // `patient.all`, not just its list: `patient.hasAppointment` is a sibling,
            // and the Works screen kept claiming an upcoming appointment. Deleting also
            // frees the slot (calendar + picker) and changes that day's board.
            refreshAfterBooking(queryClient, personId);
        } catch (err) {
            toast.error(httpErrorMessage(err, t('list.deleteFailed')));
        } finally {
            deletingRef.current = false;
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
                                            onClick={() => handleEdit(appointment.appointment_id)}
                                            title={t('list.editTitle')}
                                        >
                                            {t('list.edit')}
                                        </button>
                                    )}
                                    <button
                                        className="btn-delete"
                                        onClick={() => void handleDelete(appointment.appointment_id)}
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
        </div>
    );
};

export default PatientAppointments;
