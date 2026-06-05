/**
 * Native Photo Editor routes — the app's photo-session flow.
 *
 * Rides the global `/api` authenticate gate; writes additionally require
 * admin/secretary.
 *
 *  GET  /:personId/photo-dates — appointments + visits to suggest session dates.
 *  POST /:personId/prepare     — find/create a timepoint in the local clone tables
 *                                (+ tblwork Initial/Final date conflict/override).
 *  POST /:personId/render      — resolve the timepoint, then render framed slots to
 *                                working/{pid}0{tp}.iNN + record rows in the local clone
 *                                tables IN THE BACKGROUND (202 + SSE on completion).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { EventEmitter } from 'events';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { InternalEmitterEvents } from '../../services/messaging/websocket-events.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import * as photoEditor from '../../shared/contracts/photo-editor.contract.js';
import {
  getPatientForPhotoSession,
  getExistingPhotoDate,
  updatePhotoDate,
  updatePatientName,
  getPhotoSessionAppointments,
  getPhotoSessionVisits,
} from '../../services/database/queries/photo-session-queries.js';
import {
  findOrCreateNativeTimePoint,
  upsertNativeTimePointImage,
  getNativeTimePoint,
  deleteNativeTimePointImage,
} from '../../services/database/queries/native-timepoint-queries.js';
import { transliterateNameToEnglish } from '../../services/business/name-transliteration.js';
import { renderSlotToWorking, deleteWorkingView } from '../../services/imaging/photo-render.service.js';
import { tagOriginalForView, untagOriginalForView } from '../../services/imaging/photo-original-tags.js';
import { timepointFolderName } from '../../services/imaging/photo-cleanup.service.js';
import { log } from '../../utils/logger.js';

const router = Router();

// In-process event bus, injected at boot (avoids a circular import on index.ts).
// Used to announce a finished background render so open photo grids refetch.
let wsEmitter: EventEmitter | null = null;
export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

/**
 * Latin-1 (CP1252) representable. Dolphin's patient-name columns are varchar with a Latin1
 * collation, so any non-Latin-1 character (e.g. Arabic script) is stored as '?'. We gate names
 * through this before they can reach the CDC dolphin sink.
 */
function isLatin1(s: string): boolean {
  // eslint-disable-next-line no-control-regex -- full Latin-1 byte range \u0000-\u00ff = "representable in a Latin1 varchar"
  return /^[\u0000-\u00ff]+$/.test(s);
}

interface SlotSpecBody {
  view?: string;
  sourceRelPath?: string;
  flipH?: boolean;
  flipV?: boolean;
  rotation?: number;
  extract?: { left: number; top: number; width: number; height: number };
  output?: { width: number; height: number };
}

// --- Boundary schemas ---
// The `personId` param + the `prepare`/`view` bodies live in the shared contract
// (`shared/contracts/photo-editor.contract.ts`). `/render` is EXCLUDED from the
// contract (raw 202 + background SSE), so its body schema stays inline here — it
// only reuses the contract's `personIdParams` guard.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const renderBodySchema = z.object({
  tpName: z.string().min(1, 'tpName is required'),
  tpDate: z.string().regex(YMD, 'Invalid tpDate (expected YYYY-MM-DD)'),
  // Keep slot contents opaque: per-slot shape is validated tolerantly in
  // processRenderJob (malformed slots are skipped, not rejected). z.unknown()
  // preserves each slot object untouched through the validate() write-back.
  slots: z.array(z.unknown()).min(1, 'No slots to render'),
});

// Schema-derived types — the validated, post-coercion shapes (slots stay opaque
// and are narrowed to SlotSpecBody[] at the processRenderJob boundary).
type PrepareBody = photoEditor.PrepareBody;
type RenderBody = z.infer<typeof renderBodySchema>;
type DeleteViewBody = photoEditor.DeleteViewBody;

/** Parse 'YYYY-MM-DD' to a LOCAL-midnight Date (pool runs useUTC:false). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * → 'YYYY-MM-DD'. PG `date` columns already arrive as 'YYYY-MM-DD' strings at
 * runtime (typed `Date` only by codegen), so pass those through untouched; only
 * real Date objects need formatting (never toISOString — that shifts to UTC).
 */
