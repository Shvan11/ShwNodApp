/**
 * Timeline ⇄ photo conversion for the Patient Presentation Slideshow.
 *
 * - `galleryPhotos` / `folderPhoto` build a `SlidePhoto` from what is on disk NOW — a
 *   gallery entry (real name + mtime) or a folder path. Every URL is built here, at
 *   render or apply time, never stored (FE-F15-4).
 * - `toLiteralPayload` captures the current timeline as a per-patient literal
 *   config (each photo by source: gallery tp+name, or folder relPath).
 * - `rebuildLiteral` turns a saved literal config back into SlideItems, against the
 *   patient's CURRENT sessions and galleries, skipping and counting photos that are
 *   gone (it used to rebuild `/DolImgs/{name}` blindly, with no version, and a gone
 *   photo played as a grey placeholder after "Applied").
 * - `resolveTemplate` expands a generic template (photo-type + first/latest
 *   session) against the OPEN patient's sessions, skipping and counting any photo
 *   the patient doesn't have.
 *
 * Pure helpers — no network of their own beyond the `getGallery` callback.
 */
import { generateId } from '../../../core/utils';
import { buildContentUrl, buildWorkingContentUrl } from '../files/fileHelpers';
import { VIEW_CODES, viewLabel } from '@shared/photo-views';
import type { GalleryResponse } from '@shared/contracts/patient.contract';
import { imageTypeCode, slidePhotos } from './photoTypes';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import type { ConfigPayload } from '@shared/contracts/slideshow.contract';

type LiteralPayload = Extract<ConfigPayload, { kind: 'literal' }>;
type LiteralRef = LiteralPayload['slides'][number]['photos'][number];
type TemplatePayload = Extract<ConfigPayload, { kind: 'template' }>;

/** A session's gallery, or null when the session is gone or its read failed. */
export type GetGallery = (tp: string) => Promise<GalleryResponse | null>;

/** dd-mm-yyyy, matching the convention used elsewhere (Navigation.formatDate). */
export const formatSessionDate = (dateTime: string): string =>
  dateTime ? dateTime.substring(0, 10).split('-').reverse().join('-') : '';

/** Sessions in date order, oldest first (code breaks a tie) — what first/latest mean. */
export const byDate = (sessions: Timepoint[]): Timepoint[] =>
  [...sessions].sort(
    (a, b) => a.tp_date_time.localeCompare(b.tp_date_time) || Number(a.tp_code) - Number(b.tp_code)
  );

/** A session's rendered views as palette photos — URL and version from the gallery read. */
export function galleryPhotos(personId: number, session: Timepoint, gallery: GalleryResponse): SlidePhoto[] {
  return VIEW_CODES.flatMap((view) => {
    const e = gallery[view];
    if (!e) return [];
    return [
      {
        source: 'gallery' as const,
        name: e.name,
        url: `/DolImgs/${e.name}?v=${e.mtime}`,
        thumbUrl: buildWorkingContentUrl(personId, e.name, { thumb: 480, v: e.mtime }),
        tp: session.tp_code,
        tpDescription: session.tp_description,
        tpDate: formatSessionDate(session.tp_date_time),
        label: viewLabel(view),
      },
    ];
  });
}

/**
 * Formats Chrome and Edge cannot display — they play through the server's image
 * converter (the editor's 2048 px preview) instead of as a raw file (FE-F15-5).
 */
const NEEDS_CONVERSION = /\.(tiff?|heic|heif)$/i;

/** A patient-folder image as a slide photo. */
export function folderPhoto(personId: number, path: string, name: string): SlidePhoto {
  return {
    source: 'folder',
    path,
    name,
    label: name,
    url: NEEDS_CONVERSION.test(name)
      ? buildContentUrl(personId, path, { thumb: 2048 })
      : buildContentUrl(personId, path),
    thumbUrl: buildContentUrl(personId, path, { thumb: 240 }),
    tp: '',
    tpDescription: '',
    tpDate: '',
  };
}

/** Assemble a slide from resolved photos: photos[0] is primary, the rest are extras. */
function toSlide(photos: SlidePhoto[]): SlideItem {
  const [primary, ...extras] = photos;
  return { ...primary, uid: generateId(), ...(extras.length ? { extras } : {}) };
}

// ── Capture: current timeline → literal payload ──────────────────────────────

function photoToRef(p: SlidePhoto): LiteralRef {
  if (p.source === 'folder' && p.path) {
    return { source: 'folder', path: p.path, name: p.name, label: p.label };
  }
  return {
    source: 'gallery',
    tp: p.tp,
    name: p.name,
    label: p.label,
    tpDescription: p.tpDescription,
    tpDate: p.tpDate,
  };
}

export function toLiteralPayload(selected: SlideItem[]): LiteralPayload {
  return {
    kind: 'literal',
    slides: selected.map((item) => ({ photos: slidePhotos(item).map(photoToRef) })),
  };
}

// ── Capture: current timeline → generic template payload ──────────────────────

/**
 * A timeline can become a clinic-wide generic template only when every photo is a
 * GALLERY photo (folder filenames aren't consistent across patients), carries a
 * recognizable image-type code, and the whole sequence spans at most TWO
 * timepoints (mapped to first/latest on apply).
 */
