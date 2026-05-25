/**
 * Shared MIME-type lookup for media files served by the video routes
 * (public streaming/download + the authenticated media API). Superset of the
 * extensions either route can serve, so a single table covers both call sites.
 */
import path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Resolve a MIME type from a file path's extension.
 * Falls back to 'application/octet-stream' for unknown extensions.
 */
export function getMediaMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}
