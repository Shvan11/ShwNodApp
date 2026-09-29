/**
 * @vitest-environment node
 *
 * The demo seeder's pure planning helpers (no database — the CI gate has none).
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_OFF,
  addDays,
  addMonths,
  arrivalFor,
  demoEmail,
  demoPhone,
  demoRefusals,
  installments,
  isWorkingDay,
  makeRng,
  nthWorkingDayAfter,
  paidAmount,
  toClock,
  toMinutes,
  visitDates,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  ymd,
} from './demo-plan.js';

const NONE = new Set<string>();
const clean = { patientCount: 0, enabledSinks: [], volumePatientEntries: [], adminCount: 1, hasManifest: false };

describe('dates on the clinic week (Friday is the only day off)', () => {
  it('formats local dates and adds days/months without UTC drift', () => {
    expect(ymd(new Date(2026, 8, 29))).toBe('2026-09-29');
    expect(ymd(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
    expect(ymd(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28'); // clamped
    expect(ymd(addMonths(new Date(2026, 2, 15), -3))).toBe('2025-12-15');
  });

  it('Friday and holidays are not working days; Saturday is', () => {
    const friday = new Date(2026, 9, 2); // 2026-10-02
    expect(friday.getDay()).toBe(DAY_OFF);
    expect(isWorkingDay(friday, NONE)).toBe(false);
    expect(isWorkingDay(addDays(friday, 1), NONE)).toBe(true); // Saturday
    expect(isWorkingDay(new Date(2026, 9, 3), new Set(['2026-10-03']))).toBe(false);
  });

  it('snaps and steps over Fridays and holidays', () => {
    const thursday = new Date(2026, 9, 1);
    expect(ymd(nthWorkingDayAfter(thursday, 1, NONE))).toBe('2026-10-03'); // Thu → Sat
    expect(ymd(workingDayOnOrAfter(new Date(2026, 9, 2), NONE))).toBe('2026-10-03');
    expect(ymd(workingDayOnOrBefore(new Date(2026, 9, 2), NONE))).toBe('2026-10-01');
    expect(ymd(nthWorkingDayAfter(thursday, 1, new Set(['2026-10-03'])))).toBe('2026-10-04');
  });

  it('visit dates are ascending working days that end on the end date, the same for the same seed', () => {
    const start = new Date(2024, 6, 1);
    const end = new Date(2026, 7, 20);
    const a = visitDates(start, end, 35, NONE, makeRng(7));
    const b = visitDates(start, end, 35, NONE, makeRng(7));
    expect(a.map(ymd)).toEqual(b.map(ymd));
    expect(a.length).toBeGreaterThan(15);
    for (const d of a) expect(isWorkingDay(d, NONE), ymd(d)).toBe(true);
    for (let i = 1; i < a.length; i++) {
      expect(a[i] > a[i - 1]).toBe(true);
      expect((a[i].getTime() - a[i - 1].getTime()) / 86_400_000).toBeGreaterThanOrEqual(7);
    }
    expect(ymd(a[a.length - 1])).toBe(ymd(workingDayOnOrBefore(end, NONE)));
    expect(visitDates(end, start, 35, NONE, makeRng(1))).toHaveLength(1);
  });
});

describe('arrival states', () => {
  const slot = toMinutes('14:00');
  it('walks pending → present → seated → dismissed with ordered times', () => {
    expect(arrivalFor(slot, slot - 30).state).toBe('pending');
    expect(arrivalFor(slot, slot).state).toBe('present');
    expect(arrivalFor(slot, slot + 20).state).toBe('seated');
    const done = arrivalFor(slot, Number.POSITIVE_INFINITY);
    expect(done.state).toBe('dismissed');
    expect([done.present, done.seated, done.dismissed]).toEqual(['13:55:00', '14:08:00', '14:35:00']);
  });
  it('clock helpers round-trip', () => {
    expect(toClock(toMinutes('09:30'))).toBe('09:30:00');
    expect(toClock(-5)).toBe('00:00:00');
  });
});

describe('money', () => {
  it('installments sum exactly to what was paid, in cash-sized steps', () => {
    for (const [paid, n, cur] of [[962_500, 6, 'IQD'], [1_400, 3, 'USD'], [75_000, 1, 'IQD'], [25_000, 9, 'IQD']] as const) {
      const parts = installments(paid, n, cur);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(paid);
      expect(parts.every((x) => x > 0)).toBe(true);
      expect(parts.length).toBeLessThanOrEqual(n);
    }
    expect(installments(0, 4, 'IQD')).toEqual([]);
  });
  it('a down payment of at least 30%, then equal installments in whole cash steps', () => {
    const [down, ...rest] = installments(800_000, 9, 'IQD');
    expect(down).toBeGreaterThanOrEqual(240_000);
    expect(new Set(rest).size).toBe(1);
    for (const x of rest) expect(x % 25_000).toBe(0);
    expect(installments(1_400, 3, 'USD')).toEqual([500, 450, 450]);
  });
  it('a part-paid balance is a cash amount; a settled one is the exact total', () => {
    expect(paidAmount(1_750_000, 0.55, 'IQD')).toBe(975_000);
    expect(paidAmount(1_900, 0.74, 'USD')).toBe(1_400);
    expect(paidAmount(1_234_567, 1, 'IQD')).toBe(1_234_567);
    expect(paidAmount(50_000, 0.99, 'IQD')).toBeLessThanOrEqual(50_000);
    expect(paidAmount(900_000, 0, 'IQD')).toBe(0);
  });
});

describe('contact details that reach nobody', () => {
  it("phones are in Ofcom's reserved drama range (+44 7700 900000–900999)", () => {
    expect(demoPhone(7)).toEqual({ phone: '7700900007', countryCode: '44' });
    expect(demoPhone(999).phone).toBe('7700900999');
    expect(() => demoPhone(1000)).toThrow();
  });
  it('emails are under the reserved example.com domain', () => {
    expect(demoEmail('Zahraa Mahmood')).toBe('zahraa.mahmood@example.com');
  });
});

describe('refuse-to-run rules', () => {
  it('a clean, empty install with an admin is allowed', () => {
    expect(demoRefusals(clean)).toEqual([]);
  });
  it('refuses a database with patients, a capturing sink, a used photo volume, no admin, or an existing seed', () => {
    expect(demoRefusals({ ...clean, patientCount: 3 })).toHaveLength(1);
    expect(demoRefusals({ ...clean, enabledSinks: ['failover'] })[0]).toMatch(/failover/);
    expect(demoRefusals({ ...clean, volumePatientEntries: ['1', '3'] })[0]).toMatch(/MACHINE_PATH/);
    expect(demoRefusals({ ...clean, adminCount: 0 })[0]).toMatch(/db:setup/);
    expect(demoRefusals({ ...clean, hasManifest: true })[0]).toMatch(/remove/);
  });
});
