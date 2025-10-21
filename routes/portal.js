import express from 'express';
import { executeQuery, TYPES } from '../services/database/index.js';
import { authenticateDoctor, authenticateDoctorDev } from '../middleware/doctorAuth.js';

const router = express.Router();

// Always use dev auth middleware which supports both query params and headers
// This allows testing with ?email= parameter while still working with Cloudflare Access headers in production
const authMiddleware = authenticateDoctorDev;

/**
 * Get authenticated doctor info
 */
router.get('/api/portal/auth', authMiddleware, async (req, res) => {
    try {
        res.json({
            success: true,
            doctor: {
                DrID: req.doctor.DrID,
                DoctorName: req.doctor.DoctorName,
                DoctorEmail: req.doctor.DoctorEmail
            }
        });
    } catch (error) {
        console.error('Error fetching doctor auth:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch doctor information'
        });
    }
});

/**
 * Get all cases for the authenticated doctor
 */
router.get('/api/portal/cases', authMiddleware, async (req, res) => {
    try {
        const drID = req.doctor.DrID;

        // Get all aligner works for this doctor with active set details and payment summary
        const query = `
            WITH ActiveSetInfo AS (
                SELECT
                    s.WorkID,
                    s.AlignerSetID,
                    s.SetSequence,
                    s.UpperAlignersCount,
                    s.LowerAlignersCount,
                    s.RemainingUpperAligners,
                    s.RemainingLowerAligners,
                    s.SetCost,
                    s.Currency,
                    s.SetUrl,
                    s.SetPdfUrl,
                    ROW_NUMBER() OVER (PARTITION BY s.WorkID ORDER BY s.SetSequence DESC) as rn
                FROM tblAlignerSets s
                WHERE s.IsActive = 1 AND s.AlignerDrID = @drID
            ),
            PaymentInfo AS (
                SELECT
                    asi.WorkID,
                    vp.TotalPaid,
                    vp.Balance,
                    vp.PaymentStatus
                FROM ActiveSetInfo asi
                LEFT JOIN vw_AlignerSetPayments vp ON asi.AlignerSetID = vp.AlignerSetID
                WHERE asi.rn = 1
            )
            SELECT
                w.workid,
                p.patientID,
                p.PatientName,
                p.FirstName,
                p.LastName,
                p.Phone,
                w.Typeofwork as WorkType,
                w.AdditionDate as WorkDate,
                COUNT(DISTINCT s.AlignerSetID) as TotalSets,
                SUM(CASE WHEN s.IsActive = 1 THEN 1 ELSE 0 END) as ActiveSets,
                MAX(s.CreationDate) as LastSetDate,
                asi.SetSequence as ActiveSetSequence,
                asi.UpperAlignersCount as ActiveUpperCount,
                asi.LowerAlignersCount as ActiveLowerCount,
                asi.RemainingUpperAligners as ActiveRemainingUpper,
                asi.RemainingLowerAligners as ActiveRemainingLower,
                asi.SetCost,
                asi.Currency,
                asi.SetUrl,
                asi.SetPdfUrl,
                pi.TotalPaid,
                pi.Balance,
                pi.PaymentStatus
            FROM tblWork w
            INNER JOIN tblPatients p ON w.PersonID = p.PersonID
            LEFT JOIN tblAlignerSets s ON w.workid = s.WorkID
            LEFT JOIN ActiveSetInfo asi ON w.workid = asi.WorkID AND asi.rn = 1
            LEFT JOIN PaymentInfo pi ON w.workid = pi.WorkID
            WHERE s.AlignerDrID = @drID
            GROUP BY
                w.workid, p.patientID, p.PatientName, p.FirstName,
                p.LastName, p.Phone, w.Typeofwork, w.AdditionDate,
                asi.SetSequence, asi.UpperAlignersCount, asi.LowerAlignersCount,
                asi.RemainingUpperAligners, asi.RemainingLowerAligners,
                asi.SetCost, asi.Currency, asi.SetUrl, asi.SetPdfUrl,
                pi.TotalPaid, pi.Balance, pi.PaymentStatus
            ORDER BY MAX(s.CreationDate) DESC
        `;

        const cases = await executeQuery(
            query,
            [['drID', TYPES.Int, drID]],
            (columns) => ({
                workid: columns[0].value,
                patientID: columns[1].value,
                PatientName: columns[2].value,
                FirstName: columns[3].value,
                LastName: columns[4].value,
                Phone: columns[5].value,
                WorkType: columns[6].value,
                WorkDate: columns[7].value,
                TotalSets: columns[8].value,
                ActiveSets: columns[9].value,
                LastSetDate: columns[10].value,
                ActiveSetSequence: columns[11].value,
                ActiveUpperCount: columns[12].value,
                ActiveLowerCount: columns[13].value,
                ActiveRemainingUpper: columns[14].value,
                ActiveRemainingLower: columns[15].value,
                SetCost: columns[16].value,
                Currency: columns[17].value,
                SetUrl: columns[18].value,
                SetPdfUrl: columns[19].value,
                TotalPaid: columns[20].value,
                Balance: columns[21].value,
                PaymentStatus: columns[22].value
            })
        );

        res.json({
            success: true,
            cases: cases || [],
            count: cases ? cases.length : 0
        });

    } catch (error) {
        console.error('Error fetching portal cases:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch cases'
        });
    }
});

