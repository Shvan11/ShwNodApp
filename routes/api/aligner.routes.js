/**
 * Aligner Management API Routes
 *
 * This module handles all API endpoints related to aligner management including:
 * - Aligner doctors management
 * - Aligner sets CRUD operations
 * - Aligner batches CRUD operations
 * - Aligner notes and activity tracking
 * - Patient queries for aligner work types
 * - PDF upload/delete for aligner sets
 * - Payment tracking for aligner sets
 *
 * Total endpoints: 30
 */

import express from 'express';
import * as database from '../../services/database/index.js';
import { uploadSinglePdf, handleUploadError } from '../../middleware/upload.js';
import driveUploadService from '../../services/google-drive/drive-upload.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';
import {
    validateAndCreateSet,
    validateAndCreateDoctor,
    validateAndUpdateDoctor,
    validateAndDeleteDoctor,
    AlignerValidationError
} from '../../services/business/AlignerService.js';
import {
    uploadPdfForSet,
    deletePdfFromSet,
    AlignerPdfError
} from '../../services/business/AlignerPdfService.js';

const router = express.Router();

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 */
router.get('/aligner/doctors', async (req, res) => {
    try {
        log.info('Fetching aligner doctors');

        const query = `
            SELECT DISTINCT
                ad.DrID,
                ad.DoctorName,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
                 WHERE s.AlignerDrID = ad.DrID
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadDoctorNotes
            FROM AlignerDoctors ad
            ORDER BY ad.DoctorName
        `;

        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                DrID: columns[0].value,
                DoctorName: columns[1].value,
                UnreadDoctorNotes: columns[2].value || 0
            })
        );

        res.json({
            success: true,
            doctors: doctors || [],
            count: doctors ? doctors.length : 0
        });

    } catch (error) {
        log.error('Error fetching aligner doctors:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner doctors', error);
    }
});

/**
 * Get all patients from v_allsets view
 * Shows all aligner sets with visual indicators for those without next batch
 */
router.get('/aligner/all-sets', async (req, res) => {
    try {
        log.info('Fetching all aligner sets from v_allsets');

        const query = `
            SELECT
                v.PersonID,
                v.PatientName,
                v.WorkID,
                v.AlignerDrID,
                v.AlignerSetID,
                v.SetSequence,
                v.BatchSequence,
                v.CreationDate,
                v.ManufactureDate,
                v.DeliveredToPatientDate,
                v.NextBatchReadyDate,
                v.Notes,
                v.NextBatchPresent,
                ad.DoctorName,
                p.patientID,
                p.Phone
            FROM dbo.v_allsets v
            INNER JOIN AlignerDoctors ad ON v.AlignerDrID = ad.DrID
            LEFT JOIN tblpatients p ON v.PersonID = p.PersonID
            ORDER BY
                CASE WHEN v.NextBatchPresent = 'False' THEN 0 ELSE 1 END,
                v.NextBatchReadyDate ASC,
                v.PatientName
        `;

        const sets = await database.executeQuery(
            query,
            [],
            (columns) => ({
                PersonID: columns[0].value,
                PatientName: columns[1].value,
                WorkID: columns[2].value,
                AlignerDrID: columns[3].value,
                AlignerSetID: columns[4].value,
                SetSequence: columns[5].value,
                BatchSequence: columns[6].value,
                CreationDate: columns[7].value,
                ManufactureDate: columns[8].value,
                DeliveredToPatientDate: columns[9].value,
                NextBatchReadyDate: columns[10].value,
                Notes: columns[11].value,
                NextBatchPresent: columns[12].value,
                DoctorName: columns[13].value,
                patientID: columns[14].value,
                Phone: columns[15].value
            })
        );

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0,
            noNextBatchCount: sets ? sets.filter(s => s.NextBatchPresent === 'False').length : 0
        });

    } catch (error) {
        log.error('Error fetching all aligner sets:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner sets', error);
    }
});

/**
 * Get all aligner patients (all doctors)
 * Returns all patients with aligner sets
 */