function toDateOnly(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * POST /:personId/prepare
 * Find/create a timepoint in the LOCAL clone tables, with tblwork Initial/Final
 * date conflict detection. All three normal outcomes ride the `sendSuccess`
 * envelope as a discriminated `PhotoPrepareResult` — `{ tp_code }` (prepared),
 * `{ conflict: true, … }` (override needed), or `{ needsName: true, … }` (English
 * name required). They are valid results, not errors, so they are HTTP 200 with
 * `success:true`; genuine failures (bad input, patient not found, server error)
 * go through `ErrorResponses.*` (non-2xx). PhotoSessionDialog funnels this through
 * `core/http.ts`, which unwraps the envelope and branches on the discriminant.
 */
router.post(
  '/:personId/prepare',
  authorize(['admin', 'secretary']),
  validate({ params: photoEditor.prepare.params, body: photoEditor.prepare.body }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpDescription, tpDate, overrideDate } = req.body as PrepareBody;

      const parsedDate = parseLocalDate(tpDate);
      if (!parsedDate) {
        ErrorResponses.badRequest(res, 'Invalid tpDate (expected YYYY-MM-DD)');
        return;
      }

      const patient = await getPatientForPhotoSession(personId);
      if (!patient) {
        ErrorResponses.notFound(res, 'Patient');
        return;
      }

      // Dolphin needs a Latin first+last name (its patient columns are varchar/Latin1 and corrupt
      // Arabic to '?'). If the patient has no English name, force one before any timepoint/image
      // row is created — otherwise the CDC dolphin sink replicates a '????' / empty-index patient
      // that can't be found in Dolphin Imaging.
      const dbFirst = patient.firstName?.trim() ?? '';
      const dbLast = patient.lastName?.trim() ?? '';
      if (!dbFirst || !dbLast) {
        const { firstName, lastName } = req.body as PrepareBody;
        let newFirst = firstName?.trim() ?? '';
        let newLast = lastName?.trim() ?? '';

        // No name supplied by the client → try to auto-fill by romanizing the Arabic patient_name
        // with Gemini. Best-effort; if it's unconfigured or can't produce a clean Latin first+last
        // we fall through to asking the user.
        if (!newFirst || !newLast) {
          const ai = await transliterateNameToEnglish(patient.patientName);
          if (ai) {
            newFirst = newFirst || ai.firstName;
            newLast = newLast || ai.lastName;
          }
        }

        if (!newFirst || !newLast) {
          sendData(res, photoEditor.prepare.response, {
            needsName: true,
            message:
              'This patient has no English name. Enter an English (Latin) first and last name to add photos — Dolphin Imaging cannot store Arabic names.',
          });
          return;
        }
        if (!isLatin1(newFirst) || !isLatin1(newLast)) {
          ErrorResponses.badRequest(
            res,
            'First and last name must use English (Latin) letters only — Dolphin Imaging cannot store Arabic names.'
          );
          return;
        }
        await updatePatientName(personId, newFirst, newLast);
        log.info('[PhotoEditor] set English name for Dolphin compatibility', {
          personId,
          firstName: newFirst,
          lastName: newLast,
        });
      }

      // tblwork Initial/Final date conflict detection + optional override.
      if (tpDescription === 'Initial' || tpDescription === 'Final') {
        const existing = await getExistingPhotoDate(personId);
        const existingDate =
          tpDescription === 'Initial' ? existing?.iPhotoDate : existing?.fPhotoDate;
        if (existingDate) {
          const existingDateOnly = toDateOnly(existingDate);
          if (existingDateOnly !== tpDate) {
            if (!overrideDate) {
              sendData(res, photoEditor.prepare.response, {
                conflict: true,
                conflictType: tpDescription,
                conflictSource: 'shwan',
                existingDate: existingDateOnly,
                requestedDate: tpDate,
                message: `There is already a ${tpDescription} photo date (${existingDateOnly}) stored in Shwan database that differs from the selected date (${tpDate}).`,
              });
              return;
            }
            await updatePhotoDate(
              personId,
              tpDescription === 'Initial' ? 'i_photo_date' : 'f_photo_date',
              parsedDate
            );
            log.info('[PhotoEditor] overrode tblwork photo date', {
              personId,
              tpDescription,
              from: existingDateOnly,
              to: tpDate,
            });
          }
        }
      }

      const { tp_code } = await findOrCreateNativeTimePoint(Number(personId), tpDescription, parsedDate);
      log.info('[PhotoEditor] prepared timepoint', { personId, tpDescription, tpDate, tp_code });
      sendData(res, photoEditor.prepare.response, { tp_code });
    } catch (err) {
      log.error('[PhotoEditor] prepare failed', { error: (err as Error).message });
      ErrorResponses.internalError(res, 'Failed to prepare timepoint', err as Error);
    }
  }
);

