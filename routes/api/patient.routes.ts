/**
 * Patient Management API Routes
 *
 * This module handles all patient-related API endpoints including:
 * - Patient information retrieval
 * - Time points and imaging
 * - QR code generation
 * - Patient CRUD operations (create, read, update, delete)
 * - Patient search and phone number retrieval
 * - Patient folder settings
 * - Patient load/unload events for desktop application integration
 */

import { Router, type Request, type Response } from 'express';
import type { EventEmitter } from 'events';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import {
  getPatientsPhones,
  createPatient,
  getPatientById,
  updatePatient,
  deletePatient,
  hasNextAppointment
} from '../../services/database/queries/patient-queries.js';
import {
  getAlertsByPersonId,
  createAlert,
  setAlertStatus,
  updateAlert
} from '../../services/database/queries/alert-queries.js';
import * as imaging from '../../services/imaging/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  requireRecordAge,
  getPatientCreationDate
} from '../../middleware/time-based-auth.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
import * as PatientService from '../../services/business/PatientService.js';
import { PatientValidationError } from '../../services/business/PatientService.js';
import type { PatientSearchQuery } from '../../types/api.types.js';

const router = Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter: EventEmitter | null = null;

/**
 * Set the WebSocket emitter reference
 */
export function setWebSocketEmitter(emitter: EventEmitter): void {
  wsEmitter = emitter;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PatientSearchResult {
  PersonID: number;
  PatientName: string;
  FirstName: string | null;
  LastName: string | null;
  Phone: string | null;
  Phone2: string | null;
  Email: string | null;
  DateofBirth: Date | null;
  Gender: number | null;
  AddressID: number | null;
  ReferralSourceID: number | null;
  PatientTypeID: number | null;
  TagID: number | null;
  Notes: string | null;
  Language: string | null;
  CountryCode: string | null;
  EstimatedCost: number | null;
  Currency: string | null;
  DateAdded: Date | null;
  GenderName: string | null;
  AddressName: string | null;
  ReferralSource: string | null;
  PatientTypeName: string | null;
  TagName: string | null;
  ActiveWorkTypes: string | null;
}

interface CreatePatientBody {
  patientName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: number;
  addressID?: number;
  referralSourceID?: number;
  patientTypeID?: number;
  tagID?: number;
  notes?: string;
  language?: string;
  countryCode?: string;
  estimatedCost?: number;
  currency?: string;
}

interface UpdatePatientBody {
  PatientName: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Phone2?: string;
  Email?: string;
  DateofBirth?: string;
  Gender?: number;
  AddressID?: number;
  ReferralSourceID?: number;
  PatientTypeID?: number;
  TagID?: number;
  Notes?: string;
  Language?: string;
  CountryCode?: string;
  EstimatedCost?: number;
  Currency?: string;
}

interface CreateAlertBody {
  alertTypeId: string | number;
  alertSeverity: string | number;
  alertDetails: string;
}

interface UpdateAlertStatusBody {
  isActive: boolean;
}

interface UpdateAlertBody {
  alertTypeId: number;
  alertSeverity: number;
  alertDetails: string;
}

interface TagOption {
  id: number;
  tag: string;
}

// ============================================================================
// PATIENT INFORMATION ROUTES
// ============================================================================

/**
 * Get patient information
 * GET /patients/:personId/info
 */
router.get(
  '/patients/:personId/info',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const info = await PatientService.getPatientInfo(personId);
      res.json(info);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching patient info:', error);
      res.status(500).json({
        error: 'Failed to fetch patient information',
        message: (error as Error).message
      });
    }
  }
);

/**
 * Get PatientsFolder setting from tbloptions
 * GET /settings/patients-folder
 */
router.get(
  '/settings/patients-folder',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const patientsFolder = await getOption('PatientsFolder');
      res.json({ patientsFolder: patientsFolder || '' });
    } catch (error) {
      log.error('Error fetching PatientsFolder setting:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch PatientsFolder setting',
        error as Error
      );
    }
  }
);

// ============================================================================
// TIME POINTS AND IMAGING ROUTES
// ============================================================================

/**
 * Get time points for a patient
 * GET /patients/:personId/timepoints
 */
router.get(
  '/patients/:personId/timepoints',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const timepoints = await PatientService.getPatientTimePoints(personId);
      res.json(timepoints);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching time points:', error);
      res.status(500).json({
        error: 'Failed to fetch time points',
        message: (error as Error).message
      });
    }
  }
);