router.get('/aligner/patients/all', async (req, res) => {
    try {
        log.info('Fetching all aligner patients');

        const query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID,
                COUNT(DISTINCT s.AlignerSetID) as TotalSets,
                SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
            GROUP BY
                p.PersonID, p.FirstName, p.LastName, p.PatientName,
                p.Phone, p.patientID, w.workid, wt.WorkType, w.Typeofwork
            ORDER BY p.PatientName, p.FirstName, p.LastName
        `;

        const patients = await database.executeQuery(
            query,
            [],
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value,
                TotalSets: columns[9].value,
                ActiveSets: columns[10].value
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        log.error('Error fetching all aligner patients:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch all aligner patients', error);
    }
});

/**
 * Get all patients by doctor ID
 * Returns all patients with aligner sets assigned to a specific doctor
 */
router.get('/aligner/patients/by-doctor/:doctorId', async (req, res) => {
    try {
        const { doctorId } = req.params;

        if (!doctorId || isNaN(parseInt(doctorId))) {
            return ErrorResponses.invalidParameter(res, 'doctorId', 'Valid doctorId is required');
        }

        log.info(`Fetching all patients for doctor ID: ${doctorId}`);

        const query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID,
                COUNT(DISTINCT s.AlignerSetID) as TotalSets,
                SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 INNER JOIN tblAlignerSets sets ON n.AlignerSetID = sets.AlignerSetID
                 WHERE sets.WorkID = w.workid
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadDoctorNotes
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
                AND s.AlignerDrID = @doctorId
            GROUP BY
                p.PersonID, p.FirstName, p.LastName, p.PatientName,
                p.Phone, p.patientID, w.workid, wt.WorkType, w.Typeofwork
            ORDER BY p.PatientName, p.FirstName, p.LastName
        `;

        const patients = await database.executeQuery(
            query,
            [['doctorId', database.TYPES.Int, parseInt(doctorId)]],
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value,
                TotalSets: columns[9].value,
                ActiveSets: columns[10].value,
                UnreadDoctorNotes: columns[11].value || 0
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        log.error('Error fetching patients by doctor:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch patients by doctor', error);
    }
});

/**
 * Search for aligner patients
 * Returns patients who have aligner work types (19, 20, 21)
 * Optional doctor filter
 */
router.get('/aligner/patients', async (req, res) => {
    try {
        const { search, doctorId } = req.query;

        if (!search || search.trim().length < 2) {
            return ErrorResponses.badRequest(res, 'Search term must be at least 2 characters');
        }

        const searchTerm = search.trim();
        log.info(`Searching for aligner patients: ${searchTerm}${doctorId ? ` (Doctor ID: ${doctorId})` : ''}`);

        // Build query with optional doctor filter
        let query = `
            SELECT DISTINCT
                p.PersonID,
                p.FirstName,
                p.LastName,
                p.PatientName,
                p.Phone,
                p.patientID,
                w.workid,
                wt.WorkType,
                w.Typeofwork as WorkTypeID
            FROM tblpatients p
            INNER JOIN tblwork w ON p.PersonID = w.PersonID
            INNER JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            INNER JOIN tblAlignerSets s ON w.workid = s.WorkID
            WHERE wt.ID IN (19, 20, 21)
                AND (
                    p.FirstName LIKE @search
                    OR p.LastName LIKE @search
                    OR p.PatientName LIKE @search
                    OR p.Phone LIKE @search
                    OR p.patientID LIKE @search
                    OR (p.FirstName + ' ' + p.LastName) LIKE @search
                )
        `;

        // Add doctor filter if provided
        const params = [['search', database.TYPES.NVarChar, `%${searchTerm}%`]];
        if (doctorId && !isNaN(parseInt(doctorId))) {
            query += ` AND s.AlignerDrID = @doctorId`;
            params.push(['doctorId', database.TYPES.Int, parseInt(doctorId)]);
        }

        query += ` ORDER BY p.FirstName, p.LastName`;

        const patients = await database.executeQuery(
            query,
            params,
            (columns) => ({
                PersonID: columns[0].value,
                FirstName: columns[1].value,
                LastName: columns[2].value,
                PatientName: columns[3].value,
                Phone: columns[4].value,
                patientID: columns[5].value,
                workid: columns[6].value,
                WorkType: columns[7].value,
                WorkTypeID: columns[8].value
            })
        );

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });

    } catch (error) {
        log.error('Error searching aligner patients:', error);
        return ErrorResponses.internalError(res, 'Failed to search aligner patients', error);
    }
});

/**
 * Get aligner sets for a specific work
 */
