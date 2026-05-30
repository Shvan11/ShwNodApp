/**
 * Native Photo Editor routes — the app's photo-session flow.
 *
 * Rides the global `/api` authenticate gate; writes additionally require
 * admin/secretary.
 *
 *  GET  /:personId/photo-dates — appointments + visits to suggest session dates.
 *  POST /:personId/prepare     — find/create a timepoint in the local clone tables
 *                                (+ tblwork Initial/Final date conflict/override).
 *  POST /:personId/render      — render framed slots to working/{pid}0{tp}.iNN and
 *                                record rows in the local clone tables.
 */
import { Router, type Request, type Response } from 'express';
import { authorize } from '../../middleware/auth.js';
import { sendSuccess, ErrorResponses } from '../../utils/error-response.js';
import {
  getPatientForPhotoSession,
  getExistingPhotoDate,
  updatePhotoDate,
  getPhotoSessionAppointments,
  getPhotoSessionVisits,
} from '../../services/database/queries/photo-session-queries.js';
import {
  findOrCreateNativeTimePoint,
  upsertNativeTimePointImage,
  getNativeTimePoint,
  deleteNativeTimePointImage,
} from '../../services/database/queries/native-timepoint-queries.js';
import { renderSlotToWorking, deleteWorkingView } from '../../services/imaging/photo-render.service.js';
import { tagOriginalForView, untagOriginalForView } from '../../services/imaging/photo-original-tags.js';
import { timepointFolderName } from '../../services/imaging/photo-cleanup.service.js';
import { log } from '../../utils/logger.js';

const router = Router();

interface PrepareBody {
  tpDescription?: string;
  tpDate?: string; // YYYY-MM-DD
  overrideDate?: boolean;
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

interface RenderBody {
  tpName?: string;
  tpDate?: string; // YYYY-MM-DD
  slots?: SlotSpecBody[];
}

/** Parse 'YYYY-MM-DD' to a LOCAL-midnight Date (pool runs useUTC:false). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** LOCAL date components → 'YYYY-MM-DD' (never toISOString — that shifts to UTC). */
function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * POST /:personId/prepare
 * Find/create a timepoint in the LOCAL clone tables, with tblwork Initial/Final
 * date conflict detection. Returns success/conflict/tpCode at the top level so
 * PhotoSessionDialog's conflict/override UI can consume it directly.
 */
router.post(
  '/:personId/prepare',
  authorize(['admin', 'secretary']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpDescription, tpDate, overrideDate } = req.body as PrepareBody;

      if (!/^\d+$/.test(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (!tpDescription || !tpDate) {
        ErrorResponses.badRequest(res, 'Missing required fields: tpDescription, tpDate');
        return;
      }
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

      // tblwork Initial/Final date conflict detection + optional override.
      if (tpDescription === 'Initial' || tpDescription === 'Final') {
        const existing = await getExistingPhotoDate(personId);
        const existingDate =
          tpDescription === 'Initial' ? existing?.iPhotoDate : existing?.fPhotoDate;
        if (existingDate) {
          const existingDateOnly = toDateOnly(existingDate);
          if (existingDateOnly !== tpDate) {
            if (!overrideDate) {
              res.json({
                success: false,
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
              tpDescription === 'Initial' ? 'IPhotoDate' : 'FPhotoDate',
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

      const { tpCode } = await findOrCreateNativeTimePoint(Number(personId), tpDescription, parsedDate);
      log.info('[PhotoEditor] prepared timepoint', { personId, tpDescription, tpDate, tpCode });
      res.json({ success: true, tpCode });
    } catch (err) {
      log.error('[PhotoEditor] prepare failed', { error: (err as Error).message });
      ErrorResponses.internalError(res, 'Failed to prepare timepoint', err as Error);
    }
  }
);

/**
 * POST /:personId/render
 * Render each framed slot to working/{pid}0{tp}.iNN and upsert local image rows.
 * Slots are processed sequentially (one full-res decode in flight per request);
 * partial success is tolerated and reported via `warnings`.
 */
router.post(
  '/:personId/render',
  authorize(['admin', 'secretary']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpName, tpDate, slots } = req.body as RenderBody;

      if (!/^\d+$/.test(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (!tpName || !tpDate) {
        ErrorResponses.badRequest(res, 'Missing required fields: tpName, tpDate');
        return;
      }
      const parsedDate = parseLocalDate(tpDate);
      if (!parsedDate) {
        ErrorResponses.badRequest(res, 'Invalid tpDate (expected YYYY-MM-DD)');
        return;
      }
      if (!Array.isArray(slots) || slots.length === 0) {
        ErrorResponses.badRequest(res, 'No slots to render');
        return;
      }

      // Idempotent: resolve the authoritative tpCode + timePointId for (name, date).
      const { tpCode, timePointId } = await findOrCreateNativeTimePoint(
        Number(personId),
        tpName,
        parsedDate
      );

      const written: string[] = [];
      const warnings: string[] = [];
      const toTag: Array<{ view: string; sourceRelPath: string }> = [];

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
            personId: Number(personId),
            tpCode,
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
            Number(personId),
            digits,
            `${personId}0${tpCode}.I${digits}`, // stored image-file form (uppercase I)
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

      // Tag each rendered original with its view so a later reopen can restore it
      // for re-editing (our filesystem alternative to Dolphin's .v originals).
      const folder = timepointFolderName(tpName, tpDate);
      if (folder) {
        for (const t of toTag) {
          try {
            await tagOriginalForView(Number(personId), folder, t.sourceRelPath, t.view);
          } catch (err) {
            log.warn('[PhotoEditor] tag original failed', { view: t.view, error: (err as Error).message });
          }
        }
      }

      log.info('[PhotoEditor] render complete', {
        userId: req.session?.userId,
        personId,
        tpCode,
        written: written.length,
        warnings: warnings.length,
      });
      sendSuccess(res, { written, warnings: warnings.length ? warnings : undefined });
    } catch (err) {
      log.error('[PhotoEditor] render failed', { error: (err as Error).message });
      ErrorResponses.internalError(res, 'Failed to render photos', err as Error);
    }
  }
);

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
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { tpCode, tpName, tpDate, view } = req.body as {
        tpCode?: number | string;
        tpName?: string;
        tpDate?: string;
        view?: string;
      };

      if (!/^\d+$/.test(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (tpCode === undefined || !/^\d+$/.test(String(tpCode))) {
        ErrorResponses.badRequest(res, 'Invalid tpCode');
        return;
      }
      if (typeof view !== 'string' || !/^i(10|12|13|20|21|22|23|24)$/.test(view)) {
        ErrorResponses.badRequest(res, 'Invalid view code');
        return;
      }
      const tpCodeNum = Number(tpCode);

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
        tpCode: tpCodeNum,
        view,
      });
      sendSuccess(res, { removed: view });
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
router.get('/:personId/photo-dates', async (req: Request, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;
    if (!/^\d+$/.test(personId)) {
      ErrorResponses.badRequest(res, 'Invalid patient id');
      return;
    }
    const [appointments, visits] = await Promise.all([
      getPhotoSessionAppointments(personId),
      getPhotoSessionVisits(personId),
    ]);
    res.json({ appointments, visits });
  } catch (err) {
    log.error('[PhotoEditor] photo-dates failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to fetch photo dates', err as Error);
  }
});

export default router;
