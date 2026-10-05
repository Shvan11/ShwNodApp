import { describe, expect, it } from 'vitest';
import { daysUntil, isExpired, normalizeScannedExpiry } from './expiryDate';

describe('isExpired', () => {
  it('is good through its expiry day and expired the day after', () => {
    expect(isExpired('2026-10-04', '2026-10-04')).toBe(false);
    expect(isExpired('2026-10-03', '2026-10-04')).toBe(true);
    expect(isExpired('2026-10-05', '2026-10-04')).toBe(false);
  });
  it('treats no expiry as never expired', () => {
    expect(isExpired(null, '2026-10-04')).toBe(false);
    expect(isExpired(undefined, '2026-10-04')).toBe(false);
  });
});

describe('daysUntil', () => {
  it('counts whole local days, negative once passed', () => {
    expect(daysUntil('2026-10-04', '2026-10-04')).toBe(0);
    expect(daysUntil('2026-10-14', '2026-10-04')).toBe(10);
    expect(daysUntil('2026-10-01', '2026-10-04')).toBe(-3);
    expect(daysUntil('2027-03-01', '2026-02-28')).toBe(366);
  });
});

describe('normalizeScannedExpiry', () => {
  it('keeps a real ISO day and refuses an impossible one', () => {
    expect(normalizeScannedExpiry('2027-05-31')).toBe('2027-05-31');
    expect(normalizeScannedExpiry('2027-02-30')).toBeNull();
  });
  it('reads a month as its last day', () => {
    expect(normalizeScannedExpiry('2027-05')).toBe('2027-05-31');
    expect(normalizeScannedExpiry('2028/2')).toBe('2028-02-29');
    expect(normalizeScannedExpiry('05/2027')).toBe('2027-05-31');
    expect(normalizeScannedExpiry('4-2027')).toBe('2027-04-30');
    expect(normalizeScannedExpiry('13/2027')).toBeNull();
  });
  it('reads a printed day-first date', () => {
    expect(normalizeScannedExpiry('31/05/2027')).toBe('2027-05-31');
    expect(normalizeScannedExpiry('1.6.2027')).toBe('2027-06-01');
    expect(normalizeScannedExpiry('31/02/2027')).toBeNull();
  });
  it('gives up on anything else', () => {
    expect(normalizeScannedExpiry('EXP MAY 27')).toBeNull();
    expect(normalizeScannedExpiry('')).toBeNull();
    expect(normalizeScannedExpiry(null)).toBeNull();
  });
});
