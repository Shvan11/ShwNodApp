/**
 * Saved-configuration ⇄ timeline conversion for the Patient Presentation Slideshow.
 *
 * - `toLiteralPayload` captures the current timeline as a per-patient literal
 *   config (each photo by source: gallery tp+name, or folder relPath).
 * - `rebuildLiteral` turns a saved literal config back into SlideItems,
 *   rebuilding each photo's URL (gallery → /DolImgs, folder → files/content).
 * - `resolveTemplate` expands a generic template (photo-type + first/latest
 *   session) against the OPEN patient's timepoints + galleries, skipping and
 *   counting any photo the patient doesn't have.
 *
 * All three are pure helpers over the existing slideshow data — no network of
 * their own beyond the `loadGallery` callback the caller already owns.
 */
import { generateId } from '../../../core/utils';
import { buildContentUrl } from '../files/fileHelpers';
import { imageTypeCode, slidePhotos } from './photoTypes';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import type { ConfigPayload } from '@shared/contracts/slideshow.contract';

type LiteralPayload = Extract<ConfigPayload, { kind: 'literal' }>;
type LiteralRef = LiteralPayload['slides'][number]['photos'][number];
type TemplatePayload = Extract<ConfigPayload, { kind: 'template' }>;

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

/** dd-mm-yyyy → sortable yyyy-mm-dd (empty stays empty). */
function sortableDate(ddmmyyyy: string): string {
  return ddmmyyyy ? ddmmyyyy.split('-').reverse().join('-') : '';
}

/**
 * Generalize the current timeline into a template: the earliest timepoint becomes
 * `first`, the later one `latest`, and each photo is captured by its image-type
 * code. Caller MUST gate on `canSaveAsTemplate` first (guarantees gallery-only
 * photos with type codes across ≤2 timepoints).
 */
export function toTemplatePayload(selected: SlideItem[]): TemplatePayload {
  const photos = selected.flatMap(slidePhotos);
  const distinctTps = [...new Set(photos.map((p) => p.tp))];
  const dateOf = (tp: string): string => sortableDate(photos.find((p) => p.tp === tp)?.tpDate ?? '');
  distinctTps.sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const firstTp = distinctTps[0];
  const role = (tp: string): 'first' | 'latest' => (tp === firstTp ? 'first' : 'latest');

  return {
    kind: 'template',
    slides: selected.map((item) => ({
      photos: slidePhotos(item).map((p) => ({ tp: role(p.tp), type: imageTypeCode(p.name) ?? '' })),
    })),
  };
}

// ── Apply: literal payload → SlideItems ──────────────────────────────────────

function refToPhoto(ref: LiteralRef, personId: number): SlidePhoto {
  if (ref.source === 'folder') {
    return {
      source: 'folder',
      path: ref.path,
      name: ref.name,
      label: ref.label,
      url: buildContentUrl(personId, ref.path),
      tp: '',
      tpDescription: '',
      tpDate: '',
    };
  }
  return {
    source: 'gallery',
    name: ref.name,
    label: ref.label,
    tp: ref.tp,
    tpDescription: ref.tpDescription,
    tpDate: ref.tpDate,
    url: `/DolImgs/${ref.name}`,
  };
}

export function rebuildLiteral(payload: LiteralPayload, personId: number): SlideItem[] {
  return payload.slides.map((slide) => toSlide(slide.photos.map((ref) => refToPhoto(ref, personId))));
}

// ── Apply: template payload → SlideItems (resolved against this patient) ──────

export async function resolveTemplate(
  payload: TemplatePayload,
  timepoints: Timepoint[],
  loadGallery: (tp: Timepoint) => Promise<SlidePhoto[]>
): Promise<{ slides: SlideItem[]; missing: number }> {
  // first = earliest session, latest = most recent (by date string, ascending).
  const sorted = [...timepoints].sort((a, b) => a.tpDateTime.localeCompare(b.tpDateTime));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];

  const galleryCache = new Map<string, SlidePhoto[]>();
  const getGallery = async (tp: Timepoint): Promise<SlidePhoto[]> => {
    const cached = galleryCache.get(tp.tpCode);
    if (cached) return cached;
    const loaded = await loadGallery(tp);
    galleryCache.set(tp.tpCode, loaded);
    return loaded;
  };

  let missing = 0;
  const slides: SlideItem[] = [];

  for (const slide of payload.slides) {
    const photos: SlidePhoto[] = [];
    for (const ref of slide.photos) {
      const tp = ref.tp === 'first' ? first : latest;
      if (!tp) {
        missing++;
        continue;
      }
      const gallery = await getGallery(tp);
      const match = gallery.find((p) => imageTypeCode(p.name) === ref.type);
      if (!match) {
        missing++;
        continue;
      }
      photos.push(match);
    }
    if (photos.length) slides.push(toSlide(photos));
  }

  return { slides, missing };
}
