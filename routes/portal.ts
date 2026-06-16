/**
 * Patient Portal Routes — mounted at /api/portal
 *
 * Patient-facing endpoints. Every handler (except /login) reads the
 * person_id from req.session.patientId — NEVER from params or body.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { getTimePoints } from '../services/database/queries/timepoint-queries.js';
import { getVisitsSummary } from '../services/database/queries/visit-queries.js';
import { getPayments } from '../services/database/queries/payment-queries.js';
import { authenticatePatient, portalLoginLimiter } from '../middleware/patientAuth.js';
import { validate } from '../middleware/validate.js';
import {
  verifyPin,
  getVisiblePhotos,
  getPatientProfile,
  getPrivateList,
} from '../services/business/PatientPortalService.js';
import { workingFilePath } from '../services/files/clinic-paths.js';
import { getWorkingThumbnail } from '../services/files/thumbnail.service.js';
import { log } from '../utils/logger.js';

const router = Router();

// Boundary schemas — the source of truth for these handlers' input types.
const loginSchema = z.object({
  personId: z.coerce.number().int().positive(),
  pin: z.string().min(1),
});
type LoginBody = z.infer<typeof loginSchema>;

const photosParamsSchema = z.object({
  tp: z.string().regex(/^[A-Za-z0-9_-]{1,10}$/, 'Invalid timepoint code'),
});

// Image-file params for the per-patient photo stream. `name` is the bare Dolphin
// working-dir filename (`{personId}0{tp}.{view}`, e.g. `688201.i12`); the regex
// forbids path separators so it can never traverse. The real authorization
// boundary, though, is the getVisiblePhotos membership check in the handler —
// a name only streams if it's one of THIS patient's non-private photos.
const photoFileParamsSchema = z.object({
  tp: z.string().regex(/^[A-Za-z0-9_-]{1,10}$/, 'Invalid timepoint code'),
  name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'Invalid image name'),
});

// `?size=thumb` → small disk-cached WebP for the grid; default (no/`full`) →
// the full-res original for the lightbox / download / share.
const photoFileQuerySchema = z.object({
  size: z.enum(['thumb', 'full']).optional(),
});

// Grid thumbnail width — must be one of thumbnail.service's ALLOWED_WIDTHS, and
// matches the staff GridComponent's 480px grid thumb so both share one cache.
const PORTAL_THUMB_WIDTH = 480;

// --------------------------------------------------------------------------
// POST /api/portal/login
// --------------------------------------------------------------------------
router.post(
  '/login',
  portalLoginLimiter,
  validate({ body: loginSchema }),
  async (req: Request<unknown, unknown, LoginBody>, res: Response): Promise<void> => {
    try {
      // Validated + coerced by middleware: personId is a positive int, pin a non-empty string.
      const { personId: pid, pin } = req.body;

      const result = await verifyPin(pid, pin);
      if (!result.ok) {
        // Collapse all non-lockout failures to a generic message to prevent
        // account enumeration ("no such patient" vs "wrong PIN" vs "disabled").
        const clientError = result.lockedUntil ? result.error : 'Invalid credentials';
        res.status(401).json({
          success: false,
          error: clientError,
          lockedUntil: result.lockedUntil ?? undefined,
        });
        return;
      }

      // Regenerate the session id on login to prevent session fixation — a
      // pre-auth session id must not carry over into the authenticated session.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      // Set portal session
      req.session.patientId = pid;
      req.session.patientName = result.patientName || undefined;
      req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24h

      // Persist the regenerated, populated session before responding.
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      res.json({
        success: true,
        patientName: result.patientName,
        language: result.language,
      });
    } catch (error) {
      log.error('Portal login error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
  }
);

// --------------------------------------------------------------------------
// POST /api/portal/logout
// --------------------------------------------------------------------------
router.post('/logout', authenticatePatient, (req: Request, res: Response): void => {
  req.session.destroy((err) => {
    if (err) {
      log.error('Portal logout error', { error: err.message });
      res.status(500).json({ success: false, error: 'Logout failed' });
      return;
    }
    res.clearCookie('shwan.portal');
    res.json({ success: true });
  });
});

// --------------------------------------------------------------------------
// GET /api/portal/me
// --------------------------------------------------------------------------
router.get(
  '/me',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const profile = await getPatientProfile(pid);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Patient not found' });
        return;
      }
      res.json({
        success: true,
        patient: {
          personId: profile.person_id,
          patientName: profile.patient_name,
          firstName: profile.first_name,
          lastName: profile.last_name,
          language: profile.language,
        },
      });
    } catch (error) {
      log.error('Portal /me error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load profile' });
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/timepoints
//
// Returns only timepoints that still have ≥1 non-private photo.
// --------------------------------------------------------------------------
router.get(
  '/timepoints',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const allTps = await getTimePoints(String(pid));
      const privateList = await getPrivateList(pid);

      // Count private photos per timepoint
      const privateByTp = new Map<string, number>();
      for (const entry of privateList) {
        privateByTp.set(entry.timepoint_code, (privateByTp.get(entry.timepoint_code) || 0) + 1);
      }

      // Filter timepoints: need at least one visible (non-private) photo
      // We can't know exact counts without scanning the filesystem, so we
      // just return all timepoints and let the photos endpoint return [].
      // The frontend hides tabs with empty photo lists.
      res.json({ success: true, timepoints: allTps });
    } catch (error) {
      log.error('Portal /timepoints error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load timepoints' });
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/photos/:tp
// --------------------------------------------------------------------------
router.get(
  '/photos/:tp',
  authenticatePatient,
  validate({ params: photosParamsSchema }),
  async (req: Request<{ tp: string }>, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const tp = req.params.tp; // validated against /^[A-Za-z0-9_-]{1,10}$/ by middleware
      const photos = await getVisiblePhotos(pid, tp);
      res.json({ success: true, photos });
    } catch (error) {
      log.error('Portal /photos error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load photos' });
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/photos/:tp/:name[?size=thumb]  — stream a single image
//
// The staff gallery serves these bytes from the `/DolImgs` static mount, but
// that mount sits behind staff-only `authenticateWeb` (it requires a staff
// session `userId`). A patient-portal browser has only the `shwan.portal`
// session, so `/DolImgs/...` redirects it to /login.html and the <img> renders
// blank. This route is the portal's own authenticated image source: it runs
// under the portal session and only streams a file that getVisiblePhotos
// confirms is one of THIS patient's non-private photos at this timepoint.
//
// `?size=thumb` returns a 480px disk-cached WebP for the grid (the originals are
// 13–18 MP / 2–4 MB JPEGs — far too heavy to load by the gridful over the remote
// tunnel, and big enough to blank out under iOS Safari's image-memory limit).
// The default (lightbox / download / share) streams the full-res original. This
// mirrors the staff GridComponent's thumb-grid / full-on-click split and reuses
// the same getWorkingThumbnail cache (namespaced working/{personId}/{name}-{mtime}).
// --------------------------------------------------------------------------
router.get(
  '/photos/:tp/:name',
  authenticatePatient,
  validate({ params: photoFileParamsSchema, query: photoFileQuerySchema }),
  async (
    req: Request<{ tp: string; name: string }, unknown, unknown, { size?: 'thumb' | 'full' }>,
    res: Response
  ): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const { tp, name } = req.params;

      // Authorization boundary: the patient may only fetch a photo that is
      // visible (non-private) AND belongs to this timepoint of THEIR record.
      // getVisiblePhotos is scoped to (pid, tp) and excludes private photos,
      // and its entries are confirmed to exist on disk (with mtime for the cache key).
      const visible = await getVisiblePhotos(pid, tp);
      const match = visible.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        res.status(404).end();
        return;
      }

      const abs = workingFilePath(match.name);

      // ── Grid thumbnail branch ── small WebP, generated once + disk-cached.
      // `no-cache` re-runs the visibility check above on every view so a later
      // privacy toggle is honoured (304 when unchanged keeps revalidation cheap).
      if (req.query.size === 'thumb') {
        const thumbPath = await getWorkingThumbnail(pid, match.name, abs, match.mtime, PORTAL_THUMB_WIDTH);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'private, no-cache');
        res.sendFile(thumbPath, { dotfiles: 'allow', cacheControl: false, lastModified: true }, (err) => {
          if (err && !res.headersSent) res.status(404).end();
        });
        return;
      }

      // ── Full-res branch (lightbox / download / share) ── stream the original.
      // `.iNN` view files are JPEG but carry a non-standard extension, so set the
      // type explicitly (mirrors the /DolImgs mount) — iOS Safari refuses to render
      // a wrong/octet-stream type.
      res.sendFile(
        abs,
        {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'private, no-cache',
          },
        },
        (err) => {
          if (err && !res.headersSent) {
            res.status(404).end();
          }
        }
      );
    } catch (error) {
      log.error('Portal /photos/:tp/:name error', { error: (error as Error).message });
      if (!res.headersSent) res.status(500).end();
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/visits
// --------------------------------------------------------------------------
router.get(
  '/visits',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const visits = await getVisitsSummary(pid);
      res.json({ success: true, visits });
    } catch (error) {
      log.error('Portal /visits error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load visits' });
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/appointments/next
// --------------------------------------------------------------------------
interface NextAppointmentRow {
  appointment_id: number;
  app_date: string;
  app_detail: string | null;
  DrName: string | null;
}

router.get(
  '/appointments/next',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const db = getKysely();
      const { rows } = await sql<NextAppointmentRow>`
        SELECT
           a."appointment_id",
           to_char(a."app_date", 'YYYY-MM-DD"T"HH24:MI:SS') AS "app_date",
           a."app_detail",
           e."employee_name" AS "DrName"
         FROM "appointments" a
         LEFT JOIN "employees" e ON a."dr_id" = e."id"
         WHERE a."person_id" = ${pid}
           AND a."app_date" >= CURRENT_DATE
         ORDER BY a."app_date" ASC
         LIMIT 1`.execute(db);
      res.json({ success: true, appointment: rows[0] ?? null });
    } catch (error) {
      log.error('Portal /appointments/next error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load next appointment' });
    }
  }
);

// --------------------------------------------------------------------------
// GET /api/portal/payments
// --------------------------------------------------------------------------
router.get(
  '/payments',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const payments = await getPayments(pid);
      res.json({ success: true, payments });
    } catch (error) {
      log.error('Portal /payments error', { error: (error as Error).message });
      res.status(500).json({ success: false, error: 'Failed to load payments' });
    }
  }
);

export default router;
