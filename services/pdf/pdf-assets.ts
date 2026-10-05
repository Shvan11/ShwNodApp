/**
 * Shared asset + text helpers for the PDF generators.
 *
 * Both generators independently grew the same three things — a `process.cwd()`
 * project root, a readable-file probe wrapped around `fs.accessSync(R_OK)`, and an
 * Arabic-script detection regex — and then pointed at DIFFERENT Arabic TTFs, so a
 * receipt label and the appointments report rendered the same patient's name in
 * two typefaces. One module, one answer.
 *
 * @module PdfAssets
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_PDF_ARABIC_FONT, type PdfArabicFont } from '../../shared/pdf-fonts.js';

/**
 * Assets (fonts/, public/) live in the repo root and are NOT copied into
 * dist-server by the tsc build, so they resolve from the LAUNCH directory rather
 * than the compiled file's `__dirname`.
 */
export const PROJECT_ROOT = process.cwd();

/** Absolute path to a bundled TTF for each registry face. */
const ARABIC_PDF_FONT_FILES: Record<PdfArabicFont, string> = {
  cairo: path.resolve(PROJECT_ROOT, 'fonts/Cairo/static/Cairo-Regular.ttf'),
  noto: path.resolve(PROJECT_ROOT, 'fonts/NotoSansArabic.ttf'),
};


/**
 * Is the path a file this process can read?
 *
 * Memoized: bundled assets don't change under a running process, and this used to
 * fire an `accessSync` per label inside a synchronous draw loop.
 */
const readableCache = new Map<string, boolean>();
export function isReadableFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const cached = readableCache.get(filePath);
  if (cached !== undefined) return cached;
  let readable: boolean;
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }
  readableCache.set(filePath, readable);
  return readable;
}

/**
 * Resolve a registry font id to a readable TTF path, falling back to the default
 * face and then to `null` (callers then use PDFKit's built-in Helvetica).
 */
export function resolveArabicFontPath(font: PdfArabicFont | undefined): string | null {
  const requested = font && font in ARABIC_PDF_FONT_FILES ? font : DEFAULT_PDF_ARABIC_FONT;
  const primary = ARABIC_PDF_FONT_FILES[requested];
  if (isReadableFile(primary)) return primary;
  const fallback = ARABIC_PDF_FONT_FILES[DEFAULT_PDF_ARABIC_FONT];
  return isReadableFile(fallback) ? fallback : null;
}

/**
 * Does the text contain Arabic-script characters? Covers Arabic (U+0600–06FF),
 * Arabic Supplement (U+0750–077F) and Arabic Extended-A (U+08A0–08FF).
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
export function hasArabic(text: string | null | undefined): boolean {
  return typeof text === 'string' && ARABIC_SCRIPT.test(text);
}

/**
 * The logo file to draw, or `null` when there is none to read. There is no bundled
 * fallback: the code used to ship THIS clinic's logo and print it on every install's
 * aligner labels (audit FE-F20-3). The caller passes the clinic's configured logo
 * (Settings → General); none configured = no logo.
 */
export function resolveLogoPath(requested: string | undefined | null): string | null {
  return isReadableFile(requested) ? requested! : null;
}
