/**
 * Tests for the clock-alignment comparison (audit FE-F5-1).
 *
 * The mirror ran UTC while local ran Asia/Baghdad, so every portal-stamped time was 3 h behind and
 * reverse-sync last-write-wins misjudged which edit was newer. These pin the rules the guard alarms
 * on: offsets (not zone names) decide, and each database is judged against the app server's zone.
 */
import { describe, expect, it } from 'vitest';
import { compareClocks, formatOffset } from './clock-compare.js';

const BAGHDAD = { tz: 'Asia/Baghdad', offsetSec: 3 * 3600 };
const UTC = { tz: 'UTC', offsetSec: 0 };

describe('formatOffset', () => {
  it('formats positive, negative and half-hour offsets', () => {
    expect(formatOffset(10800)).toBe('UTC+03:00');
    expect(formatOffset(0)).toBe('UTC+00:00');
    expect(formatOffset(-16200)).toBe('UTC-04:30');
  });
});

describe('compareClocks', () => {
  it('reports nothing when all three clocks agree', () => {
    expect(compareClocks(BAGHDAD, BAGHDAD, BAGHDAD)).toEqual([]);
  });

  it('compares offsets, not zone names', () => {
    expect(compareClocks(BAGHDAD, { tz: 'Etc/GMT-3', offsetSec: 10800 }, { tz: 'Asia/Riyadh', offsetSec: 10800 })).toEqual([]);
  });

  it('flags a UTC mirror and names the zone to set it to — the FE-F5-1 state', () => {
    const out = compareClocks(BAGHDAD, BAGHDAD, UTC);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Supabase mirror stamps UTC \(UTC\+00:00\)/);
    expect(out[0]).toMatch(/3 h off/);
    expect(out[0]).toMatch(/last-write-wins/);
    expect(out[0]).toContain("ALTER DATABASE postgres SET timezone TO 'Asia/Baghdad'");
  });

  it('flags local PostgreSQL disagreeing with the app server', () => {
    const out = compareClocks(BAGHDAD, UTC, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Local PostgreSQL stamps UTC/);
    expect(out[0]).toContain("timezone = 'Asia/Baghdad'");
    expect(out[0]).not.toMatch(/last-write-wins/);
  });

  it('never advises copying a misconfigured local zone onto the mirror', () => {
    // Local is the wrong one; the mirror already matches the app server. Only local is flagged,
    // and its message carries the last-write-wins skew.
    const out = compareClocks(BAGHDAD, UTC, BAGHDAD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Local PostgreSQL stamps UTC/);
    expect(out[0]).toMatch(/last-write-wins/);
    expect(out.join(' ')).not.toContain("SET timezone TO 'UTC'");
  });

  it('flags both databases, both pointed at the app server zone, when both are off', () => {
    const out = compareClocks(BAGHDAD, UTC, UTC);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("timezone = 'Asia/Baghdad'");
    expect(out[1]).toContain("SET timezone TO 'Asia/Baghdad'");
    // Local and mirror agree with each other, so there is no last-write-wins skew to report.
    expect(out.join(' ')).not.toMatch(/last-write-wins/);
  });

  it('still judges the mirror when local could not be read, and skips an absent mirror', () => {
    const out = compareClocks(BAGHDAD, null, UTC);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("SET timezone TO 'Asia/Baghdad'");
    expect(out[0]).not.toMatch(/last-write-wins/); // no local reading to compare against
    expect(compareClocks(BAGHDAD, BAGHDAD, null)).toEqual([]);
  });
});
