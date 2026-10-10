/**
 * MIME-type + category lookup for the patient file explorer.
 *
 * The single MIME table for the whole server. The file explorer needs a broad
 * taxonomy — every file type a clinic folder might contain — plus a coarse
 * *category* that drives the frontend preview strategy (inline
 * <img>/<video>/<audio>/<iframe> vs download) and the entry icon; one table maps
 * each extension to both. The video routes used to carry a 6-extension copy of
 * the same data in `utils/video-mime.ts`; they now call `getMediaMimeType`.
 */
import fs from 'fs/promises';
import path from 'path';

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'office'
  | 'archive'
  | 'other';

interface FileTypeInfo {
  mime: string;
  category: FileCategory;
}

/**
 * Extension (lower-case, with leading dot) → { mime, category }.
 * Anything not listed falls back to `application/octet-stream` / `'other'`.
 */
const FILE_TYPES: Record<string, FileTypeInfo> = {
  // ── Images ──────────────────────────────────────────────────────────────
  '.jpg': { mime: 'image/jpeg', category: 'image' },
  '.jpeg': { mime: 'image/jpeg', category: 'image' },
  '.png': { mime: 'image/png', category: 'image' },
  '.gif': { mime: 'image/gif', category: 'image' },
  '.webp': { mime: 'image/webp', category: 'image' },
  '.bmp': { mime: 'image/bmp', category: 'image' },
  '.svg': { mime: 'image/svg+xml', category: 'image' },
  '.tif': { mime: 'image/tiff', category: 'image' },
  '.tiff': { mime: 'image/tiff', category: 'image' },
  '.avif': { mime: 'image/avif', category: 'image' },
  '.heic': { mime: 'image/heic', category: 'image' },
  '.heif': { mime: 'image/heif', category: 'image' },
  '.ico': { mime: 'image/x-icon', category: 'image' },

  // ── Video ───────────────────────────────────────────────────────────────
  '.mp4': { mime: 'video/mp4', category: 'video' },
  '.m4v': { mime: 'video/x-m4v', category: 'video' },
  '.webm': { mime: 'video/webm', category: 'video' },
  '.mov': { mime: 'video/quicktime', category: 'video' },
  '.mkv': { mime: 'video/x-matroska', category: 'video' },
  '.avi': { mime: 'video/x-msvideo', category: 'video' },
  '.ogv': { mime: 'video/ogg', category: 'video' },
  '.wmv': { mime: 'video/x-ms-wmv', category: 'video' },
  '.flv': { mime: 'video/x-flv', category: 'video' },
  '.3gp': { mime: 'video/3gpp', category: 'video' },

  // ── Audio ───────────────────────────────────────────────────────────────
  '.mp3': { mime: 'audio/mpeg', category: 'audio' },
  '.wav': { mime: 'audio/wav', category: 'audio' },
  '.ogg': { mime: 'audio/ogg', category: 'audio' },
  '.oga': { mime: 'audio/ogg', category: 'audio' },
  '.m4a': { mime: 'audio/mp4', category: 'audio' },
  '.aac': { mime: 'audio/aac', category: 'audio' },
  '.flac': { mime: 'audio/flac', category: 'audio' },
  '.opus': { mime: 'audio/opus', category: 'audio' },
  '.wma': { mime: 'audio/x-ms-wma', category: 'audio' },

  // ── PDF ─────────────────────────────────────────────────────────────────
  '.pdf': { mime: 'application/pdf', category: 'pdf' },

  // ── Text / code (previewable as plain text) ───────────────────────────────
  '.txt': { mime: 'text/plain', category: 'text' },
  '.csv': { mime: 'text/csv', category: 'text' },
  '.log': { mime: 'text/plain', category: 'text' },
  '.json': { mime: 'application/json', category: 'text' },
  '.xml': { mime: 'application/xml', category: 'text' },
  '.md': { mime: 'text/markdown', category: 'text' },
  '.html': { mime: 'text/html', category: 'text' },
  '.htm': { mime: 'text/html', category: 'text' },
  '.css': { mime: 'text/css', category: 'text' },
  '.yml': { mime: 'text/yaml', category: 'text' },
  '.yaml': { mime: 'text/yaml', category: 'text' },
  '.rtf': { mime: 'application/rtf', category: 'text' },

  // ── Office documents (download only — no inline preview in v1) ─────────────
  '.doc': { mime: 'application/msword', category: 'office' },
  '.docx': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'office',
  },
  '.xls': { mime: 'application/vnd.ms-excel', category: 'office' },
  '.xlsx': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'office',
  },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', category: 'office' },
  '.pptx': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'office',
  },
  '.odt': { mime: 'application/vnd.oasis.opendocument.text', category: 'office' },
  '.ods': { mime: 'application/vnd.oasis.opendocument.spreadsheet', category: 'office' },
  '.odp': { mime: 'application/vnd.oasis.opendocument.presentation', category: 'office' },

  // ── Archives ──────────────────────────────────────────────────────────────
  '.zip': { mime: 'application/zip', category: 'archive' },
  '.rar': { mime: 'application/vnd.rar', category: 'archive' },
  '.7z': { mime: 'application/x-7z-compressed', category: 'archive' },
  '.tar': { mime: 'application/x-tar', category: 'archive' },
  '.gz': { mime: 'application/gzip', category: 'archive' },

  // ── Medical imaging (DICOM — not browser-previewable → 'other') ────────────
  '.dcm': { mime: 'application/dicom', category: 'other' },
};

function lookup(filePath: string): FileTypeInfo | undefined {
  return FILE_TYPES[path.extname(filePath).toLowerCase()];
}

/**
 * Resolve a MIME type from a file path's extension.
 * Falls back to 'application/octet-stream' for unknown extensions.
 */
export function getFileMimeType(filePath: string): string {
  return lookup(filePath)?.mime ?? 'application/octet-stream';
}

/**
 * Coarse category that drives the frontend preview strategy + icon.
 * Falls back to 'other' (download-only) for unknown extensions.
 */
export function getFileCategory(filePath: string): FileCategory {
  return lookup(filePath)?.category ?? 'other';
}

/**
 * MIME type for a file served by the VIDEO routes (public streaming/download +
 * the authenticated media API).
 *
 * Identical to `getFileMimeType` except for `.ogg`, which the shared table calls
 * `audio/ogg` (its registered use) while the video library stores Ogg *video*
 * under that extension — serving those as audio hides them from `<video>`. The
 * override keeps the video routes' long-standing behaviour without pushing a
 * video type onto the file explorer's audio files.
 */
export function getMediaMimeType(filePath: string): string {
  if (path.extname(filePath).toLowerCase() === '.ogg') return 'video/ogg';
  return getFileMimeType(filePath);
}

/**
 * The image type a file's first bytes declare, for files whose extension says nothing:
 * Dolphin's slot files (`.iNN` renders are JPEG; its `.vNN` originals are JPEG, TIFF, BMP
 * or PNG). Null for anything else, so a caller never serves unknown bytes inline.
 */
export async function sniffImageMime(filePath: string): Promise<string | null> {
  const b = Buffer.alloc(12);
  const fh = await fs.open(filePath, 'r');
  try {
    await fh.read(b, 0, b.length, 0);
  } finally {
    await fh.close();
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) {
    return 'image/tiff';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