/**
 * Get time point images for a patient
 * GET /patients/:personId/timepoints/:tp/images
 */
router.get(
  '/patients/:personId/timepoints/:tp/images',
  async (
    req: Request<{ personId: string; tp: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId, tp } = req.params;
      const timepointimgs = await PatientService.getPatientTimePointImages(
        personId,
        tp
      );
      res.json(timepointimgs);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching time point images:', error);
      res.status(500).json({
        error: 'Failed to fetch time point images',
        message: (error as Error).message
      });
    }
  }
);

/**
 * Generate and get QR code for a patient
 * GET /patients/:personId/qrcode
 */
router.get(
  '/patients/:personId/qrcode',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    const { personId } = req.params;
    await imaging.generateQRCode(personId);
    res.json({ OK: 'OK' });
  }
);

/**
 * Get gallery images for a patient
 * GET /patients/:personId/gallery/:tp
 */
router.get(
  '/patients/:personId/gallery/:tp',
  async (
    req: Request<{ personId: string; tp: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId, tp } = req.params;
      const images = await imaging.getImageSizes(personId, tp);
      res.json(images);
    } catch (error) {
      log.error('Error getting gallery images:', error);
      ErrorResponses.internalError(res, 'Failed to load gallery images', {
        message: (error as Error).message
      });
    }
  }
);

/**
 * Get and process X-ray image
 * GET /patients/:personId/xray?file={filename}&detailsDir={directory}
 */
router.get(
  '/patients/:personId/xray',
  async (
    req: Request<{ personId: string }, unknown, unknown, { file?: string; detailsDir?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const { file, detailsDir } = req.query;

      if (!file) {
        log.warn('X-ray request missing file parameter', { personId });
        ErrorResponses.badRequest(
          res,
          'Missing required parameter: file'
        );
        return;
      }

      const imagePath = await imaging.processXrayImage(
        personId,
        file,
        detailsDir || ''
      );
      res.sendFile(imagePath);
    } catch (error) {
      log.error('Error processing X-ray:', error);
      ErrorResponses.internalError(res, 'X-ray processing failed', {
        message: (error as Error).message,
        note: 'X-ray processing tool may not be available in this environment'
      });
    }
  }
);

// ============================================================================
// PATIENT LOAD/UNLOAD EVENTS
// ============================================================================

/**
 * Handle patient loaded event from desktop application
 * GET /patients/events/loaded?pid={personId}&screenid={screenId}
 */
router.get(
  '/patients/events/loaded',
  (
    req: Request<unknown, unknown, unknown, { pid?: string; screenid?: string }>,
    res: Response
  ): void => {
    res.sendStatus(200);
    const { pid, screenid: screenID } = req.query;
    log.info(`PatientLoaded called with pid: ${pid}, screenID: ${screenID}`);

    // Emit universal event only
    if (wsEmitter) {
      wsEmitter.emit(WebSocketEvents.PATIENT_LOADED, pid, screenID);
    }
  }
);

/**
 * Handle patient unloaded event from desktop application
 * GET /patients/events/unloaded?screenid={screenId}
 */
router.get(
  '/patients/events/unloaded',
  (
    req: Request<unknown, unknown, unknown, { screenid?: string }>,
    res: Response
  ): void => {
    res.sendStatus(200);
    const { screenid: screenID } = req.query;
    log.info(`PatientUnloaded called with screenID: ${screenID}`);

    // Emit universal event only
    if (wsEmitter) {
      wsEmitter.emit(WebSocketEvents.PATIENT_UNLOADED, screenID);
    }
  }
);

// ============================================================================
// PATIENT PHONE NUMBERS
// ============================================================================

/**
 * Get all patient phone numbers
 * GET /patients/phones
 */
router.get(
  '/patients/phones',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const phonesList = await getPatientsPhones();
      res.json(phonesList);
    } catch (error) {
      log.error('Error fetching patients phones:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patients phones',
        error as Error
      );
    }
  }
);

// ============================================================================
// PATIENT SEARCH
// ============================================================================

/**
 * Search patients by name, phone, ID, work type, keywords, and tags
 * GET /patients/search?q={query}&patientName={name}&firstName={first}&lastName={last}&workTypes={ids}&keywords={ids}&tags={ids}
 */
