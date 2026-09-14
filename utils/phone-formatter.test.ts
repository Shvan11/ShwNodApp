/**
 * Iraqi mobile validation.
 *
 * `isValidPhoneNumber` used to test a carrier-block ALLOWLIST
 * (`75[01]|77[0-9]|78[0-4]|79[0-5]`), so any prefix outside that snapshot was
 * refused as an invalid number and the WhatsApp/Telegram/SMS send never went
 * out. These pin the structural rule that replaced it: 10 national digits
 * beginning with 7, in every input shape `normalizePhoneNumber` accepts.
 */
import { describe, expect, it } from 'vitest';
import { isValidPhoneNumber, formatForE164, formatInternational } from './phone-formatter.js';

describe('isValidPhoneNumber (Iraq)', () => {
  it('accepts every input shape for a known-good number', () => {
    for (const input of [
      '07501234567',
      '7501234567',
      '9647501234567',
      '+9647501234567',
      '009647501234567',
      '0750 123 4567',
      '0750-123-4567',
    ]) {
      expect(isValidPhoneNumber(input), input).toBe(true);
    }
  });

  it('accepts carrier blocks the old allowlist rejected', () => {
    // 752/785/796 fall outside `75[01]|77[0-9]|78[0-4]|79[0-5]` — the exact
    // numbers the clinic could not message before.
    for (const input of ['07521234567', '07851234567', '07961234567', '07401234567']) {
      expect(isValidPhoneNumber(input), input).toBe(true);
    }
  });

  it('still rejects the wrong shape', () => {
    expect(isValidPhoneNumber('')).toBe(false);
    expect(isValidPhoneNumber('0750123456')).toBe(false); // one digit short
    expect(isValidPhoneNumber('075012345678')).toBe(false); // one digit long
    expect(isValidPhoneNumber('06501234567')).toBe(false); // landline, not mobile
    expect(isValidPhoneNumber('not a phone')).toBe(false);
  });

  it('falls back to the generic country rule for a non-964 code', () => {
    expect(isValidPhoneNumber('+44 7700 900123', '44')).toBe(true);
    expect(isValidPhoneNumber('12345', '44')).toBe(false);
  });
});

describe('formatting', () => {
  it('normalizes to +<country><national> for every channel', () => {
    expect(formatInternational('07501234567')).toBe('+9647501234567');
    expect(formatInternational('')).toBe('');
  });

  it('formatForE164 returns "" rather than an invalid number', () => {
    expect(formatForE164('07501234567')).toBe('+9647501234567');
    expect(formatForE164('0750123456')).toBe('');
  });
});
