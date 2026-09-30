import { toLocalDateString } from './calendarDate';

const STORAGE_KEY = 'lastAppointmentDate';

/**
 * Remember the date the daily board is showing, so the header and the
 * Dashboard tile can reopen it — but only a date the user PICKED. A board that
 * was following today stores nothing, so it reopens on the new today the next
 * morning. It used to store today's date like any other, and a tab left open
 * overnight reopened yesterday's list (audit FE-F11-8b).
 */
export function rememberAppointmentDate(date: string): void {
    try {
        if (!date || date === toLocalDateString(new Date())) sessionStorage.removeItem(STORAGE_KEY);
        else sessionStorage.setItem(STORAGE_KEY, date);
    } catch {
        // Storage unavailable (private mode / quota): the board just opens on today.
    }
}

/** Where "Appointments" should go: the remembered date, or today. */
export function appointmentsPath(): string {
    let stored: string | null;
    try {
        stored = sessionStorage.getItem(STORAGE_KEY);
    } catch {
        stored = null;
    }
    return `/appointments?date=${stored || toLocalDateString(new Date())}`;
}