router.get(
  '/patients/search',
  async (
    req: Request<unknown, unknown, unknown, PatientSearchQuery & { q?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const searchQuery = req.query.q || '';
      const patientName = req.query.patientName || '';
      const firstName = req.query.firstName || '';
      const lastName = req.query.lastName || '';
      const workTypesParam = req.query.workTypes || '';
      const keywordsParam = req.query.keywords || '';
      const tagsParam = req.query.tags || '';

      const sortBy = req.query.sortBy || 'name';
      const order = req.query.order || 'asc';

      // Parse comma-separated IDs into arrays
      const workTypeIds = workTypesParam
        ? workTypesParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];
      const keywordIds = keywordsParam
        ? keywordsParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];
      const tagIds = tagsParam
        ? tagsParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];

      // Build WHERE clause for search
      const whereConditions: string[] = [];
      const parameters: database.SqlParam[] = [];

      // Search by individual name fields
      if (patientName.trim()) {
        whereConditions.push('p.PatientName LIKE @patientName');
        parameters.push([
          'patientName',
          database.TYPES.NVarChar,
          `%${patientName.trim()}%`
        ]);
      }

      if (firstName.trim()) {
        whereConditions.push('p.FirstName LIKE @firstName');
        parameters.push([
          'firstName',
          database.TYPES.NVarChar,
          `%${firstName.trim()}%`
        ]);
      }

      if (lastName.trim()) {
        whereConditions.push('p.LastName LIKE @lastName');
        parameters.push([
          'lastName',
          database.TYPES.NVarChar,
          `%${lastName.trim()}%`
        ]);
      }

      // General search (phone or ID)
      if (searchQuery.trim()) {
        whereConditions.push(
          '(p.Phone LIKE @search OR p.Phone2 LIKE @search)'
        );
        parameters.push([
          'search',
          database.TYPES.NVarChar,
          `%${searchQuery.trim()}%`
        ]);
      }

      // Filter by work types (ANY work, past or current)
      if (workTypeIds.length > 0) {
        const workTypePlaceholders = workTypeIds
          .map((_, idx) => `@workType${idx}`)
          .join(',');
        whereConditions.push(`EXISTS (
                SELECT 1 FROM dbo.tblwork w
                WHERE w.PersonID = p.PersonID
                AND w.Typeofwork IN (${workTypePlaceholders})
            )`);
        workTypeIds.forEach((id, idx) => {
          parameters.push([`workType${idx}`, database.TYPES.Int, id]);
        });
      }

      // Filter by keywords (check all 5 keyword columns)
      if (keywordIds.length > 0) {
        const keywordPlaceholders = keywordIds
          .map((_, idx) => `@keyword${idx}`)
          .join(',');
        whereConditions.push(`EXISTS (
                SELECT 1 FROM dbo.tblwork w
                WHERE w.PersonID = p.PersonID
                AND (
                    w.KeyWordID1 IN (${keywordPlaceholders})
                    OR w.KeyWordID2 IN (${keywordPlaceholders})
                    OR w.KeywordID3 IN (${keywordPlaceholders})
                    OR w.KeywordID4 IN (${keywordPlaceholders})
                    OR w.KeywordID5 IN (${keywordPlaceholders})
                )
            )`);
        keywordIds.forEach((id, idx) => {
          parameters.push([`keyword${idx}`, database.TYPES.Int, id]);
        });
      }

      // Filter by patient tags
      if (tagIds.length > 0) {
        const tagPlaceholders = tagIds
          .map((_, idx) => `@tag${idx}`)
          .join(',');
        whereConditions.push(`p.TagID IN (${tagPlaceholders})`);
        tagIds.forEach((id, idx) => {
          parameters.push([`tag${idx}`, database.TYPES.Int, id]);
        });
      }

      const whereClause =
        whereConditions.length > 0
          ? 'WHERE ' + whereConditions.join(' AND ')
          : '';

      // Determine ORDER BY clause
      let orderByClause = 'ORDER BY p.PatientName ASC';
      if (sortBy === 'date') {
        orderByClause =
          order === 'desc'
            ? 'ORDER BY p.DateAdded DESC'
            : 'ORDER BY p.DateAdded ASC';
      } else {
        orderByClause =
          order === 'desc'
            ? 'ORDER BY p.PatientName DESC'
            : 'ORDER BY p.PatientName ASC';
      }

      const query = `
            SELECT DISTINCT TOP 100
                    p.PersonID, p.PatientName, p.FirstName, p.LastName,
                    p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                    p.AddressID, p.ReferralSourceID, p.PatientTypeID, p.TagID,
                    p.Notes, p.Language, p.CountryCode,
                    p.EstimatedCost, p.Currency, p.DateAdded,
                    g.Gender as GenderName, a.Zone as AddressName,
                    r.Referral as ReferralSource, pt.PatientType as PatientTypeName,
                    tag.Tag as TagName,
                    (
                        SELECT STRING_AGG(wt.WorkType, ', ')
                        FROM (
                            SELECT DISTINCT wt2.WorkType
                            FROM dbo.tblwork w2
                            INNER JOIN dbo.tblWorkType wt2 ON w2.Typeofwork = wt2.ID
                            WHERE w2.PersonID = p.PersonID AND w2.Status = 1
                        ) wt
                    ) as ActiveWorkTypes
            FROM dbo.tblpatients p
            LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
            LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
            LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
            LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
            LEFT JOIN dbo.tblTagOptions tag ON p.TagID = tag.ID
            ${whereClause}
            ${orderByClause}
        `;

      const patients = await database.executeQuery<PatientSearchResult>(
        query,
        parameters,
        (columns) => ({
          PersonID: columns[0].value as number,
          PatientName: columns[1].value as string,
          FirstName: columns[2].value as string | null,
          LastName: columns[3].value as string | null,
          Phone: columns[4].value as string | null,
          Phone2: columns[5].value as string | null,
          Email: columns[6].value as string | null,
          DateofBirth: columns[7].value as Date | null,
          Gender: columns[8].value as number | null,
          AddressID: columns[9].value as number | null,
          ReferralSourceID: columns[10].value as number | null,
          PatientTypeID: columns[11].value as number | null,
          TagID: columns[12].value as number | null,
          Notes: columns[13].value as string | null,
          Language: columns[14].value as string | null,
          CountryCode: columns[15].value as string | null,
          EstimatedCost: columns[16].value as number | null,
          Currency: columns[17].value as string | null,
          DateAdded: columns[18].value as Date | null,
          GenderName: columns[19].value as string | null,
          AddressName: columns[20].value as string | null,
          ReferralSource: columns[21].value as string | null,
          PatientTypeName: columns[22].value as string | null,
          TagName: columns[23].value as string | null,
          ActiveWorkTypes: columns[24].value as string | null
        })
      );

      res.json(patients);
    } catch (error) {
      log.error('Error searching patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to search patients',
        error as Error
      );
    }
  }
);

