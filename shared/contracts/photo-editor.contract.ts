/**
 * API contract — native photo-editor endpoints (`/api/photo-editor/:personId/…`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 12 (Wave 2). Group A. `POST /:personId/render` is EXCLUDED from the
 * envelope (it answers a raw 202 + finishes in the background, announcing over
 * SSE — see CLAUDE.md); its body schema stays inline in the route, but it shares
 * the `personIdParams` guard authored here. `/prepare` returns a discriminated
 * `PhotoPrepareResult` ({ tp_code } | { conflict … } | { needsName … }) — modeled
 * as a `looseObject` with the three discriminants optional so each branch's
 * literal validates and the consumer keeps branching on them.
 */
import { z } from 'zod';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Shared `:personId` numeric param (also referenced by the excluded /render).
export const personIdParams = z.object({
  personId: z.string().regex(/^\d+$/, 'Invalid patient id'),
});

// POST /api/photo-editor/:personId/prepare → discriminated PhotoPrepareResult.
// No firstName/lastName here: a patient missing an English name is bounced to the
// Edit Patient form (the `needsName` result) rather than captured inline — see
// PhotoSessionDialog. Dolphin needs a Latin name, but acquiring it is no longer
// part of this hot path.
export const prepare = {
  params: personIdParams,
  body: z.object({
    tpDescription: z.string().min(1, 'tpDescription is required'),
    tpDate: z.string().regex(YMD, 'Invalid tpDate (expected YYYY-MM-DD)'),
    overrideDate: z.boolean().optional(),
  }),
  response: z.looseObject({
    tp_code: z.number().optional(),
    conflict: z.boolean().optional(),
    needsName: z.boolean().optional(),
  }),
} as const;
export type PrepareBody = z.infer<typeof prepare.body>;

// DELETE /api/photo-editor/:personId/view → { removed, files }. The session is resolved by
// code alone — its originals folder comes from the row, not from a name/date the
// client carried in a possibly stale URL (FE-F14-3). `files` names what went to the
// patient's trash: the view's image and, for a slot Dolphin filled, its `.vNN` original.
export const view = {
  params: personIdParams,
  body: z.object({
    tpCode: z.coerce.number().int().nonnegative(),
    view: z.string().regex(/^i(10|12|13|20|21|22|23|24)$/, 'Invalid view code'),
  }),
  response: z.object({ removed: z.string(), files: z.array(z.string()) }),
} as const;
export type DeleteViewBody = z.infer<typeof view.body>;

// GET /api/photo-editor/:personId/photo-dates → { appointments, visits }.
// appointments: PhotoSessionAppointment[] { date, description }
// visits: PhotoSessionVisit[] { visitDate, hasInitialPhoto, hasFinalPhoto, hasProgressPhoto }
export const photoDates = {
  params: personIdParams,
  response: z.object({
    appointments: z.array(z.looseObject({ date: z.string() })),
    visits: z.array(z.looseObject({ visitDate: z.string() })),
  }),
} as const;

// GET /api/photo-editor/:personId/taken-dates?folder=&scope= → { dates }. Each
// original's EXIF capture time ('YYYY-MM-DDTHH:MM:SS', zone-less local wall clock —
// see services/imaging/exif-taken-at.ts), keyed by file name; null = the file carries
// none. `scope=views` reads only the view-tagged originals (the photo grid's caption),
// `all` every image (the editor's Sequence Files list, the Files page). A missing
// folder is `{}`; `folder=` (empty) is the patient folder itself, as the Files page
// names it.
export const takenDatesScope = z.enum(['views', 'all']);
export const takenDates = {
  params: personIdParams,
  query: z.object({
    folder: z.string().max(260),
    scope: takenDatesScope.default('all'),
  }),
  response: z.object({
    dates: z.record(z.string(), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/).nullable()),
  }),
} as const;
export type TakenDatesScope = z.infer<typeof takenDatesScope>;
export type TakenDatesQuery = z.infer<typeof takenDates.query>;
export type TakenDatesResponse = z.infer<typeof takenDates.response>;

// A saved view's FRAMING — what the editor needs to reopen it where it was left
// ("Continue editing") and to show what was changed. POST /render records it INSIDE
// the rendered JPEG (XMP — services/imaging/photo-framing-xmp.ts), so it always
// describes exactly the pixels it sits in: a view rendered any other way (Dolphin, a
// build before this) carries none, and is reopened only "from scratch".
//  - `source`: the original it was cut from — the CLEAN name (no `{view}-` tag), its
//    mtime as the folder listing reports it (`modified`, ISO), and its post-EXIF size.
//    The editor offers "Continue" only while the view's tagged original is still that
//    file.
//  - `area`: react-easy-crop's croppedAreaPercentages — the frame in % of the flipped +
//    rotated photo's bounding box. Resolution-free, so it restores the same frame in the
//    Fast-preview proxy and the full original alike. It may run past 0–100 (a frame
//    that leaves the photo is filled with white).
//  - `zoom`: 1 = the photo just covers the frame.
export const framingArea = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export const savedFraming = z.object({
  v: z.literal(1),
  source: z.object({
    name: z.string().min(1),
    modified: z.string().nullable(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  rotation: z.number(),
  flipH: z.boolean(),
  flipV: z.boolean(),
  zoom: z.number().positive(),
  area: framingArea,
});
export type FramingArea = z.infer<typeof framingArea>;
export type SavedFraming = z.infer<typeof savedFraming>;

// GET /api/photo-editor/:personId/framing/:tpCode → the session's saved views'
// recorded framing, KEYED BY VIEW CODE like the gallery; null = that view is not
// rendered, or was rendered without a record (see `savedFraming`).
const viewFraming = savedFraming.nullable();
export const framing = {
  params: z.object({
    personId: z.string().regex(/^\d+$/, 'Invalid patient id'),
    tpCode: z.string().regex(/^\d+$/, 'Invalid timepoint code'),
  }),
  response: z.object({
    i10: viewFraming, i12: viewFraming, i13: viewFraming, i23: viewFraming,
    i24: viewFraming, i20: viewFraming, i22: viewFraming, i21: viewFraming,
  }),
} as const;
export type FramingResponse = z.infer<typeof framing.response>;

// GET /api/photo-editor/:personId/source-size?path= → an original's pixel size AFTER
// EXIF orientation (what a browser's naturalWidth/Height report). The editor frames
// against a 2048 px proxy by default, so this is how it knows the resolution a save
// will keep (output = the crop's native pixels).
export const sourceSize = {
  params: personIdParams,
  query: z.object({ path: z.string().min(1, 'path is required').max(1024) }),
  response: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
} as const;
export type SourceSizeQuery = z.infer<typeof sourceSize.query>;
export type SourceSizeResponse = z.infer<typeof sourceSize.response>;

// SSE `photos_rendered` (appointments stream) — a background render finished. Not an
// HTTP response: the frame the broadcaster forwards from POST /render's job. `jobId`
// is the id the client sent with the render (absent for a legacy caller); `problems`
// names each view that did not render and why (FE-F14-4). Parsed with `safeParse` by
// the client — an event is a stream frame, not a fail-loud read.
export const renderedEvent = z.looseObject({
  personId: z.union([z.number(), z.string()]),
  tpCode: z.union([z.number(), z.string()]),
  jobId: z.string().optional(),
  written: z.number().optional(),
  warnings: z.number().optional(),
  problems: z.array(z.object({ view: z.string(), reason: z.string() })).optional(),
  total: z.number().optional(),
});
export type RenderedEvent = z.infer<typeof renderedEvent>;
