/**
 * Shared helpers for the patient file-explorer UI.
 */
import type { FileEntry } from '@/types/api.types';
import { formatLocaleDate } from '@/utils/formatters';

export interface ContentUrlOptions {
  download?: boolean;
  thumb?: number;
  /**
   * The file's version — its mtime: a listing's `modified` or the gallery's
   * `mtime`. Appended as `v=…`. A thumbnail URL whose `v` names the file on disk is
   * cached for a week, and a changed file gets a new URL; without `v` (or with a
   * stale one) the server makes the browser revalidate it on every view.
   */
  v?: string | number;
}

/** Build a content endpoint URL for previewing / downloading / thumbnailing. */
export function buildContentUrl(
  personId: number,
  relPath: string,
  opts: ContentUrlOptions = {}
): string {
  const params = new URLSearchParams({ path: relPath });
  if (opts.download) params.set('download', '1');
  if (opts.thumb) params.set('thumb', String(opts.thumb));
  if (opts.v != null) params.set('v', String(opts.v));
  return `/api/patients/${personId}/files/content?${params.toString()}`;
}

/**
 * Build a content URL for a patient WORKING file (the rendered `.iNN` views in
 * the shared working/ dir). Addressed by bare `name`, not a path — matches
 * `buildContentUrl`'s signature so the tile/preview components can take either.
 */
export function buildWorkingContentUrl(
  personId: number,
  name: string,
  opts: ContentUrlOptions = {}
): string {
  const params = new URLSearchParams({ name });
  if (opts.download) params.set('download', '1');
  if (opts.thumb) params.set('thumb', String(opts.thumb));
  if (opts.v != null) params.set('v', String(opts.v));
  return `/api/patients/${personId}/working-files/content?${params.toString()}`;
}

/** Encode a relPath for use in the router splat, preserving `/` separators. */
export function encodeRelPath(relPath: string): string {
  return relPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

/** FontAwesome icon name for an entry. */
export function categoryIcon(entry: FileEntry): string {
  if (entry.type === 'dir') return 'fa-folder';
  if (entry.type === 'symlink') return 'fa-link';
  switch (entry.category) {
    case 'image':
      return 'fa-file-image';
    case 'video':
      return 'fa-file-video';
    case 'audio':
      return 'fa-file-audio';
    case 'pdf':
      return 'fa-file-pdf';
    case 'text':
      return 'fa-file-lines';
    case 'office':
      return 'fa-file-lines';
    case 'archive':
      return 'fa-file-zipper';
    default:
      return 'fa-file';
  }
}

/** Human-readable byte size. */
export function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Short locale date from an ISO timestamp. */
export function formatDate(iso?: string): string {
  return formatLocaleDate(iso, { year: 'numeric', month: 'short', day: 'numeric' });
}