// ============================================================================
// PATIENT CRUD OPERATIONS
// ============================================================================

/**
 * Get single patient by ID with alerts
 * GET /patients/:personId
 */
router.get(
  '/patients/:personId',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      if (!personId) {
        log.warn('Get patient request missing personId');
        ErrorResponses.missingParameter(res, 'personId');
        return;
      }

      const parsedId = parseInt(personId, 10);
      if (isNaN(parsedId)) {
        log.warn('Get patient request invalid personId', { personId });
        ErrorResponses.badRequest(res, 'Invalid personId: must be a number');
        return;
      }

      const patient = await getPatientById(parsedId);

      if (!patient) {
        log.warn('Patient not found', { personId: parsedId });
        ErrorResponses.notFound(res, 'Patient');
        return;
      }

      // Fetch and attach alerts
      const alerts = await getAlertsByPersonId(patient.PersonID);
      const patientWithAlerts = patient as typeof patient & { alerts: typeof alerts };
      patientWithAlerts.alerts = alerts;

      res.json(patientWithAlerts);
    } catch (error) {
      log.error('Error fetching patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patient',
        error as Error
      );
    }
  }
);

/**
 * Create new patient
 * POST /patients
 */
router.post(
  '/patients',
  async (
    req: Request<unknown, unknown, CreatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      // Basic validation
      if (!patientData.patientName || !patientData.patientName.trim()) {
        log.warn('Create patient missing name');
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // Trim string values and prepare data for createPatient
      const processedData: {
        patientName: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        phone2?: string;
        email?: string;
        dateOfBirth?: Date;
        gender?: number;
        addressID?: number;
        referralSourceID?: number;
        patientTypeID?: number;
        tagID?: number;
        notes?: string;
        language?: string;
        countryCode?: string;
        estimatedCost?: number;
        currency?: string;
      } = {
        patientName: patientData.patientName.trim(),
        firstName: patientData.firstName?.trim() || undefined,
        lastName: patientData.lastName?.trim() || undefined,
        phone: patientData.phone?.trim() || undefined,
        phone2: patientData.phone2?.trim() || undefined,
        email: patientData.email?.trim() || undefined,
        dateOfBirth: patientData.dateOfBirth
          ? new Date(patientData.dateOfBirth)
          : undefined,
        gender: patientData.gender,
        addressID: patientData.addressID,
        referralSourceID: patientData.referralSourceID,
        patientTypeID: patientData.patientTypeID,
        tagID: patientData.tagID,
        notes: patientData.notes?.trim() || undefined,
        language: patientData.language?.trim() || undefined,
        countryCode: patientData.countryCode?.trim() || undefined,
        estimatedCost: patientData.estimatedCost,
        currency: patientData.currency?.trim() || undefined
      };

      // Create the patient
      const result = await createPatient(processedData);

      res.json({
        success: true,
        personId: result.personId,
        message: 'Patient created successfully'
      });
    } catch (error) {
      // Handle duplicate patient name error
      const err = error as Error & {
        code?: string;
        existingPatientId?: number;
      };
      if (err.code === 'DUPLICATE_PATIENT_NAME') {
        log.warn(`Duplicate patient name attempted: ${patientData.patientName}`);
        res.status(409).json({
          success: false,
          error: err.message,
          code: 'DUPLICATE_PATIENT_NAME',
          existingPatientId: err.existingPatientId
        });
        return;
      }

      log.error('Error creating patient', { error });
      ErrorResponses.internalError(
        res,
        'Failed to create patient',
        error as Error
      );
    }
  }
);

