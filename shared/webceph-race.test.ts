import { describe, expect, it } from 'vitest';
import { createPatient } from './contracts/media.contract';
import { WEBCEPH_DEFAULT_RACE, WEBCEPH_RACES, WEBCEPH_RACE_LABELS } from './webceph-race';

describe('WebCeph race', () => {
  it('defaults to the Caucasian norm set (the clinic is in Iraq — FE-F9-11)', () => {
    expect(WEBCEPH_DEFAULT_RACE).toBe('caucasian');
    expect(WEBCEPH_RACES).toContain(WEBCEPH_DEFAULT_RACE);
  });

  it("offers exactly WebCeph's four values, each labelled", () => {
    expect([...WEBCEPH_RACES].sort()).toEqual(['african', 'asian', 'caucasian', 'hispanic']);
    for (const r of WEBCEPH_RACES) expect(WEBCEPH_RACE_LABELS[r]).toBeTruthy();
  });

  it('the create-patient contract accepts those values only', () => {
    const body = (race: unknown) => ({ personId: 1, patientData: { patientID: '000001', race } });
    expect(createPatient.body.safeParse(body('caucasian')).success).toBe(true);
    expect(createPatient.body.safeParse({ personId: 1, patientData: {} }).success).toBe(true);
    expect(createPatient.body.safeParse(body('martian')).success).toBe(false);
  });
});
