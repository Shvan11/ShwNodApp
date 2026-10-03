/**
 * When a photo was taken — read from its EXIF block, i.e. the camera's own clock.
 *
 * Pure (no fs, no sharp, no config) so it is unit-testable in the env-less CI gate:
 * the caller hands in the raw bytes `sharp().metadata().exif` returns — the APP1
 * payload, optionally led by the `Exif\0\0` identifier, then a TIFF header + IFDs.
 *
 * Only the CAPTURE tags are read: DateTimeOriginal (0x9003), then DateTimeDigitized
 * (0x9004), both in the Exif sub-IFD. IFD0's DateTime (0x0132) is deliberately not a
 * fallback — it is the file's last-modified stamp, which an editor's re-export
 * rewrites, so it would show an edit date labelled "taken". No date beats a wrong one.
 *
 * EXIF stores a zone-less wall clock ('YYYY:MM:DD HH:MM:SS'), which is how the app
 * keeps every timestamp (single-clinic local time). It is returned as
 * 'YYYY-MM-DDTHH:MM:SS' with no zone: `new Date()` reads that form as LOCAL time, so
 * the browser shows the camera's clock as-is, never shifted.
 */

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;

const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_IFD = 13;

/** 'YYYY:MM:DD HH:MM:SS' — 19 characters (the tag's count is 20 with its NUL). */
const EXIF_DATE_LENGTH = 19;
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * 'YYYY-MM-DDTHH:MM:SS' from an EXIF date string, or null when it is blank, malformed
 * or not a real calendar moment. A camera whose clock was never set writes zeros
 * ('0000:00:00 00:00:00') or spaces — both land here as null.
 */
export function normalizeExifDate(raw: string | null): string | null {
  const m = raw ? EXIF_DATE.exec(raw) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  // Day within ITS month (rejects 2026:02:30); UTC so no DST edge can move it.
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** The photo's capture time from raw EXIF bytes, or null when it carries none. */
export function exifTakenAt(exif: Uint8Array | null | undefined): string | null {
  if (!exif || exif.byteLength < 8) return null;
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  const len = exif.byteLength;

  // Optional 'Exif\0\0' identifier ahead of the TIFF header. Every offset inside the
  // TIFF block is relative to the header's first byte (`base`).
  const hasIdentifier =
    len >= 6 &&
    exif[0] === 0x45 && exif[1] === 0x78 && exif[2] === 0x69 && exif[3] === 0x66 &&
    exif[4] === 0 && exif[5] === 0;
  const base = hasIdentifier ? 6 : 0;
  if (len < base + 8) return null;

  const byteOrder = view.getUint16(base);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null; // 'II' | 'MM'
  const le = byteOrder === 0x4949;
  const u16 = (at: number): number => view.getUint16(at, le);
  const u32 = (at: number): number => view.getUint32(at, le);
  if (u16(base + 2) !== 42) return null;

  /** Absolute offset of `tag`'s 12-byte entry in the IFD at `ifdOffset`, or null. */
  const findEntry = (ifdOffset: number, tag: number): number | null => {
    const at = base + ifdOffset;
    if (ifdOffset <= 0 || at + 2 > len) return null;
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > len) return null;
      if (u16(entry) === tag) return entry;
    }
    return null;
  };

  /** An ASCII date entry's 19 characters (always stored out-of-line: count > 4). */
  const readDate = (entry: number): string | null => {
    if (u16(entry + 2) !== TYPE_ASCII || u32(entry + 4) < EXIF_DATE_LENGTH) return null;
    const start = base + u32(entry + 8);
    if (start + EXIF_DATE_LENGTH > len) return null;
    let s = '';
    for (let i = 0; i < EXIF_DATE_LENGTH; i++) s += String.fromCharCode(exif[start + i]);
    return s;
  };

  const pointer = findEntry(u32(base + 4), TAG_EXIF_IFD_POINTER);
  if (pointer === null) return null;
  const pointerType = u16(pointer + 2);
  if (pointerType !== TYPE_LONG && pointerType !== TYPE_IFD) return null;
  const exifIfd = u32(pointer + 8);

  for (const tag of [TAG_DATETIME_ORIGINAL, TAG_DATETIME_DIGITIZED]) {
    const entry = findEntry(exifIfd, tag);
    const taken = entry === null ? null : normalizeExifDate(readDate(entry));
    if (taken) return taken;
  }
  return null;
}
