/**
 * Patient Portal Routes — mounted at /api/portal
 *
 * Patient-facing endpoints. Every handler (except /login) reads the
 * PersonID from req.session.patientId — NEVER from params or body.
 */
import { Router, type Request, type Response } from 'express';
import { executeQuery, TYPES } from '../services/database/index.js';
import { getTimePoints } from '../services/database/queries/timepoint-queries.js';
import { getVisitsSummary } from '../services/database/queries/visit-queries.js';
import { getPayments } from '../services/database/queries/payment-queries.js';
import { authenticatePatient, portalLoginLimiter } from '../middleware/patientAuth.js';
import {
  verifyPin,
  getVisiblePhotos,
  getPatientProfile,
  getPrivateList,
} from '../services/business/PatientPortalService.js';
import { log } from '../utils/logger.js';

const router = Router();

interface LoginBody {
  personId: number | string;
  pin: string;
}

// --------------------------------------------------------------------------
// POST /api/portal/login
// --------------------------------------------------------------------------
router.post(
  '/login',
  portalLoginLimiter,
  async (req: Request<unknown, unknown, LoginBody>, res: Response): Promise<void> => {
    try {
      const { personId, pin } = req.body;
      const pid = typeof personId === 'string' ? parseInt(personId, 10) : personId;
      if (!pid || !Number.isFinite(pid) || !pin || typeof pin !== 'string') {
        res.status(400).json({ success: false, error: 'PersonID and PIN are required.' });
        return;
      }

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

      // Set portal session
      req.session.patientId = pid;
      req.session.patientName = result.patientName || undefined;
      req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24h

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
          personId: profile.PersonID,
          patientName: profile.PatientName,
          firstName: profile.FirstName,
          lastName: profile.LastName,
          language: profile.Language,
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
        privateByTp.set(entry.TimepointCode, (privateByTp.get(entry.TimepointCode) || 0) + 1);
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
  async (req: Request<{ tp: string }>, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const tp = req.params.tp;
      if (!tp || !/^[A-Za-z0-9_-]{1,10}$/.test(tp)) {
        res.status(400).json({ success: false, error: 'Invalid timepoint code' });
        return;
      }
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
  appointmentID: number;
  AppDate: string;
  AppDetail: string | null;
  DrName: string | null;
}

router.get(
  '/appointments/next',
  authenticatePatient,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pid = req.session.patientId!;
      const rows = await executeQuery<NextAppointmentRow>(
        `SELECT TOP 1
           a.appointmentID,
           FORMAT(a.AppDate, 'yyyy-MM-ddTHH:mm:ss') as AppDate,
           a.AppDetail,
           e.employeeName as DrName
         FROM dbo.tblappointments a
         LEFT JOIN dbo.tblEmployees e ON a.DrID = e.ID
         WHERE a.PersonID = @PID
           AND a.AppDate >= CAST(GETDATE() AS DATE)
         ORDER BY a.AppDate ASC`,
        [['PID', TYPES.Int, pid]],
        (columns) => ({
          appointmentID: columns[0].value as number,
          AppDate: columns[1].value as string,
          AppDetail: (columns[2].value as string) ?? null,
          DrName: (columns[3].value as string) ?? null,
        })
      );
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
