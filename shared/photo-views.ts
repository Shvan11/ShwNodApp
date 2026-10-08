/**
 * The 8 fixed Dolphin photo-view slots + the original-photo "view tag" filename
 * convention — the single source of truth for BOTH sides of the photo editor.
 *
 * A timepoint's source original for a view is renamed in-place to carry a
 * readable `{view}-` prefix (e.g. `IMG_001.jpg` → `i12-IMG_001.jpg`), so on
 * reopen the editor knows which original produced which cropped view and can
 * reload it for re-editing — no manifest / DB needed. Exactly one file is
 * tagged per view; a file carries at most one view tag.
 *
 * LOCATION: lives in `shared/` (project root) so it is importable by BOTH the
 * Express side (relative `.js` — `services/imaging/photo-original-tags.ts`,
 * `photo-render.service.ts`) and the React bundle (`@shared` alias —
 * `photo-editor/photoEditorTypes.ts`, `middleware/types.ts`).
 */

/**
 * The 8 editable view codes, in CLIENT/GRID order (matches GridComponent +
 * services/imaging getImageSizes layout). The client iterates this for slot
 * rendering, save order, and hydration; server consumers only build a Set or
 * regex from it, so the ordering is theirs to own.
 */
export const VIEW_CODES = ['i10', 'i12', 'i13', 'i23', 'i24', 'i20', 'i22', 'i21'] as const;

export type PhotoViewCode = (typeof VIEW_CODES)[number];

/** Each view's short label — the one table the grid, editor, Compare, slideshow and
 *  the save watcher read (it used to exist three times — audit FE-F15-12). */
export const VIEW_LABELS: Readonly<Record<PhotoViewCode, string>> = {
  i10: 'Profile',
  i12: 'Rest',
  i13: 'Smile',
  i23: 'Upper',
  i24: 'Lower',
  i20: 'Right',
  i22: 'Center',
  i21: 'Left',
};

/** Label for a view code; an unknown code is shown as itself. */
export function viewLabel(view: string): string {
  return (VIEW_LABELS as Record<string, string>)[view] ?? view.toUpperCase();
}

/**
 * Dolphin's OTHER image slots. A Dolphin session can hold more than the 8 views above
 * (an OPG, a ceph, model photos, cut/paste images), each named like a view
 * (`{personId}{tp:02}.iNN`, e.g. `2700.I51`) in the same working gallery. The 8-cell
 * grid has no place for them; the working-files page shows them beside the views.
 *
 * Only the X-ray slots get a name here, because only they say what is in them. A clinic
 * can put any picture in Dolphin's other slots (this one keeps smile close-ups in
 * "Ceph Front", `i02`), so naming those after the slot would mislabel them: they are
 * shown as "Image". Codes and meanings are Dolphin's own (its image-type table,
 * mirrored in `image_types`).
 */
export const XRAY_SLOT_LABELS: Readonly<Record<string, string>> = {
  i01: 'Ceph', // Ceph Right X-Ray
  i03: 'PA ceph', // Ceph Front X-Ray
  i50: 'Ceph', // X-ray Lateral
  i51: 'OPG', // X-ray Panoramic
  i52: 'Frontal X-ray',
  i53: 'Upper occlusal X-ray',
  i54: 'Lower occlusal X-ray',
  i55: 'Periapicals (right)',
  i56: 'Periapicals (center)',
  i57: 'Periapicals (left)',
};

/** Any Dolphin image slot code, in either case (`i12`, `I51`). */
export const DOLPHIN_SLOT_RE = /^i\d{2}$/i;

/** Whether a slot holds an X-ray, by Dolphin's definition of the slot. */
export function isXraySlot(code: string): boolean {
  return code.toLowerCase() in XRAY_SLOT_LABELS;
}

/** Label for any Dolphin slot: a grid view's, an X-ray's, otherwise "Image". */
export function slotLabel(code: string): string {
  const c = code.toLowerCase();
  return (VIEW_LABELS as Record<string, string>)[c] ?? XRAY_SLOT_LABELS[c] ?? 'Image';
}

/**
 * Longest edge a rendered view may have, in pixels. A view keeps its crop's NATIVE
 * resolution; only a pathological zoom-out (a frame far larger than the photo) is
 * scaled down to this. Shared so the editor's resolution readout predicts the render
 * (`services/imaging/photo-render.service.ts`) exactly.
 */
export const MAX_RENDER_EDGE = 8000;

/** `{viewCode}-{originalName}` — code prefix, hyphen, no spaces. */
export const VIEW_TAG_RE = /^(i10|i12|i13|i20|i21|i22|i23|i24)-(.+)$/;

export interface ViewTag {
  view: PhotoViewCode;
  /** The original filename with the `{view}-` prefix stripped. */
  original: string;
}

/** Parse a `{view}-{original}` filename, or null if it carries no view tag. */
export function parseViewTag(name: string): ViewTag | null {
  const m = VIEW_TAG_RE.exec(name);
  return m ? { view: m[1] as PhotoViewCode, original: m[2] } : null;
}

export function isViewCode(v: string): v is PhotoViewCode {
  return (VIEW_CODES as readonly string[]).includes(v);
}