/**
 * Update patient
 * PUT /patients/:personId
 */
router.put(
  '/patients/:personId',
  async (
    req: Request<{ personId: string }, unknown, UpdatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      const personId = parseInt(req.params.personId);

      // Basic validation
      if (!patientData.PatientName || !patientData.PatientName.trim()) {
        log.warn('Update patient missing name', { personId });
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // Convert date string to Date object for the database layer
      const updateData = {
        ...patientData,
        DateofBirth: patientData.DateofBirth
          ? new Date(patientData.DateofBirth)
          : undefined
      };

      await updatePatient(personId, updateData);
      res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
      // Handle duplicate patient name error (SQL Server error 2601 for unique index violation)
      const err = error as Error & { number?: number };
      if (
        err.number === 2601 ||
        (err.message && err.message.includes('IX_Name_ID'))
      ) {
        log.warn(
          `Duplicate patient name attempted during update: ${patientData.PatientName}`
        );
        res.status(409).json({
          success: false,
          error: 'A patient with this name already exists',
          code: 'DUPLICATE_PATIENT_NAME',
          duplicateName: patientData.PatientName
        });
        return;
      }

      log.error('Error updating patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update patient',
        error as Error
      );
    }
  }
);

/**
 * Delete patient
 * DELETE /patients/:personId
 * Protected: Secretary can only delete patients created today
 */
router.delete(
  '/patients/:personId',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'patient',
    operation: 'delete',
    getRecordDate: getPatientCreationDate
  }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId);
      await deletePatient(personId);
      res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (error) {
      log.error('Error deleting patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete patient',
        error as Error
      );
    }
  }
);

// ============================================================================
// ESTIMATED COST UPDATE
// ============================================================================

/**
 * Update patient estimated cost
 * PUT /patients/:personId/estimated-cost
 */
