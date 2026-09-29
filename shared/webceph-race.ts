/**
 * The `race` WebCeph records when a patient is created there: which population's
 * cephalometric norms its AI analysis compares the patient against. Imported by
 * BOTH sides: the media contract (`z.enum`), `webceph-service` (validation and
 * fallback) and `WebCephModal` (its `<select>` and its default).
 *
 * WebCeph accepts exactly these four values (lower-case on the wire).
 *
 * THE DEFAULT IS CAUCASIAN. This clinic is in Iraq. Cephalometric norm sets
 * group Middle Eastern populations (Arab and Kurdish) with the Caucasian norms;
 * WebCeph's "Asian" norms are East Asian. The modal used to send 'Asian' for
 * every patient (audit FE-F9-11), so every analysis compared Iraqi patients
 * against the wrong norms. The modal shows this default and says it is the
 * default, and staff can pick another value for a patient of another
 * background. The value is sent once, when the patient is created in WebCeph.
 */

export const WEBCEPH_RACES = ['caucasian', 'asian', 'african', 'hispanic'] as const;

export type WebcephRace = (typeof WEBCEPH_RACES)[number];

/** Pre-selected for every new WebCeph patient — see the module comment. */
export const WEBCEPH_DEFAULT_RACE: WebcephRace = 'caucasian';

export const WEBCEPH_RACE_LABELS: Record<WebcephRace, string> = {
  caucasian: 'Caucasian',
  asian: 'Asian',
  african: 'African',
  hispanic: 'Hispanic',
};
