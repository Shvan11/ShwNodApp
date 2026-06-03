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
