/**
 * Dolphin Imaging Routes
 *
 * This module handles Dolphin Imaging integration endpoints:
 * - Photo import preparation (patient/timepoint creation)
 * - Patient existence check
 * - Photo date retrieval for date selection
 */

import { Router, type Request, type Response } from 'express';
import {
  checkDolphinPatient,
  createDolphinPatient,
  checkTimePoint,
  createTimePoint,
  getPatientForDolphin,
  getAppointmentsForDolphin,
  getVisitsForDolphin
} from '../../services/database/queries/dolphin-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

/**
 * Request body for prepare-photo-import
 */
interface PreparePhotoImportBody {
  personId: number;
  tpDescription: string;
  tpDate: string;
  skipDolphin?: boolean;
}

/**
 * Route params for person ID
 */
interface PersonIdParams {
  personId: string;
}

/**
 * SQL error with number property
 */
interface SqlError extends Error {
  number?: number;
}

/**
 * POST /prepare-photo-import
 * Prepares Dolphin for photo import by ensuring patient and timepoint exist
 * Creates patient in DolphinPlatform if not exists
 * Creates timepoint if not exists
 * Returns protocol URL for launching the handler
 *
 * Body: { personId, tpDescription, tpDate, skipDolphin }
 */
router.post('/prepare-photo-import', async (req: Request<object, object, PreparePhotoImportBody>, res: Response): Promise<void> => {
  try {
    const { personId, tpDescription, tpDate, skipDolphin } = req.body;

    if (!personId || !tpDescription || !tpDate) {
      ErrorResponses.badRequest(res, 'Missing required fields: personId, tpDescription, tpDate');
      return;
    }

    // Convert personId to string for query functions
    const personIdStr = String(personId);

    // Get patient info from ShwanNew
    const patient = await getPatientForDolphin(personIdStr);
    if (!patient) {
      ErrorResponses.notFound(res, 'Patient');
      return;
    }

    // Validate required fields
    if (!patient.firstName || !patient.dob || !patient.gender) {
      ErrorResponses.badRequest(res, 'Patient missing required fields: FirstName, DateOfBirth, or Gender');
      return;
    }

    // Check if patient exists in DolphinPlatform
    const existsInDolphin = await checkDolphinPatient(personIdStr);

    // Create patient in DolphinPlatform if not exists
    if (!existsInDolphin) {
      // Convert numeric gender to string: 1 = 'M', 2 = 'F', else 'U'
      const genderStr = patient.gender === 1 ? 'M' : patient.gender === 2 ? 'F' : 'U';
      await createDolphinPatient(
        patient.firstName,
        patient.lastName || '',
        patient.dob,
        personIdStr,
        genderStr
      );
      log.info(`Created patient ${personId} in DolphinPlatform`);
    }

    // Parse the date
    const parsedDate = new Date(tpDate);

    // Check if timepoint exists
    let tpCode = await checkTimePoint(personIdStr, tpDescription, parsedDate);

    // Create timepoint if not exists
    if (tpCode === -1) {
      tpCode = await createTimePoint(personIdStr, tpDescription, parsedDate);
      log.info(`Created timepoint ${tpCode} for patient ${personId}`);
    }

    // Format date as YYYYMMDD for protocol URL
    const dateStr = parsedDate.toISOString().slice(0, 10).replace(/-/g, '');

    // Build protocol URL
    const protocolUrl = `dolphin:${personId}?action=photos&tp=${tpCode}&date=${dateStr}&skip=${skipDolphin ? 1 : 0}`;

    res.json({
      success: true,
      protocolUrl,
      tpCode,
      patientCreated: !existsInDolphin
    });
  } catch (error) {
    log.error('Error preparing photo import:', error);

    const sqlError = error as SqlError;
    // Handle specific SQL error for timepoint conflict
    if (sqlError.number === 51000) {
      ErrorResponses.badRequest(res, 'Timepoint date conflict: a different date exists for this timepoint type');
      return;
    }

    ErrorResponses.internalError(res, 'Failed to prepare photo import', error as Error);
  }
});

/**
 * GET /check-patient/:personId
 * Quick check if patient exists in DolphinPlatform
 */
router.get('/check-patient/:personId', async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;

    const exists = await checkDolphinPatient(personId);
    res.json({ exists: !!exists });
  } catch (error) {
    log.error('Error checking Dolphin patient:', error);
    ErrorResponses.internalError(res, 'Failed to check patient', error as Error);
  }
});

/**
 * GET /photo-dates/:personId
 * Get appointments and visits for date selection in photo import dialog
 */
router.get('/photo-dates/:personId', async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;

    const [appointments, visits] = await Promise.all([
      getAppointmentsForDolphin(personId),
      getVisitsForDolphin(personId)
    ]);

    res.json({ appointments, visits });
  } catch (error) {
    log.error('Error fetching photo dates:', error);
    ErrorResponses.internalError(res, 'Failed to fetch photo dates', error as Error);
  }
});

export default router;