router.get('/aligner/sets/:workId', async (req, res) => {
    try {
        const { workId } = req.params;

        if (!workId || isNaN(parseInt(workId))) {
            return ErrorResponses.invalidParameter(res, 'workId', 'Valid workId is required');
        }

        log.info(`Fetching aligner sets for work ID: ${workId}`);

        // Query aligner sets with batch summary, payment info, and activity flags
        const query = `
            SELECT
                s.AlignerSetID,
                s.WorkID,
                s.SetSequence,
                s.Type,
                s.UpperAlignersCount,
                s.LowerAlignersCount,
                s.RemainingUpperAligners,
                s.RemainingLowerAligners,
                s.CreationDate,
                s.Days,
                s.IsActive,
                s.Notes,
                s.FolderPath,
                s.AlignerDrID,
                s.SetUrl,
                s.SetPdfUrl,
                s.SetVideo,
                s.SetCost,
                s.Currency,
                ad.DoctorName as AlignerDoctorName,
                COUNT(b.AlignerBatchID) as TotalBatches,
                SUM(CASE WHEN b.DeliveredToPatientDate IS NOT NULL THEN 1 ELSE 0 END) as DeliveredBatches,
                vp.TotalPaid,
                vp.Balance,
                vp.PaymentStatus,
                (SELECT COUNT(*)
                 FROM tblAlignerNotes n
                 WHERE n.AlignerSetID = s.AlignerSetID
                   AND n.NoteType = 'Doctor'
                   AND n.IsRead = 0
                ) AS UnreadActivityCount
            FROM tblAlignerSets s
            LEFT JOIN tblAlignerBatches b ON s.AlignerSetID = b.AlignerSetID
            LEFT JOIN AlignerDoctors ad ON s.AlignerDrID = ad.DrID
            LEFT JOIN vw_AlignerSetPayments vp ON s.AlignerSetID = vp.AlignerSetID
            WHERE s.WorkID = @workId
            GROUP BY
                s.AlignerSetID, s.WorkID, s.SetSequence, s.Type,
                s.UpperAlignersCount, s.LowerAlignersCount,
                s.RemainingUpperAligners, s.RemainingLowerAligners,
                s.CreationDate, s.Days, s.IsActive, s.Notes,
                s.FolderPath, s.AlignerDrID, s.SetUrl, s.SetPdfUrl,
                s.SetVideo, s.SetCost, s.Currency, ad.DoctorName,
                vp.TotalPaid, vp.Balance, vp.PaymentStatus
            ORDER BY s.SetSequence
        `;

        const sets = await database.executeQuery(
            query,
            [['workId', database.TYPES.Int, parseInt(workId)]],
            (columns) => ({
                AlignerSetID: columns[0].value,
                WorkID: columns[1].value,
                SetSequence: columns[2].value,
                Type: columns[3].value,
                UpperAlignersCount: columns[4].value,
                LowerAlignersCount: columns[5].value,
                RemainingUpperAligners: columns[6].value,
                RemainingLowerAligners: columns[7].value,
                CreationDate: columns[8].value,
                Days: columns[9].value,
                IsActive: columns[10].value,
                Notes: columns[11].value,
                FolderPath: columns[12].value,
                AlignerDrID: columns[13].value,
                SetUrl: columns[14].value,
                SetPdfUrl: columns[15].value,
                SetVideo: columns[16].value,
                SetCost: columns[17].value,
                Currency: columns[18].value,
                AlignerDoctorName: columns[19].value,
                TotalBatches: columns[20].value,
                DeliveredBatches: columns[21].value,
                TotalPaid: columns[22].value,
                Balance: columns[23].value,
                PaymentStatus: columns[24].value,
                UnreadActivityCount: columns[25].value || 0
            })
        );

        // DEBUG: Log unread activity counts
        const setsWithUnread = (sets || []).filter(s => s.UnreadActivityCount > 0);
        if (setsWithUnread.length > 0) {
            log.info('🔔 [MAIN APP] Sets with unread doctor notes:', setsWithUnread.map(s => ({
                SetID: s.AlignerSetID,
                UnreadCount: s.UnreadActivityCount
            })));
        } else {
            log.info('📭 [MAIN APP] No sets with unread doctor notes for workId:', workId);
        }

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0
        });

    } catch (error) {
        log.error('Error fetching aligner sets:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner sets', error);
    }
});

/**
 * Add payment for an aligner set
 */
