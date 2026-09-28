/**
 * `patients.language` — the ONE place its numbers get a meaning. Imported by the three reminder
 * builders (which pick the message body) AND the three demographics screens (which label the
 * picker), so the two can no longer drift apart.
 *
 * WHY THIS EXISTS (frontend audit FE-F6-2). The two sides had never agreed. Every sender followed
 * the legacy SQL-Server procs — `IF @Language = 1 -- English`, anything else gets the Arabic body —
 * while the forms labelled the same numbers 0 = Kurdish · 1 = Arabic · 2 = English (and the first
 * React form, 2025-07-02, had 0 = English · 1 = Arabic · 2 = Kurdish). So a patient marked
 * *English* got Arabic reminders and one marked *Arabic* got English ones.
 *
 * THE CODEBOOK (owner's call, 2026-09-28) keeps the meaning the senders and the stored data already
 * share, and relabels the UI to it. That made the fix a no-op for the data: the three live `1` rows
 * are Latin-named patients set under the legacy app (English), the one live `2` was set while the
 * form labelled 2 as Kurdish, and `0` is the column default.
 *
 * KURDISH is a real choice with no template of its own yet: it gets the Arabic body, like the
 * default. When a Kurdish body is written, it branches on `PATIENT_LANGUAGE.KURDISH` here and in
 * `reminderLanguage()` — nowhere else.
 */

export const PATIENT_LANGUAGE = {
  ARABIC: 0,
  ENGLISH: 1,
  KURDISH: 2,
} as const;

export type PatientLanguageCode = (typeof PATIENT_LANGUAGE)[keyof typeof PATIENT_LANGUAGE];

/**
 * The picker, in display order. `key` is the `patients:languages.<key>` label, so the forms render
 * `t(\`languages.${key}\`)` and never pair a number with a label by hand.
 */
export const PATIENT_LANGUAGE_OPTIONS = [
  { code: PATIENT_LANGUAGE.ARABIC, key: 'arabic' },
  { code: PATIENT_LANGUAGE.ENGLISH, key: 'english' },
  { code: PATIENT_LANGUAGE.KURDISH, key: 'kurdish' },
] as const;

/** The i18n key suffix for a stored code, or `null` for NULL / an unknown value. */
export function patientLanguageKey(
  code: number | null | undefined
): (typeof PATIENT_LANGUAGE_OPTIONS)[number]['key'] | null {
  return PATIENT_LANGUAGE_OPTIONS.find((o) => o.code === code)?.key ?? null;
}

/**
 * Which body a patient-facing message goes out in. English only for ENGLISH; Arabic for everything
 * else — Arabic, Kurdish (until it has a template), NULL, and any unknown value — which is exactly
 * the legacy procs' `ELSE -- Default to Arabic` branch.
 */
export function reminderLanguage(code: number | null | undefined): 'en' | 'ar' {
  return code === PATIENT_LANGUAGE.ENGLISH ? 'en' : 'ar';
}
