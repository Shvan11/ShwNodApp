/**
 * Tests for the EXIF "date taken" reader. The buffers are built by hand — a minimal
 * TIFF block (IFD0 → Exif sub-IFD → ASCII dates) in either byte order — so the cases
 * pin the exact layouts cameras write without shipping binary fixtures.
 */
import { describe, expect, it } from 'vitest';
import { exifTakenAt, normalizeExifDate } from './exif-taken-at.js';

interface Tags {
  original?: string;
  digitized?: string;
  /** IFD0 DateTime (last modified) — must NOT be used. */
  modified?: string;
}

/** A TIFF/EXIF block carrying the given date tags, optionally led by 'Exif\0\0'. */
function buildExif(tags: Tags, { le = true, identifier = true } = {}): Uint8Array {
  const exifEntries: Array<[number, string]> = [];
  if (tags.original !== undefined) exifEntries.push([0x9003, tags.original]);
  if (tags.digitized !== undefined) exifEntries.push([0x9004, tags.digitized]);
  const ifd0Entries: Array<[number, string | number]> = [];
  if (tags.modified !== undefined) ifd0Entries.push([0x0132, tags.modified]);
  ifd0Entries.push([0x8769, 0]); // Exif pointer, patched below

  const ifdSize = (n: number): number => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifIfdAt = ifd0At + ifdSize(ifd0Entries.length);
  let dataAt = exifIfdAt + ifdSize(exifEntries.length);
  const total = dataAt + 20 * (exifEntries.length + ifd0Entries.length);

  const tiff = new Uint8Array(total);
  const v = new DataView(tiff.buffer);
  tiff.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  v.setUint16(2, 42, le);
  v.setUint32(4, ifd0At, le);

  const writeIfd = (at: number, entries: Array<[number, string | number]>): void => {
    v.setUint16(at, entries.length, le);
    entries.forEach(([tag, value], i) => {
      const e = at + 2 + i * 12;
      v.setUint16(e, tag, le);
      if (typeof value === 'number') {
        v.setUint16(e + 2, 4, le); // LONG
        v.setUint32(e + 4, 1, le);
        v.setUint32(e + 8, tag === 0x8769 ? exifIfdAt : value, le);
      } else {
        v.setUint16(e + 2, 2, le); // ASCII
        v.setUint32(e + 4, value.length + 1, le);
        v.setUint32(e + 8, dataAt, le);
        for (let c = 0; c < value.length; c++) tiff[dataAt + c] = value.charCodeAt(c);
        dataAt += 20;
      }
    });
  };
  writeIfd(ifd0At, ifd0Entries);
  writeIfd(exifIfdAt, exifEntries);

  if (!identifier) return tiff;
  const out = new Uint8Array(6 + tiff.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  out.set(tiff, 6);
  return out;
}

describe('exifTakenAt', () => {
  it('reads DateTimeOriginal in Intel byte order (Canon, most phones)', () => {
    expect(exifTakenAt(buildExif({ original: '2026:06:17 16:59:29' }))).toBe('2026-06-17T16:59:29');
  });

  it('reads DateTimeOriginal in Motorola byte order (Nikon, some phones)', () => {
    expect(exifTakenAt(buildExif({ original: '2026:06:17 16:59:29' }, { le: false }))).toBe(
      '2026-06-17T16:59:29'
    );
  });

  it('accepts a block without the Exif identifier (bare TIFF header)', () => {
    expect(exifTakenAt(buildExif({ original: '2025:12:31 23:59:59' }, { identifier: false }))).toBe(
      '2025-12-31T23:59:59'
    );
  });

  it('prefers DateTimeOriginal over DateTimeDigitized', () => {
    const exif = buildExif({ original: '2026:01:02 10:00:00', digitized: '2026:03:04 11:00:00' });
    expect(exifTakenAt(exif)).toBe('2026-01-02T10:00:00');
  });

  it('falls back to DateTimeDigitized when Original is missing or unset', () => {
    expect(exifTakenAt(buildExif({ digitized: '2026:03:04 11:00:00' }))).toBe('2026-03-04T11:00:00');
    expect(
      exifTakenAt(buildExif({ original: '0000:00:00 00:00:00', digitized: '2026:03:04 11:00:00' }))
    ).toBe('2026-03-04T11:00:00');
  });

  it('never uses IFD0 DateTime (a last-modified stamp, rewritten by editors)', () => {
    expect(exifTakenAt(buildExif({ modified: '2026:09:01 09:00:00' }))).toBeNull();
  });

  it('returns null for a camera whose clock was never set', () => {
    expect(exifTakenAt(buildExif({ original: '0000:00:00 00:00:00' }))).toBeNull();
    expect(exifTakenAt(buildExif({ original: '    :  :     :  :  ' }))).toBeNull();
  });

  it('returns null for missing, empty or corrupt input instead of throwing', () => {
    expect(exifTakenAt(null)).toBeNull();
    expect(exifTakenAt(undefined)).toBeNull();
    expect(exifTakenAt(new Uint8Array(0))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 0x12, 0x34, 0, 0, 0, 0, 0, 0]))).toBeNull();
    // Truncated mid-IFD: the Exif pointer leads past the end of the buffer.
    expect(exifTakenAt(buildExif({ original: '2026:06:17 16:59:29' }).slice(0, 30))).toBeNull();
  });

  it('reads through a Buffer view with a non-zero byteOffset (as sharp returns)', () => {
    const exif = buildExif({ original: '2026:06:17 16:59:29' });
    const pooled = new Uint8Array(exif.length + 13);
    pooled.set(exif, 13);
    expect(exifTakenAt(pooled.subarray(13))).toBe('2026-06-17T16:59:29');
  });
});

describe('normalizeExifDate', () => {
  it('rejects impossible calendar moments', () => {
    expect(normalizeExifDate('2026:02:30 10:00:00')).toBeNull();
    expect(normalizeExifDate('2026:13:01 10:00:00')).toBeNull();
    expect(normalizeExifDate('2026:06:17 24:00:00')).toBeNull();
    expect(normalizeExifDate('2026:06:17 10:60:00')).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(normalizeExifDate('2028:02:29 08:15:00')).toBe('2028-02-29T08:15:00');
  });
});
