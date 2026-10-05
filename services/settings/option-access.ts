/**
 * Who may read and write which `options` rows through the generic options API
 * (`/api/options`, `/api/options/:optionName`, `/api/options/bulk`) — audit FE-F21-1.
 *
 * The `options` table mixes three kinds of row: clinic preferences an admin edits
 * in Settings → General, runtime state the app writes for itself, and CREDENTIALS
 * that have screens of their own — the Telegram account's login session
 * (`gram_session`, Settings → Integrations: whoever holds it IS the clinic's
 * Telegram account), the SMTP password (Settings → Email, masked) and the Gemini
 * API key (Settings → Integrations, masked). The generic API returned every row
 * to any staff session, so a front-desk or clinical login could read all three.
 *
 * The rules:
 * - A credential row never leaves the server through the generic API, and the
 *   generic API never writes one — not even for an admin. Its own screen is the
 *   only way in. A name that merely LOOKS like a credential counts as one, so a
 *   secret added later is hidden by default instead of published by default.
 * - The full list (`GET /api/options`) is admin-only (Settings → General).
 * - Any other staff session may read, by name, only the rows the working screens
 *   need: the calendar's slot settings, the work form's default currency and the
 *   aligner-sets share.
 *
 * `option_name` is `citext`, so `GET /api/options/GRAM_SESSION` matches the
 * `gram_session` row. Every check here is case-insensitive for that reason.
 *
 * Pure (no DB, no config import) so it is unit-testable in the CI gate.
 */
import { DEFAULT_WORK_CURRENCY_OPTION } from '../../shared/work-currency.js';
import { ALIGNER_SETS_FOLDER_OPTION } from '../../shared/clinic-options.js';

/** The credential rows in use today. Each has its own settings screen. */
const SECRET_OPTION_NAMES = ['gram_session', 'EMAIL_SMTP_PASSWORD', 'gemini_api_key'];

/** A name that reads like a credential is treated as one (hidden unless allowed by name). */
const SECRET_NAME_PATTERN = /password|passwd|secret|token|api_?key|session|credential/i;

/** What a non-admin session may read by name — the rows the working screens read. */
const STAFF_READABLE_OPTION_NAMES = [
  'CALENDAR_EARLY_SLOTS',
  'CALENDAR_LATE_SLOTS',
  'CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT',
  DEFAULT_WORK_CURRENCY_OPTION,
  ALIGNER_SETS_FOLDER_OPTION,
];

const lower = (names: readonly string[]) => new Set(names.map((n) => n.toLowerCase()));
const SECRET = lower(SECRET_OPTION_NAMES);
const STAFF_READABLE = lower(STAFF_READABLE_OPTION_NAMES);

/** Is this option a credential the generic options API must never return or write? */
export function isSecretOption(name: string): boolean {
  return SECRET.has(name.toLowerCase()) || SECRET_NAME_PATTERN.test(name);
}

/** May a session with this role read this option by name? (Credentials: nobody.) */
export function canReadOption(name: string, isAdmin: boolean): boolean {
  if (isSecretOption(name)) return false;
  return isAdmin || STAFF_READABLE.has(name.toLowerCase());
}

/** The rows `GET /api/options` may return (admin-only route): everything but credentials. */
export function withoutSecretOptions<T extends { option_name: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isSecretOption(row.option_name));
}
