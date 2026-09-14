/**
 * Tests for the Drive filename/folder sanitizers.
 *
 * The character class used to be `[^a-zA-Z0-9_-]`, i.e. "everything non-ASCII" — and the caller
 * prefers `patients.patient_name`, which in this clinic's data IS the Arabic name. So the DEFAULT
 * path erased the whole name and produced `123___Set1_….pdf` inside `Patient_123___Work_45/`:
 * unique (the ids survive) but unbrowsable, which defeats the only reason these PDFs live in Drive.
 *
 * These pin both halves: names in any script survive, and the characters that would actually break
 * a path or a Drive `q=` query still do not.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeFilename, sanitizeFolderName } from './sanitize.js';

const clean = (n: string): string => sanitizeFilename(n);
const cleanFolder = (n: string): string => sanitizeFolderName(n);

describe('sanitizeFilename', () => {
  it('keeps Arabic names instead of collapsing them to an underscore', () => {
    expect(clean('أحمد علي')).toBe('أحمد_علي');
    // The regression this replaces: the whole name became a single '_'.
    expect(clean('أحمد علي')).not.toBe('_');
  });

  it('keeps Kurdish names', () => {
    expect(clean('هێمن ڕەشید')).toBe('هێمن_ڕەشید');
  });

  it('still handles Latin names the way it always did', () => {
    expect(clean('Ahmed Ali')).toBe('Ahmed_Ali');
    expect(clean('Mary-Jane')).toBe('Mary-Jane');
  });

  it('strips path separators and traversal', () => {
    expect(clean('Ali/../etc')).toBe('Ali_etc');
    expect(clean('a\\b')).toBe('a_b');
    expect(clean('../../secret')).toBe('_secret');
  });

  it("strips the quote that would break a Drive q= query", () => {
    expect(clean("O'Brien")).toBe('O_Brien');
    expect(clean('say "hi"')).toBe('say_hi_');
  });

  it('collapses runs of replaced characters and caps the length', () => {
    expect(clean('a!!!!b')).toBe('a_b');
    expect(clean('x'.repeat(80))).toHaveLength(50);
  });
});

describe('sanitizeFolderName', () => {
  it('produces a browsable folder name for an Arabic-named patient', () => {
    expect(cleanFolder('Patient_123_أحمد علي_Work_45')).toBe('Patient_123_أحمد_علي_Work_45');
  });

  it('collapses whitespace to single underscores', () => {
    expect(cleanFolder('Patient_1_Ahmed   Ali_Work_2')).toBe('Patient_1_Ahmed_Ali_Work_2');
  });

  it('caps the length', () => {
    expect(cleanFolder('y'.repeat(200))).toHaveLength(100);
  });
});