router.post('/aligner/payments', async (req, res) => {
    try {
        const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } = req.body;

        if (!workid || !Amountpaid || !Dateofpayment) {
            return ErrorResponses.badRequest(res, 'workid, Amountpaid, and Dateofpayment are required');
        }

        log.info(`Adding payment for work ID: ${workid}, Set ID: ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`);

        // Insert payment into tblInvoice
        const query = `
            INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID)
            VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID);
            SELECT SCOPE_IDENTITY() AS invoiceID;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['workid', database.TYPES.Int, parseInt(workid)],
                ['Amountpaid', database.TYPES.Decimal, parseFloat(Amountpaid)],
                ['Dateofpayment', database.TYPES.Date, new Date(Dateofpayment)],
                ['ActualAmount', database.TYPES.Decimal, ActualAmount ? parseFloat(ActualAmount) : null],
                ['ActualCur', database.TYPES.NVarChar, ActualCur || null],
                ['Change', database.TYPES.Decimal, Change ? parseFloat(Change) : null],
                ['AlignerSetID', database.TYPES.Int, AlignerSetID || null]
            ],
            (columns) => ({
                invoiceID: columns[0].value
            })
        );

        const invoiceID = result && result.length > 0 ? result[0].invoiceID : null;

        res.json({
            success: true,
            invoiceID: invoiceID,
            message: 'Payment added successfully'
        });

    } catch (error) {
        log.error('Error adding payment:', error);
        return ErrorResponses.internalError(res, 'Failed to add payment', error);
    }
});

/**
 * Get batches for a specific aligner set
 */
router.get('/aligner/batches/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        log.info(`Fetching batches for aligner set ID: ${setId}`);

        // Query batches for the set
        const query = `
            SELECT
                AlignerBatchID,
                AlignerSetID,
                BatchSequence,
                UpperAlignerCount,
                LowerAlignerCount,
                UpperAlignerStartSequence,
                UpperAlignerEndSequence,
                LowerAlignerStartSequence,
                LowerAlignerEndSequence,
                ManufactureDate,
                DeliveredToPatientDate,
                Days,
                ValidityPeriod,
                NextBatchReadyDate,
                Notes,
                IsActive
            FROM tblAlignerBatches
            WHERE AlignerSetID = @setId
            ORDER BY BatchSequence
        `;

        const batches = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                AlignerBatchID: columns[0].value,
                AlignerSetID: columns[1].value,
                BatchSequence: columns[2].value,
                UpperAlignerCount: columns[3].value,
                LowerAlignerCount: columns[4].value,
                UpperAlignerStartSequence: columns[5].value,
                UpperAlignerEndSequence: columns[6].value,
                LowerAlignerStartSequence: columns[7].value,
                LowerAlignerEndSequence: columns[8].value,
                ManufactureDate: columns[9].value,
                DeliveredToPatientDate: columns[10].value,
                Days: columns[11].value,
                ValidityPeriod: columns[12].value,
                NextBatchReadyDate: columns[13].value,
                Notes: columns[14].value,
                IsActive: columns[15].value
            })
        );

        res.json({
            success: true,
            batches: batches || [],
            count: batches ? batches.length : 0
        });

    } catch (error) {
        log.error('Error fetching aligner batches:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner batches', error);
    }
});

// ===== ALIGNER SETS CRUD OPERATIONS =====

/**
 * Create a new aligner set
 */
router.post('/aligner/sets', async (req, res) => {
    try {
        // Delegate to service layer for business logic and creation
        const newSetId = await validateAndCreateSet(req.body);

        res.json({
            success: true,
            setId: newSetId,
            message: 'Aligner set created successfully'
        });

    } catch (error) {
        log.error('Error creating aligner set:', error);

        // Handle validation errors from service layer
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }

        return ErrorResponses.internalError(res, 'Failed to create aligner set', error);
    }
});

/**
 * Update an existing aligner set
 */
router.put('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;
        const {
            SetSequence,
            Type,
            UpperAlignersCount,
            LowerAlignersCount,
            Days,
            AlignerDrID,
            SetUrl,
            SetPdfUrl,
            SetVideo,
            SetCost,
            Currency,
            Notes,
            IsActive
        } = req.body;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        log.info(`Updating aligner set ${setId}:`, req.body);

        const query = `
            UPDATE tblAlignerSets
            SET
                SetSequence = @SetSequence,
                Type = @Type,
                UpperAlignersCount = @UpperAlignersCount,
                LowerAlignersCount = @LowerAlignersCount,
                Days = @Days,
                AlignerDrID = @AlignerDrID,
                SetUrl = @SetUrl,
                SetPdfUrl = @SetPdfUrl,
                SetVideo = @SetVideo,
                SetCost = @SetCost,
                Currency = @Currency,
                Notes = @Notes,
                IsActive = @IsActive
            WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            query,
            [
                ['SetSequence', database.TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
                ['Type', database.TYPES.NVarChar, Type || null],
                ['UpperAlignersCount', database.TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
                ['LowerAlignersCount', database.TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
                ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
                ['AlignerDrID', database.TYPES.Int, AlignerDrID ? parseInt(AlignerDrID) : null],
                ['SetUrl', database.TYPES.NVarChar, SetUrl || null],
                ['SetPdfUrl', database.TYPES.NVarChar, SetPdfUrl || null],
                ['SetVideo', database.TYPES.NVarChar, SetVideo || null],
                ['SetCost', database.TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
                ['Currency', database.TYPES.NVarChar, Currency || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true],
                ['setId', database.TYPES.Int, parseInt(setId)]
            ]
        );

        res.json({
            success: true,
            message: 'Aligner set updated successfully'
        });

    } catch (error) {
        log.error('Error updating aligner set:', error);
        return ErrorResponses.internalError(res, 'Failed to update aligner set', error);
    }
});

/**
 * Delete an aligner set (and its batches)
 */
router.delete('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        log.info(`Deleting aligner set ${setId}`);

        // Delete batches first (foreign key constraint)
        const deleteBatchesQuery = `
            DELETE FROM tblAlignerBatches WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            deleteBatchesQuery,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        // Then delete the set
        const deleteSetQuery = `
            DELETE FROM tblAlignerSets WHERE AlignerSetID = @setId
        `;

        await database.executeQuery(
            deleteSetQuery,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        res.json({
            success: true,
            message: 'Aligner set and its batches deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting aligner set:', error);
        return ErrorResponses.internalError(res, 'Failed to delete aligner set', error);
    }
});

// ===== ALIGNER NOTES MANAGEMENT =====

/**
 * Get notes for an aligner set
 */
router.get('/aligner/notes/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        const query = `
            SELECT
                n.NoteID,
                n.AlignerSetID,
                n.NoteType,
                n.NoteText,
                n.CreatedAt,
                n.IsEdited,
                n.EditedAt,
                n.IsRead,
                d.DoctorName
            FROM tblAlignerNotes n
            INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
            INNER JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
            WHERE n.AlignerSetID = @setId
            ORDER BY n.CreatedAt DESC
        `;

        const notes = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                NoteID: columns[0].value,
                AlignerSetID: columns[1].value,
                NoteType: columns[2].value,
                NoteText: columns[3].value,
                CreatedAt: columns[4].value,
                IsEdited: columns[5].value,
                EditedAt: columns[6].value,
                IsRead: columns[7].value,
                DoctorName: columns[8].value
            })
        );

        res.json({
            success: true,
            notes: notes || [],
            count: notes ? notes.length : 0
        });

    } catch (error) {
        log.error('Error fetching aligner set notes:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch notes', error);
    }
});

/**
 * Add a new note from lab staff
 */
router.post('/aligner/notes', async (req, res) => {
    try {
        const { AlignerSetID, NoteText } = req.body;

        if (!AlignerSetID || !NoteText || NoteText.trim() === '') {
            return ErrorResponses.badRequest(res, 'Set ID and note text are required');
        }

        // Verify that the set exists
        const setCheckQuery = `
            SELECT AlignerSetID
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId
        `;

        const setExists = await database.executeQuery(
            setCheckQuery,
            [['setId', database.TYPES.Int, parseInt(AlignerSetID)]],
            (columns) => columns[0].value
        );

        if (!setExists || setExists.length === 0) {
            return ErrorResponses.notFound(res, 'Aligner set');
        }

        // Insert note as 'Lab' type
        // Note: Using SCOPE_IDENTITY() instead of OUTPUT clause because table has triggers
        const insertQuery = `
            INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
            VALUES (@setId, 'Lab', @noteText);
            SELECT SCOPE_IDENTITY() AS NoteID;
        `;

        const result = await database.executeQuery(
            insertQuery,
            [
                ['setId', database.TYPES.Int, parseInt(AlignerSetID)],
                ['noteText', database.TYPES.NVarChar, NoteText.trim()]
            ],
            (columns) => columns[0].value
        );

        const noteId = result && result.length > 0 ? result[0] : null;

        log.info(`Lab added note to aligner set ${AlignerSetID}`);

        res.json({
            success: true,
            noteId: noteId,
            message: 'Note added successfully'
        });

    } catch (error) {
        log.error('Error adding lab note:', error);
        return ErrorResponses.internalError(res, 'Failed to add note', error);
    }
});

/**
 * Toggle note read/unread status
 * NOTE: This route MUST come before the generic PATCH /aligner/notes/:noteId route
 * to ensure Express matches the more specific route first
 */
router.patch('/aligner/notes/:noteId/toggle-read', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        // Toggle IsRead status
        const updateQuery = `
            UPDATE tblAlignerNotes
            SET IsRead = CASE WHEN IsRead = 1 THEN 0 ELSE 1 END
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            updateQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]]
        );

        res.json({
            success: true,
            message: 'Note read status toggled successfully'
        });

    } catch (error) {
        log.error('Error toggling note read status:', error);
        return ErrorResponses.internalError(res, 'Failed to toggle read status', error);
    }
});

