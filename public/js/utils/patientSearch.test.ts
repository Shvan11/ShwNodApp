/**
 * The jump-list name rule. Both defects it fixes were invisible in review — a
 * bare `startsWith` reads fine until you remember the server is citext and that
 * a checkbox two rows below the input says otherwise.
 */
import { describe, expect, it } from 'vitest';
import { matchesPatientName } from './patientSearch';

describe('matchesPatientName', () => {
  it('is case-insensitive, like the citext column it mirrors', () => {
    expect(matchesPatientName('Ali Hassan', 'ali', true)).toBe(true);
    expect(matchesPatientName('ali hassan', 'ALI', true)).toBe(true);
  });

  it('matches a later word when prefixOnly is off (the checkbox default)', () => {
    expect(matchesPatientName('سيما كاروان', 'كاروان', false)).toBe(true);
    expect(matchesPatientName('Ali Hassan', 'hass', false)).toBe(true);
  });

  it('matches only the prefix when prefixOnly is on', () => {
    expect(matchesPatientName('سيما كاروان', 'كاروان', true)).toBe(false);
    expect(matchesPatientName('Ali Hassan', 'Ali', true)).toBe(true);
  });

  it('never matches a missing name', () => {
    expect(matchesPatientName(null, 'a', false)).toBe(false);
    expect(matchesPatientName(undefined, 'a', false)).toBe(false);
    expect(matchesPatientName('', 'a', false)).toBe(false);
  });
});
