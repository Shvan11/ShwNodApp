/**
 * Drive name sanitizers — pure string helpers, no config/network/Drive client.
 *
 * They live apart from `drive-upload.ts` so the unit tests can reach them without
 * importing that service's module graph, which pulls in `config/config.js` and throws
 * at import time when the boot env is absent (CI has no `.env`). Same reason
 * `utils/oauth.ts` and `services/pdf/pdf-assets.ts` are their own modules.
 */

/**
 * Sanitize a filename: strip anything that could break a path or a Drive query, KEEP letters and
 * digits in any script.
 *
 * The class was `[^a-zA-Z0-9_-]`, which is every non-ASCII character — and the caller prefers
 * `patients.patient_name`, the ARABIC name (AlignerPdfService#uploadPdfForSet). So the default
 * path erased the whole name: every Arabic-named patient produced `123___Set1_….pdf` inside
 * `Patient_123___Work_45/`. Unique, because the ids are still there, but unbrowsable — which is
 * the only reason these files are in Drive rather than on the clinic disk.
 *
 * `\p{L}` / `\p{N}` (unicode-aware) keep Arabic, Kurdish and Latin letters alike while still
 * removing `/ \ : * ? " < > |`, control characters, and the `'` that would break a Drive query.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}_-]/gu, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
}

/**
 * Sanitize a folder name — same unicode-aware class as sanitizeFilename, with spaces collapsed to
 * underscores rather than dropped.
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}
