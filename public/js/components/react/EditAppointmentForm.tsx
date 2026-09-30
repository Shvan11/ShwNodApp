import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import BookingForm, { type BookingValues } from './BookingForm';
import { useToast } from '../../contexts/ToastContext';
import { putJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { appointmentByIdQuery } from '@/query/queries';
import type { AppointmentByIdResponse } from '@shared/contracts/appointment.contract';
import { bookingError, refreshAfterBooking, sendAppointmentConfirmation } from './bookingError';
import styles from './AppointmentForm.module.css';

interface EditAppointmentFormProps {
    personId?: number | null;
    appointmentId?: number | string;
    onClose?: () => void;
    onSuccess?: () => void;
}

/** `app_date` is a local wall-clock 'YYYY-MM-DDTHH:MM:SS' (to_char), so it splits as text. */
const toValues = (appt: AppointmentByIdResponse['appointment']): BookingValues => ({
    AppDate: appt.app_date.slice(0, 10),
    AppTime: appt.app_date.slice(11, 16),
    AppDetail: appt.app_detail ?? '',
    DrID: appt.dr_id != null ? String(appt.dr_id) : ''
});

/**
 * EditAppointmentForm — change an existing appointment's time, doctor or type.
 * The page itself is the shared `BookingForm`.
 */
const EditAppointmentForm = ({ personId, appointmentId, onClose, onSuccess }: EditAppointmentFormProps) => {
    const { t } = useTranslation('appointments');
    const toast = useToast();
    const queryClient = useQueryClient();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Always read the appointment itself, fresh on every open. The callers used
    // to hand over a row as router state and the form trusted it: the calendar's
    // row names its fields `appDetail`/`drID`, so Edit from the calendar opened
    // with Doctor and Type blank, and a Back/Forward into an old edit entry
    // re-seeded pre-edit values (audit FE-F10-1). Router state is not read.
    const appointmentQ = useQuery({
        ...appointmentByIdQuery(appointmentId),
        refetchOnMount: 'always',
    });
    const stored = appointmentQ.data?.appointment ?? null;

    if (appointmentId && appointmentQ.isLoading) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>{t('form.loadingData')}</p>
                </div>
            </div>
        );
    }

    const seed = stored ? toValues(stored) : null;
    const seedKey = stored
        ? `${stored.appointment_id}|${stored.app_date}|${stored.dr_id ?? ''}|${stored.app_detail ?? ''}`
        : '';
    const currentDoctor = stored?.dr_id != null
        ? { id: stored.dr_id, name: stored.DrName ?? `#${stored.dr_id}` }
        : null;

    const handleSubmit = async (values: BookingValues): Promise<void> => {
        if (!appointmentId || !stored) return;
        setSubmitting(true);
        setError(null);
        try {
            // A void success: the funnel resolves on 2xx and throws otherwise, so
            // there is no `success` flag to check (audit FE-F10-18).
            await putJSON(`/api/appointments/${appointmentId}`, {
                person_id: stored.person_id,
                app_date: `${values.AppDate}T${values.AppTime}:00`,
                app_detail: values.AppDetail,
                dr_id: parseInt(values.DrID, 10)
            });

            if (values.AppDate !== toValues(stored).AppDate) {
                sendAppointmentConfirmation(appointmentId, toast, t);
            }
            refreshAfterBooking(queryClient, personId ?? stored.person_id);

            // ONE navigation. Success used to call onSuccess and then onClose, and
            // both went back a page, so Update landed two pages back (FE-F10-9).
            if (onSuccess) onSuccess();
            else onClose?.();
        } catch (err) {
            const { code, message } = bookingError(err, t);
            setError(message);
            if (code === 'SLOT_FULL' || code === 'PAST_SLOT') {
                void queryClient.invalidateQueries({ queryKey: qk.calendar.all() });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const loadError = appointmentQ.isError
        ? httpErrorMessage(appointmentQ.error, t('form.errorUnknown'))
        : null;

    return (
        <BookingForm
            isEdit
            personId={personId}
            seed={seed}
            seedKey={seedKey}
            currentDoctor={currentDoctor}
            submitting={submitting}
            error={error ?? loadError}
            onSubmit={values => void handleSubmit(values)}
            onClose={onClose}
        />
    );
};

export default EditAppointmentForm;
