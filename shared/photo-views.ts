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
 * `photo-editor/photoEditorTypes.ts`, `types/api.types.ts`).
 */

/**
 * The 8 editable view codes, in CLIENT/GRID order (matches GridComponent +
 * services/imaging getImageSizes layout). The client iterates this for slot
 * rendering, save order, and hydration; server consumers only build a Set or
 * regex from it, so the ordering is theirs to own.
 */
export const VIEW_CODES = ['i10', 'i12', 'i13', 'i23', 'i24', 'i20', 'i22', 'i21'] as const;

export type PhotoViewCode = (typeof VIEW_CODES)[number];

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
