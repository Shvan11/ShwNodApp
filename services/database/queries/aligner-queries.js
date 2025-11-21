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

import { executeQuery, TYPES } from '../index.js';

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
            v.BatchSequence,
            v.CreationDate,
            v.ManufactureDate,
            v.DeliveredToPatientDate,
            v.NextBatchReadyDate,
            v.Notes,
            v.NextBatchPresent,
            ad.DoctorName
        FROM dbo.v_allsets v
        INNER JOIN AlignerDoctors ad ON v.AlignerDrID = ad.DrID
        ORDER BY
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
            BatchSequence: columns[6].value,
            CreationDate: columns[7].value,
            ManufactureDate: columns[8].value,
            DeliveredToPatientDate: columns[9].value,
            NextBatchReadyDate: columns[10].value,
            Notes: columns[11].value,
            NextBatchPresent: columns[12].value,
            DoctorName: columns[13].value
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
    const {
        WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
        Days, AlignerDrID, SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive
    } = setData;

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

    await executeQuery(
        query,
        [
            ['SetSequence', TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
            ['Type', TYPES.NVarChar, Type || null],
            ['UpperAlignersCount', TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
            ['LowerAlignersCount', TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
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
            ManufactureDate: columns[9].value,
            DeliveredToPatientDate: columns[10].value,
            Days: columns[11].value,
            ValidityPeriod: columns[12].value,
            NextBatchReadyDate: columns[13].value,
            Notes: columns[14].value,
            IsActive: columns[15].value
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
        ManufactureDate, DeliveredToPatientDate, Days, Notes, IsActive
    } = batchData;

    // Call stored procedure (calculates sequences automatically)
    const query = `
        DECLARE @NewBatchID INT;

        EXEC usp_CreateAlignerBatch
            @AlignerSetID = @AlignerSetID,
            @UpperAlignerCount = @UpperAlignerCount,
            @LowerAlignerCount = @LowerAlignerCount,
            @ManufactureDate = @ManufactureDate,
            @DeliveredToPatientDate = @DeliveredToPatientDate,
            @Days = @Days,
            @Notes = @Notes,
            @IsActive = @IsActive,
            @NewBatchID = @NewBatchID OUTPUT;

        SELECT @NewBatchID AS BatchID;
    `;

    const result = await executeQuery(
        query,
        [
            ['AlignerSetID', TYPES.Int, parseInt(AlignerSetID)],
            ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
            ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
            ['ManufactureDate', TYPES.Date, ManufactureDate || null],
            ['DeliveredToPatientDate', TYPES.Date, DeliveredToPatientDate || null],
            ['Days', TYPES.Int, Days ? parseInt(Days) : null],
            ['Notes', TYPES.NVarChar, Notes || null],
            ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : true]
        ],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
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
        ManufactureDate, DeliveredToPatientDate, Notes, IsActive, Days
    } = batchData;

    // Call stored procedure (handles resequencing automatically)
    const query = `
        EXEC usp_UpdateAlignerBatch
            @AlignerBatchID = @batchId,
            @AlignerSetID = @AlignerSetID,
            @UpperAlignerCount = @UpperAlignerCount,
            @LowerAlignerCount = @LowerAlignerCount,
            @ManufactureDate = @ManufactureDate,
            @DeliveredToPatientDate = @DeliveredToPatientDate,
            @Days = @Days,
            @Notes = @Notes,
            @IsActive = @IsActive
    `;

    await executeQuery(
        query,
        [
            ['batchId', TYPES.Int, parseInt(batchId)],
            ['AlignerSetID', TYPES.Int, parseInt(AlignerSetID)],
            ['UpperAlignerCount', TYPES.Int, UpperAlignerCount ? parseInt(UpperAlignerCount) : 0],
            ['LowerAlignerCount', TYPES.Int, LowerAlignerCount ? parseInt(LowerAlignerCount) : 0],
            ['ManufactureDate', TYPES.Date, ManufactureDate || null],
            ['DeliveredToPatientDate', TYPES.Date, DeliveredToPatientDate || null],
            ['Days', TYPES.Int, Days ? parseInt(Days) : null],
            ['Notes', TYPES.NVarChar, Notes || null],
            ['IsActive', TYPES.Bit, IsActive !== undefined ? IsActive : null]
        ]
    );
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
 * Delete a batch using optimized stored procedure
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 */
export async function deleteBatch(batchId) {
    // Call stored procedure (handles remaining count restoration and resequencing)
    await executeQuery(
        'EXEC usp_DeleteAlignerBatch @AlignerBatchID = @batchId',
        [['batchId', TYPES.Int, parseInt(batchId)]]
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

    const query = `
        INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID)
        VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID);
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
            ['AlignerSetID', TYPES.Int, AlignerSetID || null]
        ],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : null;
}
