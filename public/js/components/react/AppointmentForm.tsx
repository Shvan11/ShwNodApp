import { useState } from 'react';
import type { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import BookingForm, { type BookingValues } from './BookingForm';
import { useToast } from '../../contexts/ToastContext';
import { postJSON } from '@/core/http';
import { bookingError, refreshAfterBooking, sendAppointmentConfirmation } from './bookingError';
import { qk } from '@/query/keys';
import * as appointment from '@shared/contracts/appointment.contract';

interface AppointmentFormProps {
    personId?: number | null;
    onClose?: () => void;
    onSuccess?: (result: unknown) => void;
}

/**
 * AppointmentForm — book a new appointment for a patient. The page itself (the
 * picker and the details column) is the shared `BookingForm`.
 */
const AppointmentForm = ({ personId, onClose, onSuccess }: AppointmentFormProps) => {
    const { t } = useTranslation('appointments');
    const toast = useToast();
    const queryClient = useQueryClient();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (values: BookingValues): Promise<void> => {
        setSubmitting(true);
        setError(null);
        try {
            const result = await postJSON<z.infer<typeof appointment.createAppointment.response>>(
                '/api/appointments',
                {
                    person_id: Number(personId),
                    app_date: `${values.AppDate}T${values.AppTime}:00`,
                    app_detail: values.AppDetail,
                    dr_id: parseInt(values.DrID, 10)
                },
                { schema: appointment.createAppointment.response }
            );

            if (result.appointment_id != null) {
                sendAppointmentConfirmation(result.appointment_id, toast, t);
            }
            refreshAfterBooking(queryClient, personId);

            // onSuccess navigates; onClose is only the fallback.
            if (onSuccess) onSuccess(result);
            else onClose?.();
        } catch (err) {
            const { code, message } = bookingError(err, t);
            setError(message);
            // The picker's slots are a cached read: after a refusal for a full slot,
            // show the slot as it really is now.
            if (code === 'SLOT_FULL') {
                void queryClient.invalidateQueries({ queryKey: qk.calendar.all() });
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <BookingForm
            personId={personId}
            submitting={submitting}
            error={error}
            onSubmit={values => void handleSubmit(values)}
            onClose={onClose}
        />
    );
};

export default AppointmentForm;
