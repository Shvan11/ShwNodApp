import type { TFunction } from 'i18next';
import { httpErrorMessage, type HttpError } from '@/core/http';

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
 * (one per patient per day) and `SLOT_FULL` (the slot already holds
 * `MaxAppointmentsPerSlot`, audit FE-F10-7). Conflicts go through
 * `ErrorResponses.conflict()` (code nested under `details`), others through
 * `badRequest` (code at `details.code` too, root on some routes), so both are
 * read. Shared by the new and edit forms: the edit form used to have no mapping
 * at all and showed the server's English text on the Arabic form (FE-F10-17).
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
        default:
            return { code, message: httpErrorMessage(err, t('form.errorUnknown')) };
    }
}