/**
 * POST /:personId/render
 * Resolve the timepoint synchronously, answer 202, then render each framed slot to
 * working/{pid}0{tp}.iNN and upsert local image rows IN THE BACKGROUND (see
 * processRenderJob). Slots are processed sequentially; partial success is tolerated.
 * Completion (with a warning count) is announced over SSE so the photo grid refetches.
 */
router.post(
  '/:personId/render',
  authorize(['admin', 'secretary']),
  validate({ params: photoEditor.personIdParams, body: renderBodySchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpName, tpDate, slots } = req.body as RenderBody;

      const parsedDate = parseLocalDate(tpDate);
      if (!parsedDate) {
        ErrorResponses.badRequest(res, 'Invalid tpDate (expected YYYY-MM-DD)');
        return;
      }

      // Idempotent: resolve the authoritative tp_code + timePointId for (name, date).
      const { tp_code, timePointId } = await findOrCreateNativeTimePoint(
        Number(personId),
        tpName,
        parsedDate
      );

      // Rendering is heavy: full-res sharp encodes of up to 8 ~15 MP views from
      // sources read over the SMB share. Running it inside the request pegs the CPU
      // and the client waits tens of seconds (and can hit the 30 s request timeout).
      // So we answer 202 the instant the timepoint is resolved and finish the slots
      // in the background; the open photos grid refetches when PHOTO_TIMEPOINT_RENDERED
      // reaches it over SSE.
      res.status(202).json({ success: true, queued: true, tp_code });

      void processRenderJob({
        personId: Number(personId),
        tpName,
        tpDate,
        parsedDate,
        tp_code,
        timePointId,
        // Slot internals are validated tolerantly inside processRenderJob.
        slots: slots as SlotSpecBody[],
        userId: req.session?.userId,
      });
    } catch (err) {
      log.error('[PhotoEditor] render failed', { error: (err as Error).message });
      if (!res.headersSent) {
        ErrorResponses.internalError(res, 'Failed to render photos', err as Error);
      }
    }
  }
);

interface RenderJob {
  personId: number;
  tpName: string;
  tpDate: string;
  parsedDate: Date;
  tp_code: number;
  timePointId: number;
  slots: SlotSpecBody[];
  userId?: number;
}

/**
 * Background worker for POST /render. Renders each slot, upserts its image row, tags
 * the source original, then emits PHOTO_TIMEPOINT_RENDERED so open photo grids
 * refetch. Detached from the HTTP request (the client already got its 202), so it
 * never touches res; partial success is tolerated and the warning count rides the
 * completion event. Wrapped so a stray error can't become an unhandledRejection.
 */
