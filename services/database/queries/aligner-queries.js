/**
 * Aligner-related database queries
 *
 * This module contains all SQL queries for aligner management including:
 * - Aligner doctors
 * - Aligner sets
 * - Aligner batches
 * - Aligner notes
 * - Aligner patients
 * - Aligner payments
 */

import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import { log } from '../../../utils/logger.js';

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 * @returns {Promise<Array>} Array of doctors with unread note counts
 */
export async function getDoctorsWithUnreadCounts() {
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

    return executeQuery(
        query,
        [],
        (columns) => ({
            DrID: columns[0].value,
            DoctorName: columns[1].value,
            UnreadDoctorNotes: columns[2].value || 0
        })
    );
}

/**
 * Get all aligner doctors (simple list)
 * @returns {Promise<Array>} Array of doctors
 */
export async function getAllDoctors() {
    const query = `
        SELECT DrID, DoctorName, DoctorEmail, LogoPath
        FROM AlignerDoctors
        ORDER BY DoctorName
    `;

    return executeQuery(
        query,
        [],
        (columns) => ({
            DrID: columns[0].value,
            DoctorName: columns[1].value,
            DoctorEmail: columns[2].value,
            LogoPath: columns[3].value
        })
    );
}

/**
 * Check if doctor email exists (excluding specific doctor)
 * @param {string} email - Email to check
 * @param {number} excludeDrID - Doctor ID to exclude from check
 * @returns {Promise<boolean>} True if email exists
 */
export async function isDoctorEmailTaken(email, excludeDrID = null) {
    if (!email || email.trim() === '') {
        return false;
    }

    let query = 'SELECT DrID FROM AlignerDoctors WHERE DoctorEmail = @email';
    const params = [['email', TYPES.NVarChar, email.trim()]];

    if (excludeDrID) {
        query += ' AND DrID != @drID';
        params.push(['drID', TYPES.Int, parseInt(excludeDrID)]);
    }

    const result = await executeQuery(
        query,
        params,
        (columns) => columns[0].value
    );

    return result && result.length > 0;
}

/**
 * Get count of aligner sets for a doctor
 * @param {number} drID - Doctor ID
 * @returns {Promise<number>} Number of sets
 */
