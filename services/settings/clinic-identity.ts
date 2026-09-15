/**
 * The clinic's own name as it appears INSIDE patient messages — one place, two languages.
 *
 * WHY THIS EXISTS. This is a commercial, multi-deployment product (CLAUDE.md opens by saying so):
 * every center runs its own instance and its own database. Ten outbound patient-message bodies
 * nevertheless had THIS clinic's identity compiled into them with no override —
 * `messaging-queries.ts` (six reminder bodies, EN + AR) and `whatsapp-batch-plan.ts` (four) — so a
 * second deployment would text its own patients *"your appointment with Dr. Shwan orthodontic
 * clinic"* / *"عيادة د.شوان لتقويم الاسنان"* (audit finding F7).
 *
 * WHY NOT THE EXISTING `CLINIC_NAME` ROW. Settings → General already stores a display name, used in
 * the header — and it holds "Shwan Orthodontics", while the messages say "Dr. Shwan orthodontic
 * clinic". Reusing it would have been tidier and would have silently reworded every reminder this
 * clinic sends. `whatsapp-batch-plan.ts`'s own header warns against exactly that ("collapsing them
 * into one shared template would silently rewrite messages patients receive"), so the message name
 * is its own pair of rows, seeded with the historical wording by
 * migrations/pg/1789460200000_clinic-message-name.sql. Today's installs therefore send
 * byte-identical text; a new deployment edits two fields in Settings → General.
 *
 * CACHING. Message builders run per recipient inside a batch loop, so a DB read per body would turn
 * one reminder run into hundreds of round trips. The pair is cached for CACHE_TTL_MS, and the
 * branding route clears it on write (`invalidateClinicIdentity()`), so a rename takes effect at once
 * rather than up to a TTL later. A read failure falls back to the defaults and never throws: the
 * clinic's name is not worth failing a reminder batch over.
 */
import { getOptions } from '../database/queries/options-queries.js';
import { log } from '../../utils/logger.js';

/** Option rows backing the two names (Settings → General). */
export const CLINIC_MESSAGE_NAME_OPTION = 'CLINIC_MESSAGE_NAME';
export const CLINIC_MESSAGE_NAME_AR_OPTION = 'CLINIC_MESSAGE_NAME_AR';

/**
 * Fallbacks — this clinic's own historical strings, so an install whose rows are missing (or
 * unreadable) sends exactly what it sent before this module existed. They are the DEFAULT, not the
 * value: nothing outside this file may hardcode them.
 */
export const DEFAULT_CLINIC_MESSAGE_NAME = 'Dr. Shwan orthodontic clinic';
export const DEFAULT_CLINIC_MESSAGE_NAME_AR = 'عيادة د.شوان لتقويم الاسنان';

export interface ClinicNames {
  /** Name to use in an English message body. */
  en: string;
  /** Name to use in an Arabic message body. */
  ar: string;
}

/** Long enough that a batch loop reads it once; short enough that a rename is never stuck. */
const CACHE_TTL_MS = 60_000;

let cache: { value: ClinicNames; at: number } | null = null;

/** The configured message names, or this clinic's defaults. Never throws. */
export async function getClinicNames(): Promise<ClinicNames> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const rows = await getOptions([CLINIC_MESSAGE_NAME_OPTION, CLINIC_MESSAGE_NAME_AR_OPTION]);
    const value: ClinicNames = {
      en: (rows.get(CLINIC_MESSAGE_NAME_OPTION) ?? '').trim() || DEFAULT_CLINIC_MESSAGE_NAME,
      ar: (rows.get(CLINIC_MESSAGE_NAME_AR_OPTION) ?? '').trim() || DEFAULT_CLINIC_MESSAGE_NAME_AR,
    };
    cache = { value, at: now };
    return value;
  } catch (err) {
    log.warn('Could not read the clinic message name; using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { en: DEFAULT_CLINIC_MESSAGE_NAME, ar: DEFAULT_CLINIC_MESSAGE_NAME_AR };
  }
}

/** Drop the cache — called by the branding route after a rename so it takes effect immediately. */
export function invalidateClinicIdentity(): void {
  cache = null;
}