async function processRenderJob(job: RenderJob): Promise<void> {
  const { personId, tpName, tpDate, parsedDate, tp_code, timePointId, slots, userId } = job;
  const written: string[] = [];
  const warnings: string[] = [];
  const toTag: Array<{ view: string; sourceRelPath: string }> = [];

  try {
    for (const slot of slots) {
      const view = slot?.view;
      try {
        const ex = slot?.extract;
        const op = slot?.output;
        const isFiniteNum = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);
        const opOk = !!op && [op.width, op.height].every(isFiniteNum);
        const exOk = !ex || [ex.left, ex.top, ex.width, ex.height].every(isFiniteNum);
        if (typeof view !== 'string' || typeof slot?.sourceRelPath !== 'string' || !opOk || !exOk) {
          warnings.push(`Skipped malformed slot "${view ?? '?'}"`);
          continue;
        }

        const filename = await renderSlotToWorking({
          personId,
          tpCode: tp_code,
          view,
          sourceRelPath: slot.sourceRelPath,
          flipH: !!slot.flipH,
          flipV: !!slot.flipV,
          rotation: Number(slot.rotation) || 0,
          extract: ex,
          output: op,
        });

        const digits = view.slice(1); // 'i10' -> '10'
        await upsertNativeTimePointImage(
          timePointId,
          personId,
          digits,
          `${personId}0${tp_code}.I${digits}`, // stored image-file form (uppercase I)
          parsedDate,
          null
        );
        written.push(filename);
        toTag.push({ view, sourceRelPath: slot.sourceRelPath });
      } catch (err) {
        warnings.push(`${view ?? '?'}: ${(err as Error).message}`);
        log.warn('[PhotoEditor] slot render failed', {
          personId,
          view,
          error: (err as Error).message,
        });
      }
    }

    // tag each rendered original with its view so a later reopen can restore it
    // for re-editing (our filesystem alternative to Dolphin's .v originals).
    const folder = timepointFolderName(tpName, tpDate);
    if (folder) {
      for (const t of toTag) {
        try {
          await tagOriginalForView(personId, folder, t.sourceRelPath, t.view);
        } catch (err) {
          log.warn('[PhotoEditor] tag original failed', { view: t.view, error: (err as Error).message });
        }
      }
    }

    log.info('[PhotoEditor] render complete', {
      userId,
      personId,
      tp_code,
      written: written.length,
      warnings: warnings.length,
    });
  } catch (err) {
    log.error('[PhotoEditor] background render job failed', {
      personId,
      tp_code,
      error: (err as Error).message,
    });
  } finally {
    // Always announce completion so the grid refetches even on partial/total failure.
    wsEmitter?.emit(InternalEmitterEvents.PHOTO_TIMEPOINT_RENDERED, {
      personId,
      tp_code,
      written: written.length,
      warnings: warnings.length,
    });
  }
}

/**
 * DELETE /:personId/view
 * Remove ONE saved view: delete its cropped working file + its tblTimePointImages
 * row, and untag the source original (rename `i{view}-NAME` back to `NAME`, so it
 * returns to the sidebar). The ORIGINAL photo is kept — only the derived crop goes.
 * Idempotent/best-effort: missing pieces are tolerated.
 */
router.delete(
  '/:personId/view',
  authorize(['admin', 'secretary']),
  validate({ params: photoEditor.view.params, body: photoEditor.view.body }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpCode, tpName, tpDate, view } = req.body as DeleteViewBody;
      const tpCodeNum = tpCode; // already coerced to a non-negative int by the schema

      // 1. Delete the cropped working file (idempotent).
      await deleteWorkingView(Number(personId), tpCodeNum, view);

      // 2. Delete the DB image row (resolve timePointId; skip if the timepoint is gone).
      const tp = await getNativeTimePoint(Number(personId), tpCodeNum);
      if (tp) {
        await deleteNativeTimePointImage(tp.timePointId, view.slice(1));
      }

      // 3. Untag the source original so it returns to the sidebar (original kept).
      const folder = tpName && tpDate ? timepointFolderName(tpName, tpDate) : null;
      if (folder) {
        await untagOriginalForView(Number(personId), folder, view);
      }

      log.info('[PhotoEditor] removed view', {
        userId: req.session?.userId,
        personId,
        tp_code: tpCodeNum,
        view,
      });
      sendData(res, photoEditor.view.response, { removed: view });
    } catch (err) {
      log.error('[PhotoEditor] remove view failed', { error: (err as Error).message });
      ErrorResponses.internalError(res, 'Failed to remove view', err as Error);
    }
  }
);

/**
 * GET /:personId/photo-dates
 * Appointments + visits used to suggest dates in the photo-session dialog.
 */
router.get('/:personId/photo-dates', validate({ params: photoEditor.photoDates.params }), async (req: Request, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;
    const [appointments, visits] = await Promise.all([
      getPhotoSessionAppointments(personId),
      getPhotoSessionVisits(personId),
    ]);
    sendData(res, photoEditor.photoDates.response, { appointments, visits });
  } catch (err) {
    log.error('[PhotoEditor] photo-dates failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to fetch photo dates', err as Error);
  }
});

export default router;
