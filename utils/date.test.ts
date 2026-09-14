/**
 * Tests for the clock/date formatting SSoT.
 *
 * `formatTime12` exists because three independent 12-hour formatters disagreed
 * about whether their INPUT was 24-hour or already-converted 12-hour: the daily
 * appointments PDF read a `to_char(…,'HH12:MI')` value as 24-hour and printed
 * every afternoon appointment as AM. The afternoon/midnight cases below are that
 * regression, pinned.
 */
import { describe, expect, it } from 'vitest';
import { formatClock12, formatDatePattern, formatTime12 } from './date.js';

describe('formatTime12', () => {
  it('renders afternoon 24-hour input as PM', () => {
    // The exact bug: "15:30" must not become "3:30 AM".
    expect(formatTime12('15:30', true)).toBe('03:30 PM');
    expect(formatTime12('13:05', true)).toBe('01:05 PM');
    expect(formatTime12('23:59', true)).toBe('11:59 PM');
  });

  it('renders morning input as AM, and midnight as 12 AM', () => {
    expect(formatTime12('09:15', true)).toBe('09:15 AM');
    expect(formatTime12('00:15', true)).toBe('12:15 AM');
    expect(formatTime12('00:00', true)).toBe('12:00 AM');
  });

  it('treats noon as 12 PM', () => {
    expect(formatTime12('12:00', true)).toBe('12:00 PM');
    expect(formatTime12('12:45', true)).toBe('12:45 PM');
  });

  it('omits the meridiem by default', () => {
    expect(formatTime12('15:30')).toBe('03:30');
    expect(formatTime12('09:05')).toBe('09:05');
  });

  it('accepts seconds (a PG `time` value) and ignores them', () => {
    expect(formatTime12('14:07:42', true)).toBe('02:07 PM');
  });

  it('returns null for empty input and echoes unparseable input', () => {
    expect(formatTime12(null)).toBeNull();
    expect(formatTime12(undefined)).toBeNull();
    expect(formatTime12('')).toBeNull();
    expect(formatTime12('not-a-time')).toBe('not-a-time');
  });
});

describe('formatClock12', () => {
  it('formats a Date as 12-hour local wall-clock', () => {
    expect(formatClock12(new Date(2026, 7, 30, 15, 30), true)).toBe('03:30 PM');
    expect(formatClock12(new Date(2026, 7, 30, 0, 5), true)).toBe('12:05 AM');
    expect(formatClock12(new Date(2026, 7, 30, 15, 30))).toBe('03:30');
  });
});

describe('formatDatePattern', () => {
  const noon = new Date(2026, 2, 9, 14, 5, 7); // Mon 9 Mar 2026, 14:05:07 local

  it('substitutes the documented tokens', () => {
    expect(formatDatePattern(noon, 'YYYY-MM-DD')).toBe('2026-03-09');
    expect(formatDatePattern(noon, 'dddd, MMMM DD, YYYY')).toBe('Monday, March 09, 2026');
    expect(formatDatePattern(noon, 'MMM DD YY')).toBe('Mar 09 26');
    expect(formatDatePattern(noon, 'hh:mm:ss A')).toBe('02:05:07 PM');
    expect(formatDatePattern(noon, 'HH:mm a')).toBe('14:05 pm');
    expect(formatDatePattern(noon, 'h:mm A')).toBe('2:05 PM');
  });

  it('never re-substitutes inside text an earlier token produced', () => {
    // 'March' contains 'a' and 'h'; 'May' contains 'a'. A naive sequential
    // replace would corrupt the month name it just wrote.
    expect(formatDatePattern(new Date(2026, 2, 1, 9, 0), 'MMMM')).toBe('March');
    expect(formatDatePattern(new Date(2026, 4, 1, 9, 0), 'MMMM')).toBe('May');
    expect(formatDatePattern(new Date(2026, 2, 1, 9, 0), 'dddd')).toBe('Sunday');
  });

  it('emits [bracketed] text literally, brackets stripped', () => {
    // The single-character tokens (h/a/A/D/M/m/s) match anywhere in the pattern,
    // so a literal word containing one is corrupted unless it is escaped:
    // 'at' → 'pmt'. Template authors write these patterns, so this is the escape.
    expect(formatDatePattern(noon, '[on] YYYY')).toBe('on 2026');
    expect(formatDatePattern(noon, 'DD MMMM YYYY [at] hh:mm A')).toBe('09 March 2026 at 02:05 PM');
    expect(formatDatePattern(noon, 'dddd [at] h:mm A')).toBe('Monday at 2:05 PM');
    // An unclosed bracket is a literal bracket, not a swallowed tail.
    expect(formatDatePattern(noon, '[YYYY')).toBe('[2026');
  });

  it('substitutes the un-padded D/M/m/s tokens', () => {
    expect(formatDatePattern(noon, 'D/M/YYYY')).toBe('9/3/2026');
    expect(formatDatePattern(new Date(2026, 10, 21, 14, 5, 7), 'D/M/YYYY')).toBe('21/11/2026');
    expect(formatDatePattern(noon, 'h:m:s')).toBe('2:5:7');
  });

  it('returns empty for nullish and echoes an unparseable value', () => {
    expect(formatDatePattern(null, 'YYYY')).toBe('');
    expect(formatDatePattern(undefined, 'YYYY')).toBe('');
    expect(formatDatePattern('', 'YYYY')).toBe('');
    expect(formatDatePattern('nonsense', 'YYYY')).toBe('nonsense');
  });

  it('reads a YYYY-MM-DD string as a LOCAL date, never UTC midnight', () => {
    // `new Date('2026-03-09')` is UTC midnight, which local getters render as the
    // 8th anywhere west of UTC. The product ships to centers in many timezones,
    // so the date on a report header must not depend on the server's offset.
    expect(formatDatePattern('2026-03-09', 'YYYY-MM-DD')).toBe('2026-03-09');
    expect(formatDatePattern('2026-03-09', 'dddd, MMMM DD, YYYY')).toBe('Monday, March 09, 2026');
    expect(formatDatePattern('2026-01-01', 'dddd')).toBe('Thursday');
  });
});
