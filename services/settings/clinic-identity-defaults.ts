/**
 * The pure half of the clinic's message identity: the fallback names and the shape they travel in.
 *
 * Split out of `clinic-identity.ts` so it can be imported with NO side effects. That module reads the
 * configured names from the options table, which means importing it loads `kysely.ts` and, through
 * it, `config/config.ts` — which validates the boot environment at import time and throws without a
 * database configured. Pure code (`whatsapp-batch-plan.ts`) and its tests need only the data below,
 * and must not inherit that requirement: a test that pulled it in passed on a machine with a `.env`
 * and failed in CI, which has none.
 *
 * Keep this file free of imports. Consumers that also need the configured VALUE go through
 * `clinic-identity.ts`, which re-exports everything here.
 */

/**
 * Fallbacks — this clinic's own historical strings, so an install whose rows are missing (or
 * unreadable) sends exactly what it sent before the names were configurable. They are the DEFAULT,
 * not the value: nothing outside this file and `clinic-identity.ts` may hardcode them.
 */
export const DEFAULT_CLINIC_MESSAGE_NAME = 'Dr. Shwan orthodontic clinic';
export const DEFAULT_CLINIC_MESSAGE_NAME_AR = 'عيادة د.شوان لتقويم الاسنان';

export interface ClinicNames {
  /** Name to use in an English message body. */
  en: string;
  /** Name to use in an Arabic message body. */
  ar: string;
}
