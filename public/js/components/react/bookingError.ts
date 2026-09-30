import type { TFunction } from 'i18next';
import type { QueryClient } from '@tanstack/react-query';
import { httpErrorMessage, postJSON, type HttpError } from '@/core/http';
import { qk } from '@/query/keys';

/** The body the appointment create/update routes send with a refusal. */
interface BookingErrorBody {
    code?: string;
    details?: {
        code?: string;
        holidayName?: string;
    };
}

/**
 * Turn a failed create/update of an appointment into the booking forms' message.
 *
 * The server names each refusal by code: `HOLIDAY_CONFLICT`, `APPOINTMENT_CONFLICT`
 * (one per patient per day), `SLOT_FULL` (the slot already holds
 * `MaxAppointmentsPerSlot`, audit FE-F10-7), `PAST_SLOT` (a move into a time that
 * has passed, FE-F10-8) and `INVALID_DOCTOR` (not an active Doctor, FE-F10-13).
 * Conflicts go through `ErrorResponses.conflict()` (code nested under `details`),
 * others through `badRequest` (code at `details.code` too, root on some routes),
 * so both are read. Shared by the new and edit forms, so the Arabic form never
 * shows the server's English text for a known refusal (FE-F10-17).
 */
export function bookingError(
    err: unknown,
    t: TFunction<'appointments'>
): { code: string | undefined; message: string } {
    const body = (err as HttpError | undefined)?.data as BookingErrorBody | undefined;
    const code = body?.code ?? body?.details?.code;

    switch (code) {
        case 'HOLIDAY_CONFLICT':
            return {
                code,
                message: t('form.errorHolidayConflict', {
                    holiday: body?.details?.holidayName || t('calendar.holiday'),
                }),
            };
        case 'APPOINTMENT_CONFLICT':
            return { code, message: t('form.errorAppointmentConflict') };
        case 'SLOT_FULL':
            return { code, message: t('form.errorSlotFull') };
        case 'PAST_SLOT':
            return { code, message: t('form.errorPastSlot') };
        case 'INVALID_DOCTOR':
            return { code, message: t('form.errorInvalidDoctor') };
        default:
            return { code, message: httpErrorMessage(err, t('form.errorUnknown')) };
    }
}

interface BookingToast {
    success: (message: string) => void;
    warning: (message: string) => void;
    error: (message: string) => void;
}

/**
 * Send the patient the appointment's WhatsApp confirmation, and report the
 * outcome. Fire-and-forget: the booking itself has already succeeded. Both forms
 * ran their own copy of this.
 */
export function sendAppointmentConfirmation(
    appointmentId: number | string,
    toast: BookingToast,
    t: TFunction<'appointments'>
): void {
    postJSON<{ success: boolean; message?: string }>('/api/wa/send-appointment', { appointmentId })
        .then(waResult => {
            if (waResult.success) toast.success(t('form.waSent'));
            else toast.warning(waResult.message || t('form.waFailed'));
        })
        .catch(err => {
            toast.error(t('form.waError', { error: httpErrorMessage(err, t('form.waFailed')) }));
        });
}

/**
 * Refresh everything an appointment write changes: the patient's own reads
 * (list + has-appointment flag), the calendar and the booking picker's slots
 * (the control whose job is to stop a double-book; /calendar has no SSE), and
 * the daily boards (FE-F11-17).
 */
export function refreshAfterBooking(queryClient: QueryClient, personId: number | string | null | undefined): void {
    if (personId) void queryClient.invalidateQueries({ queryKey: qk.patient.all(personId) });
    void queryClient.invalidateQueries({ queryKey: qk.calendar.all() });
    void queryClient.invalidateQueries({ queryKey: qk.appointments.all() });
}