/**
 * Update an existing note
 */
router.patch('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const { NoteText } = req.body;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        if (!NoteText || NoteText.trim() === '') {
            return ErrorResponses.badRequest(res, 'Note text is required');
        }

        // Verify note exists
        const noteCheckQuery = `
            SELECT NoteID, NoteType
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const existingNote = await database.executeQuery(
            noteCheckQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => ({
                NoteID: columns[0].value,
                NoteType: columns[1].value
            })
        );

        if (!existingNote || existingNote.length === 0) {
            return ErrorResponses.notFound(res, 'Note');
        }

        // Update note
        const updateQuery = `
            UPDATE tblAlignerNotes
            SET NoteText = @noteText,
                IsEdited = 1,
                EditedAt = GETDATE()
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            updateQuery,
            [
                ['noteId', database.TYPES.Int, parseInt(noteId)],
                ['noteText', database.TYPES.NVarChar, NoteText.trim()]
            ]
        );

        log.info(`Note ${noteId} updated`);

        res.json({
            success: true,
            message: 'Note updated successfully'
        });

    } catch (error) {
        log.error('Error updating note:', error);
        return ErrorResponses.internalError(res, 'Failed to update note', error);
    }
});

/**
 * Delete a note
 */
router.delete('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        // Verify note exists
        const noteCheckQuery = `
            SELECT NoteID
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const existingNote = await database.executeQuery(
            noteCheckQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => columns[0].value
        );

        if (!existingNote || existingNote.length === 0) {
            return ErrorResponses.notFound(res, 'Note');
        }

        // Delete note
        const deleteQuery = `
            DELETE FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        await database.executeQuery(
            deleteQuery,
            [['noteId', database.TYPES.Int, parseInt(noteId)]]
        );

        log.info(`Note ${noteId} deleted`);

        res.json({
            success: true,
            message: 'Note deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting note:', error);
        return ErrorResponses.internalError(res, 'Failed to delete note', error);
    }
});