export async function getDoctorSetCount(drID) {
    const result = await executeQuery(
        'SELECT COUNT(*) as SetCount FROM tblAlignerSets WHERE AlignerDrID = @drID',
        [['drID', TYPES.Int, parseInt(drID)]],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : 0;
}

/**
 * Create a new aligner doctor
 * @param {Object} doctorData - Doctor data
 * @returns {Promise<number>} New doctor ID
 */
export async function createDoctor(doctorData) {
    const { DoctorName, DoctorEmail, LogoPath } = doctorData;

    const insertQuery = `
        DECLARE @OutputTable TABLE (DrID INT);

        INSERT INTO AlignerDoctors (DoctorName, DoctorEmail, LogoPath)
        OUTPUT INSERTED.DrID INTO @OutputTable
        VALUES (@name, @email, @logo);

        SELECT DrID FROM @OutputTable;
    `;

    const result = await executeQuery(
        insertQuery,
        [
            ['name', TYPES.NVarChar, DoctorName.trim()],
            ['email', TYPES.VarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
            ['logo', TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null]
        ],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Update an aligner doctor
 * @param {number} drID - Doctor ID
 * @param {Object} doctorData - Doctor data
 * @returns {Promise<void>}
 */
export async function updateDoctor(drID, doctorData) {
    const { DoctorName, DoctorEmail, LogoPath } = doctorData;

    const updateQuery = `
        UPDATE AlignerDoctors
        SET DoctorName = @name,
            DoctorEmail = @email,
            LogoPath = @logo
        WHERE DrID = @drID
    `;

    await executeQuery(
        updateQuery,
        [
            ['name', TYPES.NVarChar, DoctorName.trim()],
            ['email', TYPES.NVarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
            ['logo', TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null],
            ['drID', TYPES.Int, parseInt(drID)]
        ]
    );
}

/**
 * Delete an aligner doctor
 * @param {number} drID - Doctor ID
 * @returns {Promise<void>}
 */
export async function deleteDoctor(drID) {
    await executeQuery(
        'DELETE FROM AlignerDoctors WHERE DrID = @drID',
        [['drID', TYPES.Int, parseInt(drID)]]
    );
}

// ==============================
// ALIGNER SETS QUERIES
// ==============================

/**
 * Get all aligner sets from v_allsets view
 * @returns {Promise<Array>} Array of all aligner sets
 */
export async function getAllAlignerSets() {
    const query = `
        SELECT
            v.PersonID,
            v.PatientName,
            v.WorkID,
            v.AlignerDrID,
            v.AlignerSetID,
            v.SetSequence,
            v.SetIsActive,
            v.BatchSequence,
            v.CreationDate,
            v.BatchCreationDate,
            v.ManufactureDate,
            v.DeliveredToPatientDate,
            v.NextBatchReadyDate,
            v.Notes,
            v.IsLast,
            v.NextBatchPresent,
            v.LabStatus,
            ad.DoctorName,
            w.Status as WorkStatus,
            ws.StatusName as WorkStatusName
        FROM dbo.v_allsets v
        INNER JOIN AlignerDoctors ad ON v.AlignerDrID = ad.DrID
        INNER JOIN tblwork w ON v.WorkID = w.workid
        LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
        ORDER BY
            CASE WHEN v.SetIsActive = 1 THEN 0 ELSE 1 END,
            CASE WHEN v.NextBatchPresent = 'False' THEN 0 ELSE 1 END,
            v.NextBatchReadyDate ASC,
            v.PatientName
    `;

    return executeQuery(
        query,
        [],
        (columns) => ({
            PersonID: columns[0].value,
            PatientName: columns[1].value,
            WorkID: columns[2].value,
            AlignerDrID: columns[3].value,
            AlignerSetID: columns[4].value,
            SetSequence: columns[5].value,
            SetIsActive: columns[6].value,
            BatchSequence: columns[7].value,
            CreationDate: columns[8].value,
            BatchCreationDate: columns[9].value,
            ManufactureDate: columns[10].value,
            DeliveredToPatientDate: columns[11].value,
            NextBatchReadyDate: columns[12].value,
            Notes: columns[13].value,
            IsLast: columns[14].value,
            NextBatchPresent: columns[15].value,
            LabStatus: columns[16].value,
            DoctorName: columns[17].value,
            WorkStatus: columns[18].value,
            WorkStatusName: columns[19].value
        })
    );
}

/**
 * Get aligner sets for a specific work ID
 * @param {number} workId - Work ID
 * @returns {Promise<Array>} Array of aligner sets
 */
export async function getAlignerSetsByWorkId(workId) {
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

    return executeQuery(
        query,
        [['workId', TYPES.Int, parseInt(workId)]],
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
}

/**
 * Get a single aligner set by ID
 * @param {number} setId - Aligner set ID
 * @returns {Promise<Object|null>} Aligner set or null
 */
export async function getAlignerSetById(setId) {
    const query = `
        SELECT
            AlignerSetID, WorkID, SetSequence, Type,
            UpperAlignersCount, LowerAlignersCount,
            RemainingUpperAligners, RemainingLowerAligners,
            CreationDate, Days, IsActive, Notes,
            FolderPath, AlignerDrID, SetUrl, SetPdfUrl,
            SetVideo, SetCost, Currency
        FROM tblAlignerSets
        WHERE AlignerSetID = @setId
    `;

    const result = await executeQuery(
        query,
        [['setId', TYPES.Int, parseInt(setId)]],
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
            Currency: columns[18].value
        })
    );

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Create a new aligner set with business logic
 * Deactivates other sets if creating an active set
 * @param {Object} setData - Set data
 * @returns {Promise<number>} New set ID
 */
export async function createAlignerSet(setData) {
    const startTime = Date.now();
    const {
        WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
        Days, AlignerDrID, SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive
    } = setData;

    const afterExtraction = Date.now();
    console.log(`⏱️  [DB QUERY TIMING] Parameter extraction took: ${afterExtraction - startTime}ms`);

    const query = `
        DECLARE @OutputTable TABLE (AlignerSetID INT);

        -- Deactivate all other sets for this work if creating an active set
        IF @IsActive = 1
        BEGIN
            UPDATE tblAlignerSets
            SET IsActive = 0
            WHERE WorkID = @WorkID AND IsActive = 1;
        END

        -- Insert new set with remaining aligners = total aligners
        INSERT INTO tblAlignerSets (
            WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
            RemainingUpperAligners, RemainingLowerAligners, Days, AlignerDrID,
            SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive, CreationDate
        )
        OUTPUT INSERTED.AlignerSetID INTO @OutputTable
        VALUES (
            @WorkID, @SetSequence, @Type, @UpperAlignersCount, @LowerAlignersCount,
            @UpperAlignersCount, @LowerAlignersCount, @Days, @AlignerDrID,
            @SetUrl, @SetPdfUrl, @SetCost, @Currency, @Notes, @IsActive, GETDATE()
        );

        SELECT AlignerSetID FROM @OutputTable;
    `;

    const beforeExecute = Date.now();
    console.log(`⏱️  [DB QUERY TIMING] Query preparation took: ${beforeExecute - afterExtraction}ms`);

    const result = await executeQuery(
        query,
        [
            ['WorkID', TYPES.Int, parseInt(WorkID)],
            ['SetSequence', TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
            ['Type', TYPES.NVarChar, Type || null],
            ['UpperAlignersCount', TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
            ['LowerAlignersCount', TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
            ['Days', TYPES.Int, Days ? parseInt(Days) : null],
            ['AlignerDrID', TYPES.Int, parseInt(AlignerDrID)],
            ['SetUrl', TYPES.NVarChar, SetUrl || null],
            ['SetPdfUrl', TYPES.NVarChar, SetPdfUrl || null],
            ['SetCost', TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
            ['Currency', TYPES.NVarChar, Currency || null],
            ['Notes', TYPES.NVarChar, Notes || null],
            ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true]
        ],
        (columns) => columns[0].value
    );

    const afterExecute = Date.now();
    console.log(`⏱️  [DB QUERY TIMING] SQL execution took: ${afterExecute - beforeExecute}ms`);
    console.log(`⏱️  [DB QUERY TIMING] Total createAlignerSet() took: ${afterExecute - startTime}ms`);

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Update an aligner set
 * @param {number} setId - Set ID
 * @param {Object} setData - Set data to update
 * @returns {Promise<void>}
 */
export async function updateAlignerSet(setId, setData) {
    const {
        SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
        Days, AlignerDrID, SetUrl, SetPdfUrl, SetVideo,
        SetCost, Currency, Notes, IsActive
    } = setData;

    const newUpperCount = UpperAlignersCount ? parseInt(UpperAlignersCount) : 0;
    const newLowerCount = LowerAlignersCount ? parseInt(LowerAlignersCount) : 0;

    // First, get current set data to validate the change
    const currentSet = await getAlignerSetById(setId);
    if (!currentSet) {
        throw new Error(`Aligner set ${setId} not found`);
    }

    // Calculate how many aligners are already used in batches
    const usedUpper = currentSet.UpperAlignersCount - currentSet.RemainingUpperAligners;
    const usedLower = currentSet.LowerAlignersCount - currentSet.RemainingLowerAligners;

    // Validate: new total cannot be less than what's already used in batches
    if (newUpperCount < usedUpper) {
        throw new Error(`Cannot reduce upper aligners to ${newUpperCount}. ${usedUpper} are already assigned to batches.`);
    }
    if (newLowerCount < usedLower) {
        throw new Error(`Cannot reduce lower aligners to ${newLowerCount}. ${usedLower} are already assigned to batches.`);
    }

    // Update the set and adjust remaining counts by the delta
    // RemainingUpperAligners += (NewUpperCount - OldUpperCount)
    // RemainingLowerAligners += (NewLowerCount - OldLowerCount)
    const query = `
        UPDATE tblAlignerSets
        SET
            SetSequence = @SetSequence,
            Type = @Type,
            RemainingUpperAligners = RemainingUpperAligners + (@UpperAlignersCount - UpperAlignersCount),
            RemainingLowerAligners = RemainingLowerAligners + (@LowerAlignersCount - LowerAlignersCount),
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

    await executeQuery(
        query,
        [
            ['SetSequence', TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
            ['Type', TYPES.NVarChar, Type || null],
            ['UpperAlignersCount', TYPES.Int, newUpperCount],
            ['LowerAlignersCount', TYPES.Int, newLowerCount],
            ['Days', TYPES.Int, Days ? parseInt(Days) : null],
            ['AlignerDrID', TYPES.Int, AlignerDrID ? parseInt(AlignerDrID) : null],
            ['SetUrl', TYPES.NVarChar, SetUrl || null],
            ['SetPdfUrl', TYPES.NVarChar, SetPdfUrl || null],
            ['SetVideo', TYPES.NVarChar, SetVideo || null],
            ['SetCost', TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
            ['Currency', TYPES.NVarChar, Currency || null],
            ['Notes', TYPES.NVarChar, Notes || null],
            ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true],
            ['setId', TYPES.Int, parseInt(setId)]
        ]
    );
}

/**
 * Delete batches for a set
 * @param {number} setId - Set ID
 * @returns {Promise<void>}
 */
export async function deleteBatchesBySetId(setId) {
    await executeQuery(
        'DELETE FROM tblAlignerBatches WHERE AlignerSetID = @setId',
        [['setId', TYPES.Int, parseInt(setId)]]
    );
}

/**
 * Delete an aligner set
 * @param {number} setId - Set ID
 * @returns {Promise<void>}
 */
export async function deleteAlignerSet(setId) {
    await executeQuery(
        'DELETE FROM tblAlignerSets WHERE AlignerSetID = @setId',
        [['setId', TYPES.Int, parseInt(setId)]]
    );
}

// ==============================
// ALIGNER PATIENTS QUERIES
// ==============================

/**
 * Get all aligner patients (all doctors)
 * @returns {Promise<Array>} Array of patients with aligner work
 */
export async function getAllAlignerPatients() {
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

    return executeQuery(
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
}

/**
 * Get aligner patients by doctor ID
 * @param {number} doctorId - Doctor ID
 * @returns {Promise<Array>} Array of patients
 */
export async function getAlignerPatientsByDoctor(doctorId) {
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

    return executeQuery(
        query,
        [['doctorId', TYPES.Int, parseInt(doctorId)]],
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
}

/**
 * Search for aligner patients
 * @param {string} searchTerm - Search term
 * @param {number} doctorId - Optional doctor ID filter
 * @returns {Promise<Array>} Array of matching patients
 */
export async function searchAlignerPatients(searchTerm, doctorId = null) {
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

    const params = [['search', TYPES.NVarChar, `%${searchTerm}%`]];

    if (doctorId && !isNaN(parseInt(doctorId))) {
        query += ` AND s.AlignerDrID = @doctorId`;
        params.push(['doctorId', TYPES.Int, parseInt(doctorId)]);
    }

    query += ` ORDER BY p.FirstName, p.LastName`;

    return executeQuery(
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
}

// ==============================
// ALIGNER BATCHES QUERIES
// ==============================

/**
 * Get batches for a specific aligner set
 * @param {number} setId - Set ID
 * @returns {Promise<Array>} Array of batches
 */
export async function getBatchesBySetId(setId) {
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
            CreationDate,
            ManufactureDate,
            DeliveredToPatientDate,
            Days,
            ValidityPeriod,
            NextBatchReadyDate,
            Notes,
            IsActive,
            IsLast
        FROM tblAlignerBatches
        WHERE AlignerSetID = @setId
        ORDER BY BatchSequence
    `;

    return executeQuery(
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
            CreationDate: columns[9].value,
            ManufactureDate: columns[10].value,
            DeliveredToPatientDate: columns[11].value,
            Days: columns[12].value,
            ValidityPeriod: columns[13].value,
            NextBatchReadyDate: columns[14].value,
            Notes: columns[15].value,
            IsActive: columns[16].value,
            IsLast: columns[17].value
        })
    );
}

/**
 * Create a new aligner batch using optimized stored procedure
 * @param {Object} batchData - Batch data
 * @returns {Promise<number>} New batch ID
 */
export async function createBatch(batchData) {
    const {
        AlignerSetID, UpperAlignerCount, LowerAlignerCount,
        ManufactureDate, DeliveredToPatientDate, Days, Notes, IsActive,
        IncludeUpperTemplate, IncludeLowerTemplate, IsLast
    } = batchData;

    // Use executeStoredProcedure with callProcedure() - the proper way to call SPs
    // This ensures correct session settings (QUOTED_IDENTIFIER, ANSI_NULLS) are applied
    // Stored procedure now supports separate @IncludeUpperTemplate and @IncludeLowerTemplate
    const params = [
        ['AlignerSetID', TYPES.Int, parseInt(AlignerSetID)],
        ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
        ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
        ['ManufactureDate', TYPES.Date, ManufactureDate || null],
        ['DeliveredToPatientDate', TYPES.Date, DeliveredToPatientDate || null],
        ['Days', TYPES.Int, Days ? parseInt(Days) : null],
        ['Notes', TYPES.NVarChar, Notes || null],
        ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true],
        ['IsLast', TYPES.Bit, IsLast !== undefined ? IsLast : false],
        ['IncludeUpperTemplate', TYPES.Bit, IncludeUpperTemplate !== undefined ? IncludeUpperTemplate : true],
        ['IncludeLowerTemplate', TYPES.Bit, IncludeLowerTemplate !== undefined ? IncludeLowerTemplate : true]
    ];

    // Add output parameter for NewBatchID
    const beforeExec = (request) => {
        request.addOutputParameter('NewBatchID', TYPES.Int);
    };

    // Result mapper to extract output parameter
    const resultMapper = (rows, outParams) => {
        const newBatchIdParam = outParams.find(p => p.parameterName === 'NewBatchID');
        return newBatchIdParam ? newBatchIdParam.value : null;
    };

    return executeStoredProcedure(
        'usp_CreateAlignerBatch',
        params,
        beforeExec,
        null,  // rowMapper not needed
        resultMapper
    );
}

/**
 * Update an aligner batch using optimized stored procedure
 * @param {number} batchId - Batch ID
 * @param {Object} batchData - Batch data
 * @returns {Promise<void>}
 */
export async function updateBatch(batchId, batchData) {
    const {
        AlignerSetID, UpperAlignerCount, LowerAlignerCount,
        ManufactureDate, DeliveredToPatientDate, Notes, IsActive, Days,
        IncludeUpperTemplate, IncludeLowerTemplate, IsLast
    } = batchData;

    // Use executeStoredProcedure with callProcedure() - the proper way to call SPs
    // Stored procedure now supports separate @IncludeUpperTemplate and @IncludeLowerTemplate
    const params = [
        ['AlignerBatchID', TYPES.Int, parseInt(batchId)],
        ['AlignerSetID', TYPES.Int, parseInt(AlignerSetID)],
        ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
        ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
        ['ManufactureDate', TYPES.Date, ManufactureDate || null],
        ['DeliveredToPatientDate', TYPES.Date, DeliveredToPatientDate || null],
        ['Days', TYPES.Int, Days ? parseInt(Days) : null],
        ['Notes', TYPES.NVarChar, Notes || null],
        ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : null],
        ['IsLast', TYPES.Bit, IsLast !== undefined ? IsLast : null],
        ['IncludeUpperTemplate', TYPES.Bit, IncludeUpperTemplate !== undefined ? IncludeUpperTemplate : null],
        ['IncludeLowerTemplate', TYPES.Bit, IncludeLowerTemplate !== undefined ? IncludeLowerTemplate : null]
    ];

    // Row mapper for deactivated batch info (if SP returns a result set)
    const rowMapper = (columns) => ({
        DeactivatedBatchID: columns.find(c => c.metadata.colName === 'DeactivatedBatchID')?.value,
        DeactivatedBatchSequence: columns.find(c => c.metadata.colName === 'DeactivatedBatchSequence')?.value
    });

    const result = await executeStoredProcedure(
        'usp_UpdateAlignerBatch',
        params,
        null,  // no beforeExec needed
        rowMapper
    );

    // Return deactivated batch info if present
    if (result && result.length > 0 && result[0].DeactivatedBatchID) {
        return {
            deactivatedBatch: {
                batchId: result[0].DeactivatedBatchID,
                batchSequence: result[0].DeactivatedBatchSequence
            }
        };
    }

    return null;
}

/**
 * Mark batch as delivered
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function markBatchAsDelivered(batchId) {
    await executeQuery(
        'UPDATE tblAlignerBatches SET DeliveredToPatientDate = GETDATE() WHERE AlignerBatchID = @batchId',
        [['batchId', TYPES.Int, parseInt(batchId)]]
    );
}

/**
 * Mark batch as manufactured (sets ManufactureDate to today)
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function markBatchAsManufactured(batchId) {
    await executeQuery(
        'UPDATE tblAlignerBatches SET ManufactureDate = GETDATE() WHERE AlignerBatchID = @batchId AND ManufactureDate IS NULL',
        [['batchId', TYPES.Int, parseInt(batchId)]]
    );
}

/**
 * Undo manufacture - clears ManufactureDate and DeliveredToPatientDate
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function undoManufactureBatch(batchId) {
    await executeQuery(
        'UPDATE tblAlignerBatches SET ManufactureDate = NULL, DeliveredToPatientDate = NULL WHERE AlignerBatchID = @batchId',
        [['batchId', TYPES.Int, parseInt(batchId)]]
    );
}

/**
 * Undo delivery - clears only DeliveredToPatientDate
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function undoDeliverBatch(batchId) {
    await executeQuery(
        'UPDATE tblAlignerBatches SET DeliveredToPatientDate = NULL WHERE AlignerBatchID = @batchId',
        [['batchId', TYPES.Int, parseInt(batchId)]]
    );
}

/**
 * Delete a batch using optimized stored procedure
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function deleteBatch(batchId) {
    // Use executeStoredProcedure with callProcedure() - the proper way to call SPs
    await executeStoredProcedure(
        'usp_DeleteAlignerBatch',
        [['AlignerBatchID', TYPES.Int, parseInt(batchId)]]
    );
}

// ==============================
// ALIGNER NOTES QUERIES
// ==============================

/**
 * Get notes for an aligner set
 * @param {number} setId - Set ID
 * @returns {Promise<Array>} Array of notes
 */
export async function getNotesBySetId(setId) {
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

    return executeQuery(
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
            IsRead: columns[7].value,
            DoctorName: columns[8].value
        })
    );
}

/**
 * Check if aligner set exists
 * @param {number} setId - Set ID
 * @returns {Promise<boolean>} True if exists
 */
export async function alignerSetExists(setId) {
    const result = await executeQuery(
        'SELECT AlignerSetID FROM tblAlignerSets WHERE AlignerSetID = @setId',
        [['setId', TYPES.Int, parseInt(setId)]],
        (columns) => columns[0].value
    );

    return result && result.length > 0;
}

/**
 * Create a note
 * @param {number} setId - Set ID
 * @param {string} noteText - Note text
 * @param {string} noteType - Note type ('Lab' or 'Doctor')
 * @returns {Promise<number>} New note ID
 */
export async function createNote(setId, noteText, noteType = 'Lab') {
    const insertQuery = `
        INSERT INTO tblAlignerNotes (AlignerSetID, NoteType, NoteText)
        VALUES (@setId, @noteType, @noteText);
        SELECT SCOPE_IDENTITY() AS NoteID;
    `;

    const result = await executeQuery(
        insertQuery,
        [
            ['setId', TYPES.Int, parseInt(setId)],
            ['noteType', TYPES.NVarChar, noteType],
            ['noteText', TYPES.NVarChar, noteText.trim()]
        ],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Check if note exists
 * @param {number} noteId - Note ID
 * @returns {Promise<Object|null>} Note or null
 */
export async function getNoteById(noteId) {
    const result = await executeQuery(
        'SELECT NoteID, NoteType FROM tblAlignerNotes WHERE NoteID = @noteId',
        [['noteId', TYPES.Int, parseInt(noteId)]],
        (columns) => ({
            NoteID: columns[0].value,
            NoteType: columns[1].value
        })
    );

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Update a note
 * @param {number} noteId - Note ID
 * @param {string} noteText - Note text
 * @returns {Promise<void>}
 */
export async function updateNote(noteId, noteText) {
    await executeQuery(
        `UPDATE tblAlignerNotes
         SET NoteText = @noteText, IsEdited = 1, EditedAt = GETDATE()
         WHERE NoteID = @noteId`,
        [
            ['noteId', TYPES.Int, parseInt(noteId)],
            ['noteText', TYPES.NVarChar, noteText.trim()]
        ]
    );
}

/**
 * Toggle note read status
 * @param {number} noteId - Note ID
 * @returns {Promise<void>}
 */
export async function toggleNoteReadStatus(noteId) {
    await executeQuery(
        'UPDATE tblAlignerNotes SET IsRead = CASE WHEN IsRead = 1 THEN 0 ELSE 1 END WHERE NoteID = @noteId',
        [['noteId', TYPES.Int, parseInt(noteId)]]
    );
}

/**
 * Delete a note
 * @param {number} noteId - Note ID
 * @returns {Promise<void>}
 */
export async function deleteNote(noteId) {
    await executeQuery(
        'DELETE FROM tblAlignerNotes WHERE NoteID = @noteId',
        [['noteId', TYPES.Int, parseInt(noteId)]]
    );
}

/**
 * Get note read status
 * @param {number} noteId - Note ID
 * @returns {Promise<boolean|null>} Read status or null if not found
 */
export async function getNoteReadStatus(noteId) {
    const result = await executeQuery(
        'SELECT IsRead FROM tblAlignerNotes WHERE NoteID = @noteId',
        [['noteId', TYPES.Int, parseInt(noteId)]],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
}

// ==============================
// ALIGNER ACTIVITY FLAGS QUERIES
// ==============================

/**
 * Get unread activities for a set
 * @param {number} setId - Set ID
 * @returns {Promise<Array>} Array of unread activities
 */
export async function getUnreadActivitiesBySetId(setId) {
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

    return executeQuery(
        query,
        [['setId', TYPES.Int, parseInt(setId)]],
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
}

/**
 * Mark an activity as read
 * @param {number} activityId - Activity ID
 * @returns {Promise<void>}
 */
export async function markActivityAsRead(activityId) {
    await executeQuery(
        'UPDATE tblAlignerActivityFlags SET IsRead = 1, ReadAt = GETDATE() WHERE ActivityID = @activityId',
        [['activityId', TYPES.Int, parseInt(activityId)]]
    );
}

/**
 * Mark all activities for a set as read
 * @param {number} setId - Set ID
 * @returns {Promise<void>}
 */
export async function markAllActivitiesAsRead(setId) {
    await executeQuery(
        'UPDATE tblAlignerActivityFlags SET IsRead = 1, ReadAt = GETDATE() WHERE AlignerSetID = @setId AND IsRead = 0',
        [['setId', TYPES.Int, parseInt(setId)]]
    );
}

// ==============================
// ALIGNER PAYMENTS QUERIES
// ==============================

/**
 * Add payment for an aligner set
 * @param {Object} paymentData - Payment data
 * @returns {Promise<number>} New invoice ID
 */
export async function createAlignerPayment(paymentData) {
    const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } = paymentData;

    // Determine USD vs IQD based on currency (default to USD for aligner payments)
    const currency = ActualCur || 'USD';
    const amount = Math.round(parseFloat(Amountpaid)); // Round to integer for USDReceived/IQDReceived columns
    const usdReceived = currency === 'USD' ? amount : 0;
    const iqdReceived = currency === 'IQD' ? amount : 0;

    log.info('Creating aligner payment', { workid, AlignerSetID, Amountpaid, currency, usdReceived, iqdReceived });

    const query = `
        INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID, USDReceived, IQDReceived)
        VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID, @USDReceived, @IQDReceived);
        SELECT SCOPE_IDENTITY() AS invoiceID;
    `;

    const result = await executeQuery(
        query,
        [
            ['workid', TYPES.Int, parseInt(workid)],
            ['Amountpaid', TYPES.Decimal, parseFloat(Amountpaid)],
            ['Dateofpayment', TYPES.Date, new Date(Dateofpayment)],
            ['ActualAmount', TYPES.Decimal, ActualAmount ? parseFloat(ActualAmount) : null],
            ['ActualCur', TYPES.NVarChar, ActualCur || null],
            ['Change', TYPES.Decimal, Change ? parseFloat(Change) : null],
            ['AlignerSetID', TYPES.Int, AlignerSetID || null],
            ['USDReceived', TYPES.Int, usdReceived],
            ['IQDReceived', TYPES.Int, iqdReceived]
        ],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
}

/**
 * Get aligner set balance information for validation
 * @param {number} alignerSetId - Aligner Set ID
 * @returns {Promise<Object|null>} Balance info or null if not found
 */
export async function getAlignerSetBalance(alignerSetId) {
    const query = `
        SELECT AlignerSetID, SetCost, TotalPaid, Balance
        FROM vw_AlignerSetPayments
        WHERE AlignerSetID = @alignerSetId
    `;

    const result = await executeQuery(
        query,
        [['alignerSetId', TYPES.Int, parseInt(alignerSetId)]],
        (columns) => ({
            AlignerSetID: columns[0].value,
            SetCost: columns[1].value,
            TotalPaid: columns[2].value,
            Balance: columns[3].value
        })
    );

    return result && result.length > 0 ? result[0] : null;
}

// ==============================
// LABEL GENERATION QUERIES
// ==============================

/**
 * Get a single batch by ID
 * @param {number} batchId - Batch ID
 * @returns {Promise<Array>} Array with batch data (or empty)
 */
export async function getBatchById(batchId) {
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
            CreationDate,
            ManufactureDate,
            DeliveredToPatientDate,
            Days,
            Notes,
            IsActive,
            IsLast
        FROM tblAlignerBatches
        WHERE AlignerBatchID = @batchId
    `;

    return executeQuery(
        query,
        [['batchId', TYPES.Int, parseInt(batchId)]],
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
            CreationDate: columns[9].value,
            ManufactureDate: columns[10].value,
            DeliveredToPatientDate: columns[11].value,
            Days: columns[12].value,
            Notes: columns[13].value,
            IsActive: columns[14].value,
            IsLast: columns[15].value
        })
    );
}

/**
 * Get a single doctor by ID
 * @param {number} drId - Doctor ID
 * @returns {Promise<Array>} Array with doctor data (or empty)
 */
export async function getDoctorById(drId) {
    const query = `
        SELECT DrID, DoctorName, DoctorEmail, LogoPath
        FROM AlignerDoctors
        WHERE DrID = @drId
    `;

    return executeQuery(
        query,
        [['drId', TYPES.Int, parseInt(drId)]],
        (columns) => ({
            DrID: columns[0].value,
            DoctorName: columns[1].value,
            DoctorEmail: columns[2].value,
            LogoPath: columns[3].value
        })
    );
}