export function canSaveAsTemplate(selected: SlideItem[]): boolean {
  if (selected.length === 0) return false;
  const photos = selected.flatMap(slidePhotos);
  if (photos.some((p) => p.source === 'folder')) return false;
  if (photos.some((p) => !imageTypeCode(p.name))) return false;
  const tps = new Set(photos.map((p) => p.tp));
  return tps.size >= 1 && tps.size <= 2;
}

/**
 * Which end each of the timeline's sessions becomes in a template. Two sessions: the
 * earlier is `first`, the later `latest`. ONE session: `first` only when it is this
 * patient's earliest session, otherwise `latest` — a template saved from the Final
 * photos always used to become `first` and apply as the Initial ones (FE-F15-3b).
 */
export function templateRoles(selected: SlideItem[], sessions: Timepoint[]): Record<string, 'first' | 'latest'> {
  const photos = selected.flatMap(slidePhotos);
  const ordered = byDate(sessions).map((s) => s.tp_code);
  const rank = (tp: string): number => {
    const i = ordered.indexOf(tp);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const distinct = [...new Set(photos.map((p) => p.tp))].sort((a, b) => rank(a) - rank(b));
  if (distinct.length === 1) {
    return { [distinct[0]]: rank(distinct[0]) === 0 ? 'first' : 'latest' };
  }
  return Object.fromEntries(distinct.map((tp, i) => [tp, i === 0 ? 'first' : 'latest']));
}

/**
 * Generalize the current timeline into a template, each photo by its image-type code.
 * Caller MUST gate on `canSaveAsTemplate` first.
 */
export function toTemplatePayload(selected: SlideItem[], sessions: Timepoint[]): TemplatePayload {
  const roles = templateRoles(selected, sessions);
  return {
    kind: 'template',
    slides: selected.map((item) => ({
      photos: slidePhotos(item).map((p) => ({ tp: roles[p.tp] ?? 'latest', type: imageTypeCode(p.name) ?? '' })),
    })),
  };
}

// ── Apply: literal payload → SlideItems ──────────────────────────────────────

/**
 * Rebuild a saved presentation against what exists NOW. A gallery photo resolves only
 * when its session still exists and its gallery still has that file (either case); it
 * takes the current URL, version and caption. Folder photos are kept as saved.
 */
export async function rebuildLiteral(
  payload: LiteralPayload,
  personId: number,
  sessions: Timepoint[],
  getGallery: GetGallery
): Promise<{ slides: SlideItem[]; missing: number }> {
  let missing = 0;
  const slides: SlideItem[] = [];
  for (const slide of payload.slides) {
    const photos: SlidePhoto[] = [];
    for (const ref of slide.photos) {
      if (ref.source === 'folder') {
        photos.push(folderPhoto(personId, ref.path, ref.name));
        continue;
      }
      const session = sessions.find((s) => s.tp_code === ref.tp);
      const gallery = session ? await getGallery(ref.tp) : null;
      const match =
        session && gallery
          ? galleryPhotos(personId, session, gallery).find((p) => p.name.toLowerCase() === ref.name.toLowerCase())
          : undefined;
      if (match) photos.push(match);
      else missing++;
    }
    if (photos.length) slides.push(toSlide(photos));
  }
  return { slides, missing };
}

// ── Apply: template payload → SlideItems (resolved against this patient) ──────

/**
 * `first` = the earliest session that HAS the view, `latest` = the newest that has it.
 * The newest session lacking a Smile used to report it "not available" although an
 * earlier session had one (FE-F15-3c). A slide whose refs resolve to the SAME photo —
 * a one-session patient's before/after — is skipped and counted in `sameSession`
 * instead of showing one photo twice (FE-F15-3a, 776 live patients).
 */
export async function resolveTemplate(
  payload: TemplatePayload,
  personId: number,
  sessions: Timepoint[],
  getGallery: GetGallery
): Promise<{ slides: SlideItem[]; missing: number; sameSession: number }> {
  const oldestFirst = byDate(sessions);
  const newestFirst = [...oldestFirst].reverse();

  const find = async (type: string, order: Timepoint[]): Promise<SlidePhoto | null> => {
    for (const session of order) {
      const gallery = await getGallery(session.tp_code);
      if (!gallery) continue;
      const match = galleryPhotos(personId, session, gallery).find((p) => imageTypeCode(p.name) === type);
      if (match) return match;
    }
    return null;
  };

  let missing = 0;
  let sameSession = 0;
  const slides: SlideItem[] = [];

  for (const slide of payload.slides) {
    const photos: SlidePhoto[] = [];
    for (const ref of slide.photos) {
      const match = await find(ref.type, ref.tp === 'first' ? oldestFirst : newestFirst);
      if (match) photos.push(match);
      else missing++;
    }
    const ids = photos.map((p) => `${p.tp}:${p.name}`);
    if (new Set(ids).size < ids.length) {
      sameSession++;
      continue;
    }
    if (photos.length) slides.push(toSlide(photos));
  }

  return { slides, missing, sameSession };
}