/**
 * Get note read status
 */
router.get('/aligner/notes/:noteId/status', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        const query = `
            SELECT IsRead
            FROM tblAlignerNotes
            WHERE NoteID = @noteId
        `;

        const results = await database.executeQuery(
            query,
            [['noteId', database.TYPES.Int, parseInt(noteId)]],
            (columns) => ({
                IsRead: columns[0].value
            })
        );

        if (results && results.length > 0) {
            res.json({
                success: true,
                isRead: results[0].IsRead
            });
        } else {
            return ErrorResponses.notFound(res, 'Note');
        }

    } catch (error) {
        log.error('Error getting note status:', error);
        return ErrorResponses.internalError(res, 'Failed to get note status', error);
    }
});

// ===== ALIGNER ACTIVITY FLAGS =====

/**
 * Get unread activities for a specific aligner set
 */
router.get('/aligner/activity/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        const query = `
            SELECT
                ActivityID,
                AlignerSetID,
                ActivityType,
                ActivityDescription,
                CreatedAt,
                IsRead,
                ReadAt,
                RelatedRecordID
            FROM tblAlignerActivityFlags
            WHERE AlignerSetID = @setId AND IsRead = 0
            ORDER BY CreatedAt DESC
        `;

        const activities = await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]],
            (columns) => ({
                ActivityID: columns[0].value,
                AlignerSetID: columns[1].value,
                ActivityType: columns[2].value,
                ActivityDescription: columns[3].value,
                CreatedAt: columns[4].value,
                IsRead: columns[5].value,
                ReadAt: columns[6].value,
                RelatedRecordID: columns[7].value
            })
        );

        res.json({
            success: true,
            activities: activities || [],
            count: activities ? activities.length : 0
        });

    } catch (error) {
        log.error('Error fetching activities:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch activities', error);
    }
});

/**
 * Mark a single activity as read
 */
router.patch('/aligner/activity/:activityId/mark-read', async (req, res) => {
    try {
        const { activityId } = req.params;

        if (!activityId || isNaN(parseInt(activityId))) {
            return ErrorResponses.invalidParameter(res, 'activityId', 'Valid activityId is required');
        }

        const query = `
            UPDATE tblAlignerActivityFlags
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE ActivityID = @activityId
        `;

        await database.executeQuery(
            query,
            [['activityId', database.TYPES.Int, parseInt(activityId)]]
        );

        log.info(`Activity ${activityId} marked as read`);

        res.json({
            success: true,
            message: 'Activity marked as read'
        });

    } catch (error) {
        log.error('Error marking activity as read:', error);
        return ErrorResponses.internalError(res, 'Failed to mark activity as read', error);
    }
});

/**
 * Mark all activities for a set as read
 */
router.patch('/aligner/activity/set/:setId/mark-all-read', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        const query = `
            UPDATE tblAlignerActivityFlags
            SET IsRead = 1, ReadAt = GETDATE()
            WHERE AlignerSetID = @setId AND IsRead = 0
        `;

        await database.executeQuery(
            query,
            [['setId', database.TYPES.Int, parseInt(setId)]]
        );

        log.info(`All activities for set ${setId} marked as read`);

        res.json({
            success: true,
            message: 'All activities marked as read'
        });

    } catch (error) {
        log.error('Error marking all activities as read:', error);
        return ErrorResponses.internalError(res, 'Failed to mark all activities as read', error);
    }
});

// ===== ALIGNER BATCHES CRUD OPERATIONS =====

/**
 * Create a new aligner batch
 */
router.post('/aligner/batches', async (req, res) => {
    try {
        const {
            AlignerSetID,
            BatchSequence,
            UpperAlignerCount,
            LowerAlignerCount,
            UpperAlignerStartSequence,
            LowerAlignerStartSequence,
            ManufactureDate,
            DeliveredToPatientDate,
            Days,
            Notes,
            IsActive
        } = req.body;

        // Validation
        if (!AlignerSetID) {
            return ErrorResponses.badRequest(res, 'AlignerSetID is required');
        }

        log.info('Creating new aligner batch:', req.body);

        const query = `
            DECLARE @OutputTable TABLE (AlignerBatchID INT);

            INSERT INTO tblAlignerBatches (
                AlignerSetID, BatchSequence, UpperAlignerCount, LowerAlignerCount,
                UpperAlignerStartSequence, LowerAlignerStartSequence,
                ManufactureDate, DeliveredToPatientDate, Days,
                Notes, IsActive
            )
            OUTPUT INSERTED.AlignerBatchID INTO @OutputTable
            VALUES (
                @AlignerSetID, @BatchSequence, @UpperAlignerCount, @LowerAlignerCount,
                @UpperAlignerStartSequence, @LowerAlignerStartSequence,
                @ManufactureDate, @DeliveredToPatientDate, @Days,
                @Notes, @IsActive
            );

            SELECT AlignerBatchID FROM @OutputTable;
        `;

        const result = await database.executeQuery(
            query,
            [
                ['AlignerSetID', database.TYPES.Int, parseInt(AlignerSetID)],
                ['BatchSequence', database.TYPES.Int, BatchSequence ? parseInt(BatchSequence) : null],
                ['UpperAlignerCount', database.TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
                ['LowerAlignerCount', database.TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
                ['UpperAlignerStartSequence', database.TYPES.Int, UpperAlignerStartSequence ? parseInt(UpperAlignerStartSequence) : null],
                ['LowerAlignerStartSequence', database.TYPES.Int, LowerAlignerStartSequence ? parseInt(LowerAlignerStartSequence) : null],
                ['ManufactureDate', database.TYPES.Date, ManufactureDate || null],
                ['DeliveredToPatientDate', database.TYPES.Date, DeliveredToPatientDate || null],
                ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true]
            ],
            (columns) => columns[0].value
        );

        const newBatchId = result && result.length > 0 ? result[0] : null;

        res.json({
            success: true,
            batchId: newBatchId,
            message: 'Aligner batch created successfully'
        });

    } catch (error) {
        log.error('Error creating aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to create aligner batch', error);
    }
});

/**
 * Update an existing aligner batch
 */
router.put('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        const {
            BatchSequence,
            UpperAlignerCount,
            LowerAlignerCount,
            UpperAlignerStartSequence,
            LowerAlignerStartSequence,
            ManufactureDate,
            DeliveredToPatientDate,
            Notes,
            IsActive,
            Days
            // Note: UpperAlignerEndSequence, LowerAlignerEndSequence, ValidityPeriod, NextBatchReadyDate
            // are computed columns - they're calculated automatically by the database
        } = req.body;

        if (!batchId || isNaN(parseInt(batchId))) {
            return ErrorResponses.invalidParameter(res, 'batchId', 'Valid batchId is required');
        }

        log.info(`Updating aligner batch ${batchId}:`, req.body);

        // Note: UpperAlignerEndSequence, LowerAlignerEndSequence, ValidityPeriod, and NextBatchReadyDate
        // are computed columns and should not be included in UPDATE statements
        const query = `
            UPDATE tblAlignerBatches
            SET
                BatchSequence = @BatchSequence,
                UpperAlignerCount = @UpperAlignerCount,
                LowerAlignerCount = @LowerAlignerCount,
                UpperAlignerStartSequence = @UpperAlignerStartSequence,
                LowerAlignerStartSequence = @LowerAlignerStartSequence,
                ManufactureDate = @ManufactureDate,
                DeliveredToPatientDate = @DeliveredToPatientDate,
                Notes = @Notes,
                IsActive = @IsActive,
                Days = @Days
            WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [
                ['BatchSequence', database.TYPES.Int, BatchSequence ? parseInt(BatchSequence) : null],
                ['UpperAlignerCount', database.TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
                ['LowerAlignerCount', database.TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
                ['UpperAlignerStartSequence', database.TYPES.Int, UpperAlignerStartSequence ? parseInt(UpperAlignerStartSequence) : null],
                ['LowerAlignerStartSequence', database.TYPES.Int, LowerAlignerStartSequence ? parseInt(LowerAlignerStartSequence) : null],
                ['ManufactureDate', database.TYPES.Date, ManufactureDate || null],
                ['DeliveredToPatientDate', database.TYPES.Date, DeliveredToPatientDate || null],
                ['Notes', database.TYPES.NVarChar, Notes || null],
                ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true],
                ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
                ['batchId', database.TYPES.Int, parseInt(batchId)]
            ]
        );

        res.json({
            success: true,
            message: 'Aligner batch updated successfully'
        });

    } catch (error) {
        log.error('Error updating aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to update aligner batch', error);
    }
});