router.put(
  '/patients/:personId/estimated-cost',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  async (
    req: Request<{ personId: string }, unknown, { estimatedCost: number; currency: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { estimatedCost, currency } = req.body;

      if (isNaN(personId)) {
        log.warn('Update estimated cost invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      const query = `
        UPDATE dbo.tblpatients
        SET EstimatedCost = @estimatedCost,
            Currency = @currency
        WHERE PersonID = @personId
      `;

      await database.executeQuery(query, [
        ['personId', database.TYPES.Int, personId],
        ['estimatedCost', database.TYPES.Int, estimatedCost || null],
        ['currency', database.TYPES.NVarChar, currency || 'IQD']
      ]);

      res.json({
        success: true,
        message: 'Estimated cost updated successfully'
      });
    } catch (error) {
      log.error('Error updating estimated cost:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update estimated cost',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALERT MANAGEMENT
// ============================================================================

/**
 * Get alerts for a patient
 * GET /patients/:personId/alerts
 */
router.get(
  '/patients/:personId/alerts',
  authenticate,
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);

      if (isNaN(personId)) {
        log.warn('Get alerts invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      const alerts = await getAlertsByPersonId(personId);
      res.json(alerts);
    } catch (error) {
      log.error('Error fetching patient alerts:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch alerts',
        error as Error
      );
    }
  }
);

/**
 * Create a new alert for a patient
 * POST /patients/:personId/alerts
 */
router.post(
  '/patients/:personId/alerts',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  async (
    req: Request<{ personId: string }, unknown, CreateAlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { alertTypeId, alertSeverity, alertDetails } = req.body;

      if (!alertDetails) {
        log.warn('Create alert missing details', { personId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Use defaults for quick-add (alertTypeId=1 General, alertSeverity=2 Medium)
      await createAlert({
        PersonID: personId,
        AlertTypeID: alertTypeId ? parseInt(String(alertTypeId), 10) : 1,
        AlertSeverity: alertSeverity ? parseInt(String(alertSeverity), 10) : 2,
        AlertDetails: alertDetails
      });

      res
        .status(201)
        .json({ success: true, message: 'Alert created successfully' });
    } catch (error) {
      log.error('Error creating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create alert',
        error as Error
      );
    }
  }
);

/**
 * Activate or deactivate an alert
 * PUT /alerts/:alertId/status
 */
router.put(
  '/alerts/:alertId/status',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  async (
    req: Request<{ alertId: string }, unknown, UpdateAlertStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        log.warn('Update alert status invalid isActive', { alertId, isActive });
        ErrorResponses.badRequest(res, 'isActive must be a boolean value');
        return;
      }

      await setAlertStatus(alertId, isActive);

      res.json({
        success: true,
        message: `Alert status updated to ${isActive}`
      });
    } catch (error) {
      log.error('Error updating alert status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert status',
        error as Error
      );
    }
  }
);

/**
 * Update an alert
 * PUT /alerts/:alertId
 */
router.put(
  '/alerts/:alertId',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  async (
    req: Request<{ alertId: string }, unknown, UpdateAlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { alertTypeId, alertSeverity, alertDetails } = req.body;

      if (isNaN(alertId)) {
        log.warn('Update alert invalid alert ID', { alertId: req.params.alertId });
        ErrorResponses.badRequest(res, 'Invalid alert ID');
        return;
      }

      if (!alertDetails) {
        log.warn('Update alert missing details', { alertId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      await updateAlert(alertId, alertTypeId, alertSeverity, alertDetails);

      res.json({
        success: true,
        message: 'Alert updated successfully'
      });
    } catch (error) {
      log.error('Error updating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert',
        error as Error
      );
    }
  }
);

// ============================================================================
// APPOINTMENT CHECK ROUTE
// ============================================================================

/**
 * Check if patient has a future appointment
 * GET /patients/:personId/has-appointment
 */
router.get(
  '/patients/:personId/has-appointment',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);

      if (isNaN(personId)) {
        log.warn('Has appointment check invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      const hasAppointment = await hasNextAppointment(personId);

      res.json({
        success: true,
        hasAppointment
      });
    } catch (error) {
      log.error(
        `Error checking appointment for patient ${req.params.personId}:`,
        error
      );
      ErrorResponses.internalError(
        res,
        'Failed to check appointment status',
        error as Error
      );
    }
  }
);

// ============================================================================
// TAG OPTIONS
// ============================================================================

/**
 * Get all tag options
 * GET /patients/tag-options
 */
router.get(
  '/patients/tag-options',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const tags = await database.executeQuery<TagOption>(
        'SELECT ID, Tag FROM dbo.tblTagOptions ORDER BY Tag',
        [],
        (columns) => ({
          id: columns[0].value as number,
          tag: columns[1].value as string
        })
      );
      res.json(tags);
    } catch (error) {
      log.error('Error fetching tag options:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch tag options',
        error as Error
      );
    }
  }
);

export default router;
