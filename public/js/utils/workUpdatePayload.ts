/**
 * The body of PUT /api/updatework for the work edit form: the work's id plus only
 * the fields the user changed.
 *
 * The form used to send every field. The server's update is presence-keyed (a key
 * that is sent is a column that is written), so a save rewrote the whole row with
 * the values the form OPENED with: a colleague's change made meanwhile on another
 * PC — a new total approved from the queue, a re-attributed doctor — was silently
 * put back. A held edit kept the same full snapshot and replayed it on approval.
 * Sending the difference leaves every untouched column alone, on both paths.
 */

/** The work fields the edit form holds, as it holds them (selects and dates are strings). */
export interface WorkEditFields {
    total_required: number;
    currency: string;
    type_of_work: string;
    notes: string;
    status: number;
    start_date: string;
    debond_date: string;
    f_photo_date: string;
    i_photo_date: string;
    estimated_duration: string;
    dr_id: string;
    notes_date: string;
    keyword_id_1: string;
    keyword_id_2: string;
    keyword_id_3: string;
    keyword_id_4: string;
    keyword_id_5: string;
    discount: number;
    discount_date: string;
    discount_reason: string;
}

/** Sent as they are when they differ from what the form opened with. */
const PLAIN_FIELDS = [
    'total_required',
    'currency',
    'type_of_work',
    'notes',
    'status',
    'start_date',
    'debond_date',
    'f_photo_date',
    'i_photo_date',
    'estimated_duration',
    'dr_id',
    'notes_date',
    'keyword_id_1',
    'keyword_id_2',
    'keyword_id_3',
    'keyword_id_4',
    'keyword_id_5',
] as const satisfies readonly (keyof WorkEditFields)[];

/** One decision on the server (amount, date and reason travel together). */
const DISCOUNT_FIELDS = ['discount', 'discount_date', 'discount_reason'] as const;

/**
 * @param today 'YYYY-MM-DD', the date a new discount takes when none was typed
 * @returns the body to send, or `null` when the form holds no change
 */
export function buildWorkUpdatePayload(
    workId: number,
    form: WorkEditFields,
    baseline: WorkEditFields,
    today: string
): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};

    for (const field of PLAIN_FIELDS) {
        if (form[field] !== baseline[field]) payload[field] = form[field];
    }

    if (DISCOUNT_FIELDS.some((field) => form[field] !== baseline[field])) {
        // No amount = no discount: null clears all three (the contract's "clear it" signal).
        const amount = Number(form.discount) || 0;
        payload.discount = amount > 0 ? amount : null;
        payload.discount_date = amount > 0 ? form.discount_date || today : null;
        payload.discount_reason = amount > 0 ? form.discount_reason || null : null;
    }

    return Object.keys(payload).length > 0 ? { workId, ...payload } : null;
}
