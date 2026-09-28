/**
 * The `patients.language` codebook (FE-F6-2). The senders and the forms both read it from
 * `patient-language.ts`; this pins the meaning itself, which the stored data already carries —
 * changing a number here re-labels live patients and re-routes their reminders.
 */
import { describe, it, expect } from 'vitest';
import {
  PATIENT_LANGUAGE,
  PATIENT_LANGUAGE_OPTIONS,
  patientLanguageKey,
  reminderLanguage,
} from './patient-language.js';

describe('patient language codebook', () => {
  it('is 0 Arabic · 1 English · 2 Kurdish — the legacy procs’ meaning', () => {
    expect(PATIENT_LANGUAGE).toEqual({ ARABIC: 0, ENGLISH: 1, KURDISH: 2 });
    expect(patientLanguageKey(0)).toBe('arabic');
    expect(patientLanguageKey(1)).toBe('english');
    expect(patientLanguageKey(2)).toBe('kurdish');
    expect(patientLanguageKey(null)).toBeNull();
    expect(patientLanguageKey(7)).toBeNull();
  });

  it('offers every code exactly once', () => {
    const codes = PATIENT_LANGUAGE_OPTIONS.map((o) => o.code);
    expect([...codes].sort()).toEqual(Object.values(PATIENT_LANGUAGE).sort());
  });

  it('sends the English body only to English; everything else gets Arabic', () => {
    expect(reminderLanguage(PATIENT_LANGUAGE.ENGLISH)).toBe('en');
    for (const code of [PATIENT_LANGUAGE.ARABIC, PATIENT_LANGUAGE.KURDISH, null, undefined, 9]) {
      expect(reminderLanguage(code)).toBe('ar');
    }
  });
});