/**
 * Get aligner sets for a specific work (with authorization check)
 */
router.get('/api/portal/sets/:workId', authMiddleware, async (req, res) => {
    try {
        const { workId } = req.params;
        const drID = req.doctor.DrID;

        // Query with authorization check - only return sets for this doctor
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
                s.SetUrl,
                s.SetPdfUrl,
                s.SetCost,
                s.Currency,
                ad.DoctorName as AlignerDoctorName,
                COUNT(b.AlignerBatchID) as TotalBatches,
                SUM(CASE WHEN b.DeliveredToPatientDate IS NOT NULL THEN 1 ELSE 0 END) as DeliveredBatches,
                vp.TotalPaid,
                vp.Balance,
                vp.PaymentStatus
            FROM tblAlignerSets s
            LEFT JOIN tblAlignerBatches b ON s.AlignerSetID = b.AlignerSetID
            LEFT JOIN AlignerDoctors ad ON s.AlignerDrID = ad.DrID
            LEFT JOIN vw_AlignerSetPayments vp ON s.AlignerSetID = vp.AlignerSetID
            WHERE s.WorkID = @workId AND s.AlignerDrID = @drID
            GROUP BY
                s.AlignerSetID, s.WorkID, s.SetSequence, s.Type,
                s.UpperAlignersCount, s.LowerAlignersCount,
                s.RemainingUpperAligners, s.RemainingLowerAligners,
                s.CreationDate, s.Days, s.IsActive, s.Notes,
                s.SetUrl, s.SetPdfUrl, s.SetCost, s.Currency, ad.DoctorName,
                vp.TotalPaid, vp.Balance, vp.PaymentStatus
            ORDER BY s.SetSequence
        `;

        const sets = await executeQuery(
            query,
            [
                ['workId', TYPES.Int, parseInt(workId)],
                ['drID', TYPES.Int, drID]
            ],
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
                SetUrl: columns[12].value,
                SetPdfUrl: columns[13].value,
                SetCost: columns[14].value,
                Currency: columns[15].value,
                AlignerDoctorName: columns[16].value,
                TotalBatches: columns[17].value,
                DeliveredBatches: columns[18].value,
                TotalPaid: columns[19].value,
                Balance: columns[20].value,
                PaymentStatus: columns[21].value
            })
        );

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0
        });

    } catch (error) {
        console.error('Error fetching portal sets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sets'
        });
    }
});

/**
 * Get batches for a specific set (with authorization check)
 */
router.get('/api/portal/batches/:setId', authMiddleware, async (req, res) => {
    try {
        const { setId } = req.params;
        const drID = req.doctor.DrID;

        // First verify this set belongs to this doctor
        const authCheck = `
            SELECT AlignerSetID
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId AND AlignerDrID = @drID
        `;

        const authorized = await executeQuery(
            authCheck,
            [
                ['setId', TYPES.Int, parseInt(setId)],
                ['drID', TYPES.Int, drID]
            ],
            (columns) => columns[0].value
        );

        if (!authorized || authorized.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this set'
            });
        }

        // Get batches
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

        const batches = await executeQuery(
            query,
            [['setId', TYPES.Int, parseInt(setId)]],
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
        console.error('Error fetching portal batches:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch batches'
        });
    }
});

/**
 * Update days per aligner for a batch (doctor can edit this)
 */
router.patch('/api/portal/batches/:batchId/days', authMiddleware, async (req, res) => {
    try {
        const { batchId } = req.params;
        const { Days } = req.body;
        const drID = req.doctor.DrID;

        // Validate Days input
        if (!Days || isNaN(parseInt(Days)) || parseInt(Days) < 1) {
            return res.status(400).json({
                success: false,
                error: 'Valid days value is required (minimum 1)'
            });
        }

        // Verify this batch belongs to a set owned by this doctor
        const authCheck = `
            SELECT b.AlignerBatchID
            FROM tblAlignerBatches b
            INNER JOIN tblAlignerSets s ON b.AlignerSetID = s.AlignerSetID
            WHERE b.AlignerBatchID = @batchId AND s.AlignerDrID = @drID
        `;

        const authorized = await executeQuery(
            authCheck,
            [
                ['batchId', TYPES.Int, parseInt(batchId)],
                ['drID', TYPES.Int, drID]
            ],
            (columns) => columns[0].value
        );

        if (!authorized || authorized.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this batch'
            });
        }

        // Update Days (ValidityPeriod and NextBatchReadyDate are computed columns)
        const updateQuery = `
            UPDATE tblAlignerBatches
            SET Days = @days
            WHERE AlignerBatchID = @batchId
        `;

        await executeQuery(
            updateQuery,
            [
                ['days', TYPES.Int, parseInt(Days)],
                ['batchId', TYPES.Int, parseInt(batchId)]
            ]
        );

        console.log(`Doctor ${req.doctor.DoctorName} updated batch ${batchId} days to ${Days}`);

        res.json({
            success: true,
            message: 'Days per aligner updated successfully'
        });

    } catch (error) {
        console.error('Error updating batch days:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update days per aligner'
        });
    }
});

/**
 * Get notes for a specific set
 */
router.get('/api/portal/notes/:setId', authMiddleware, async (req, res) => {
    try {
        const { setId } = req.params;
        const drID = req.doctor.DrID;

        // Verify access to this set
        const authCheck = `
            SELECT AlignerSetID
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId AND AlignerDrID = @drID
        `;

        const authorized = await executeQuery(
            authCheck,
            [
                ['setId', TYPES.Int, parseInt(setId)],
                ['drID', TYPES.Int, drID]
            ],
            (columns) => columns[0].value
        );

        if (!authorized || authorized.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this set'
            });
        }

        // Get notes with doctor name
        const query = `
            SELECT
                n.NoteID,
                n.AlignerSetID,
                n.NoteType,
                n.NoteText,
                n.CreatedAt,
                n.IsEdited,
                n.EditedAt,
                d.DoctorName
            FROM tblAlignerNotes n
            INNER JOIN tblAlignerSets s ON n.AlignerSetID = s.AlignerSetID
            INNER JOIN AlignerDoctors d ON s.AlignerDrID = d.DrID
            WHERE n.AlignerSetID = @setId
            ORDER BY n.CreatedAt DESC
        `;

        const notes = await executeQuery(
            query,
            [['setId', TYPES.Int, parseInt(setId)]],
            (columns) => ({
                NoteID: columns[0].value,
                AlignerSetID: columns[1].value,
                NoteType: columns[2].value,
                NoteText: columns[3].value,
                CreatedAt: columns[4].value,
                IsEdited: columns[5].value,
                EditedAt: columns[6].value,
                DoctorName: columns[7].value
            })
        );

        res.json({
            success: true,
            notes: notes || [],
            count: notes ? notes.length : 0
        });

    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch notes'
        });
    }
});

/**
 * Add a new note (doctor or lab)
 */
router.post('/api/portal/notes', authMiddleware, async (req, res) => {
    try {
        const { AlignerSetID, NoteText } = req.body;
        const drID = req.doctor.DrID;

        if (!AlignerSetID || !NoteText || NoteText.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Set ID and note text are required'
            });
        }

        // Verify access to this set
        const authCheck = `
            SELECT AlignerSetID
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId AND AlignerDrID = @drID
        `;

        const authorized = await executeQuery(
            authCheck,
            [
                ['setId', TYPES.Int, parseInt(AlignerSetID)],
                ['drID', TYPES.Int, drID]
            ],
            (columns) => columns[0].value
        );

        if (!authorized || authorized.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this set'
            });
        }

        // Insert note (doctors can only add 'Doctor' type notes from portal)
        // Doctor notes should be UNREAD by default (IsRead = 0) to trigger highlighting
        const insertQuery = `
            INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText, IsRead)
            VALUES (@setId, 'Doctor', @noteText, 0);
            SELECT SCOPE_IDENTITY() AS NoteID;
        `;

        const result = await executeQuery(
            insertQuery,
            [
                ['setId', TYPES.Int, parseInt(AlignerSetID)],
                ['noteText', TYPES.NVarChar, NoteText.trim()]
            ],
            (columns) => columns[0].value
        );

        const noteId = result && result.length > 0 ? result[0] : null;

        console.log(`Doctor ${req.doctor.DoctorName} added note to set ${AlignerSetID}`);

        res.json({
            success: true,
            noteId: noteId,
            message: 'Note added successfully'
        });

    } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add note'
        });
    }
});


export default router;