/**
 * Mark batch as delivered
 */
router.patch('/aligner/batches/:batchId/deliver', async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId || isNaN(parseInt(batchId))) {
            return ErrorResponses.invalidParameter(res, 'batchId', 'Valid batchId is required');
        }

        log.info(`Marking batch ${batchId} as delivered`);

        const query = `
            UPDATE tblAlignerBatches
            SET DeliveredToPatientDate = GETDATE()
            WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [['batchId', database.TYPES.Int, parseInt(batchId)]]
        );

        res.json({
            success: true,
            message: 'Batch marked as delivered'
        });

    } catch (error) {
        log.error('Error marking batch as delivered:', error);
        return ErrorResponses.internalError(res, 'Failed to mark batch as delivered', error);
    }
});

/**
 * Delete an aligner batch
 */
router.delete('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId || isNaN(parseInt(batchId))) {
            return ErrorResponses.invalidParameter(res, 'batchId', 'Valid batchId is required');
        }

        log.info(`Deleting aligner batch ${batchId}`);

        const query = `
            DELETE FROM tblAlignerBatches WHERE AlignerBatchID = @batchId
        `;

        await database.executeQuery(
            query,
            [['batchId', database.TYPES.Int, parseInt(batchId)]]
        );

        res.json({
            success: true,
            message: 'Aligner batch deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to delete aligner batch', error);
    }
});

// ==============================
// ALIGNER PDF UPLOAD/DELETE
// ==============================

/**
 * Upload PDF for an aligner set (staff page)
 * Note: Uses extended timeout (2 minutes) for file upload to Google Drive
 */
router.post('/aligner/sets/:setId/upload-pdf', timeouts.long, uploadSinglePdf, handleUploadError, async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);
        const uploaderEmail = 'staff@shwan.local'; // Staff uploads (no auth required)

        // Validate file exists
        if (!req.file) {
            return ErrorResponses.badRequest(res, 'No file uploaded. Please select a PDF file.');
        }

        // Validate PDF
        const validation = driveUploadService.validatePdfFile(req.file.buffer, req.file.mimetype);
        if (!validation.valid) {
            return ErrorResponses.badRequest(res, validation.error);
        }

        // Delegate to service layer for PDF upload workflow
        const result = await uploadPdfForSet(setId, req.file, uploaderEmail);

        res.json({
            success: true,
            message: 'PDF uploaded successfully',
            data: result
        });

    } catch (error) {
        log.error('Error uploading PDF:', error);

        // Handle errors from service layer
        if (error instanceof AlignerPdfError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.internalError(res, error.message, error.details);
        }

        return ErrorResponses.internalError(res, 'Failed to upload PDF', error);
    }
});

/**
 * Delete PDF from an aligner set (staff page)
 */
router.delete('/aligner/sets/:setId/pdf', async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);

        // Delegate to service layer for PDF deletion workflow
        await deletePdfFromSet(setId);

        res.json({
            success: true,
            message: 'PDF deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting PDF:', error);

        // Handle errors from service layer
        if (error instanceof AlignerPdfError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.internalError(res, error.message, error.details);
        }

        return ErrorResponses.internalError(res, 'Failed to delete PDF', error);
    }
});

// ==============================
// ALIGNER DOCTORS MANAGEMENT
// ==============================

/**
 * Get all aligner doctors
 */
router.get('/aligner-doctors', async (req, res) => {
    try {
        const query = `
            SELECT DrID, DoctorName, DoctorEmail, LogoPath
            FROM AlignerDoctors
            ORDER BY DoctorName
        `;

        const doctors = await database.executeQuery(
            query,
            [],
            (columns) => ({
                DrID: columns[0].value,
                DoctorName: columns[1].value,
                DoctorEmail: columns[2].value,
                LogoPath: columns[3].value
            })
        );

        res.json({
            success: true,
            doctors: doctors || []
        });

    } catch (error) {
        log.error('Error fetching aligner doctors:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner doctors', error);
    }
});

/**
 * Add new aligner doctor
 */
router.post('/aligner-doctors', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const newDrID = await validateAndCreateDoctor(req.body);

        res.json({
            success: true,
            message: 'Doctor added successfully',
            drID: newDrID
        });

    } catch (error) {
        log.error('Error adding aligner doctor:', error);

        // Handle validation errors from service layer
        if (error instanceof AlignerValidationError) {
            if (error.code === 'EMAIL_ALREADY_EXISTS') {
                return ErrorResponses.conflict(res, error.message);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }

        return ErrorResponses.internalError(res, 'Failed to add aligner doctor', error);
    }
});

/**
 * Update aligner doctor
 */
router.put('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;

        // Delegate to service layer for validation and update
        await validateAndUpdateDoctor(drID, req.body);

        res.json({
            success: true,
            message: 'Doctor updated successfully'
        });

    } catch (error) {
        log.error('Error updating aligner doctor:', error);

        // Handle validation errors from service layer
        if (error instanceof AlignerValidationError) {
            if (error.code === 'EMAIL_ALREADY_EXISTS') {
                return ErrorResponses.conflict(res, error.message);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }

        return ErrorResponses.internalError(res, 'Failed to update aligner doctor', error);
    }
});

/**
 * Delete aligner doctor
 */
router.delete('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;

        // Delegate to service layer for dependency checking and deletion
        await validateAndDeleteDoctor(drID);

        res.json({
            success: true,
            message: 'Doctor deleted successfully'
        });

    } catch (error) {
        log.error('Error deleting aligner doctor:', error);

        // Handle validation errors from service layer
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, error.details);
        }

        return ErrorResponses.internalError(res, 'Failed to delete aligner doctor', error);
    }
});

export default router;
