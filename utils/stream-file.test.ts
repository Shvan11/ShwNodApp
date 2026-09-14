/**
 * Range-header parsing for the shared file streamer.
 *
 * The suffix form (`bytes=-500`) used to parse as `parseInt('')` → NaN → 416,
 * and a multi-range request answered only its FIRST range with a 206 the client
 * would read as the whole response. Both are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { parseByteRange } from './stream-file.js';

const SIZE = 1000;

describe('parseByteRange', () => {
  it('parses a closed range', () => {
    expect(parseByteRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 });
    expect(parseByteRange('bytes=500-999', SIZE)).toEqual({ start: 500, end: 999 });
  });

  it('parses an open-ended range', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('parses a suffix range as the LAST n bytes', () => {
    expect(parseByteRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange('bytes=-1', SIZE)).toEqual({ start: 999, end: 999 });
    // A suffix longer than the file is the whole file, not an error.
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past EOF instead of 416ing', () => {
    expect(parseByteRange('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('serves the whole file for a multi-range request', () => {
    // Never answer only the first part with a 206 — the client reads that as complete.
    expect(parseByteRange('bytes=0-10,20-30', SIZE)).toBe('ignore');
  });

  it('ignores a non-bytes unit', () => {
    expect(parseByteRange('items=0-10', SIZE)).toBe('ignore');
  });

  it('rejects garbage and out-of-range starts', () => {
    expect(parseByteRange('bytes=abc-', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=1000-', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=500-100', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-10', 0)).toBe('unsatisfiable');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseByteRange(' bytes = 0-99 ', SIZE)).toEqual({ start: 0, end: 99 });
  });
});
