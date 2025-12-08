import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import ConnectionPool from '../ConnectionPool.js';
import { Request } from 'tedious';

/**
 * Work Status Constants
 * 1 = Active (ongoing treatment)
 * 2 = Finished (completed successfully)
 * 3 = Discontinued (abandoned by patient)
 */
export const WORK_STATUS = {
    ACTIVE: 1,
    FINISHED: 2,
    DISCONTINUED: 3
};

export const getWorksByPatient = async (personId) => {
    return executeQuery(
        `SELECT
            w.workid,
            w.PersonID,
            w.TotalRequired,
            w.Currency,
            w.Typeofwork,
            w.Notes,
            w.Status,
            w.AdditionDate,
            w.StartDate,
            w.DebondDate,
            w.FPhotoDate,
            w.IPhotoDate,
            w.EstimatedDuration,
            w.DrID,
            w.NotesDate,
            w.KeyWordID1,
            w.KeyWordID2,
            w.KeywordID3,
            w.KeywordID4,
            w.KeywordID5,
            e.employeeName as DoctorName,
            wt.WorkType as TypeName,
            ws.StatusName,
            k1.KeyWord as Keyword1,
            k2.KeyWord as Keyword2,
            k3.KeyWord as Keyword3,
            k4.KeyWord as Keyword4,
            k5.KeyWord as Keyword5,
            CASE
                WHEN w.Status = 2 THEN 'Completed'
                WHEN w.Status = 3 THEN 'Discontinued'
                WHEN w.StartDate IS NOT NULL THEN 'In Progress'
                ELSE 'Planned'
            END as WorkStatus,
            COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
        LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
        LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
        LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
        LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
        LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
        LEFT JOIN tblInvoice i ON w.workid = i.workid
        WHERE w.PersonID = @PersonID
        GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes,
                 w.Status, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate,
                 w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1,
                 w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
                 e.employeeName, wt.WorkType, ws.StatusName, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord
        ORDER BY w.AdditionDate DESC`,
        [['PersonID', TYPES.Int, personId]],
        (columns) => {
            const work = {};
            columns.forEach(column => {
                work[column.metadata.colName] = column.value;
            });
            return work;
        }
    );
};

export const getWorkDetails = async (workId) => {
    return executeQuery(
        `SELECT
            w.*,
            e.employeeName as DoctorName,
            wt.WorkType as TypeName,
            ws.StatusName,
            k1.KeyWord as Keyword1,
            k2.KeyWord as Keyword2,
            k3.KeyWord as Keyword3,
            k4.KeyWord as Keyword4,
            k5.KeyWord as Keyword5,
            p.PatientName,
            COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
        LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
        LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
        LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
        LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
        LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
        LEFT JOIN tblpatients p ON w.PersonID = p.PersonID
        LEFT JOIN tblInvoice i ON w.workid = i.workid
        WHERE w.workid = @WorkID
        GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes,
                 w.Status, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate,
                 w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1,
                 w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
                 e.employeeName, wt.WorkType, ws.StatusName, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord,
                 p.PatientName`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => {
            const result = {};
            columns.forEach(column => {
                result[column.metadata.colName] = column.value;
            });
            return result;
        },
        (results) => results.length > 0 ? results[0] : null
    );
};

export const getWorkDetailsList = async (workId) => {
    return executeQuery(
        `SELECT
            wi.ID,
            wi.WorkID,
            wi.FillingType,
            wi.FillingDepth,
            wi.CanalsNo,
            wi.WorkingLength,
            wi.ImplantLength,
            wi.ImplantDiameter,
            wi.Material,
            wi.LabName,
            wi.ItemCost,
            wi.StartDate,
            wi.CompletedDate,
            wi.Note,
            STRING_AGG(tn.ToothCode, ', ') AS Teeth,
            STRING_AGG(CAST(tn.ID AS VARCHAR), ',') AS TeethIds
        FROM tblWorkItems wi
        LEFT JOIN tblWorkItemTeeth wit ON wi.ID = wit.WorkItemID
        LEFT JOIN tblToothNumber tn ON wit.ToothID = tn.ID
        WHERE wi.WorkID = @WorkID
        GROUP BY wi.ID, wi.WorkID, wi.FillingType, wi.FillingDepth,
                 wi.CanalsNo, wi.WorkingLength, wi.ImplantLength, wi.ImplantDiameter,
                 wi.Material, wi.LabName, wi.ItemCost, wi.StartDate, wi.CompletedDate, wi.Note
        ORDER BY wi.ID`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => {
            const detail = {};
            columns.forEach(column => {
                detail[column.metadata.colName] = column.value;
            });
            // Convert TeethIds string to array of integers
            if (detail.TeethIds) {
                detail.TeethIds = detail.TeethIds.split(',').map(id => parseInt(id));
            } else {
                detail.TeethIds = [];
            }
            return detail;
        }
    );
};

// Alias for new naming convention
export const getWorkItems = getWorkDetailsList;

export const addWorkDetail = async (workDetailData) => {
    // Insert the work item with all type-specific fields
    const result = await executeQuery(
        `INSERT INTO tblWorkItems (
            WorkID, FillingType, FillingDepth, CanalsNo, WorkingLength,
            ImplantLength, ImplantDiameter, Material, LabName,
            ItemCost, StartDate, CompletedDate, Note
        ) VALUES (
            @WorkID, @FillingType, @FillingDepth, @CanalsNo, @WorkingLength,
            @ImplantLength, @ImplantDiameter, @Material, @LabName,
            @ItemCost, @StartDate, @CompletedDate, @Note
        );
        SELECT SCOPE_IDENTITY() as ID;`,
        [
            ['WorkID', TYPES.Int, workDetailData.WorkID],
            ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
            ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
            ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
            ['WorkingLength', TYPES.NVarChar, workDetailData.WorkingLength || null],
            ['ImplantLength', TYPES.Decimal, workDetailData.ImplantLength || null],
            ['ImplantDiameter', TYPES.Decimal, workDetailData.ImplantDiameter || null],
            ['Material', TYPES.NVarChar, workDetailData.Material || null],
            ['LabName', TYPES.NVarChar, workDetailData.LabName || null],
            ['ItemCost', TYPES.Int, workDetailData.ItemCost || null],
            ['StartDate', TYPES.Date, workDetailData.StartDate || null],
            ['CompletedDate', TYPES.Date, workDetailData.CompletedDate || null],
            ['Note', TYPES.NVarChar, workDetailData.Note || null]
        ],
        (columns) => {
            return { ID: columns[0].value };
        },
        (results) => results.length > 0 ? results[0] : null
    );

    // If teeth are provided, add them to junction table
    if (result && result.ID && workDetailData.TeethIds && workDetailData.TeethIds.length > 0) {
        await setWorkItemTeeth(result.ID, workDetailData.TeethIds);
    }

    return result;
};

// Alias for new naming convention
export const addWorkItem = addWorkDetail;

export const updateWorkDetail = async (detailId, workDetailData) => {
    // Update the work item with all type-specific fields
    const result = await executeQuery(
        `UPDATE tblWorkItems SET
            FillingType = @FillingType,
            FillingDepth = @FillingDepth,
            CanalsNo = @CanalsNo,
            WorkingLength = @WorkingLength,
            ImplantLength = @ImplantLength,
            ImplantDiameter = @ImplantDiameter,
            Material = @Material,
            LabName = @LabName,
            ItemCost = @ItemCost,
            StartDate = @StartDate,
            CompletedDate = @CompletedDate,
            Note = @Note
        WHERE ID = @ID`,
        [
            ['ID', TYPES.Int, detailId],
            ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
            ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
            ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
            ['WorkingLength', TYPES.NVarChar, workDetailData.WorkingLength || null],
            ['ImplantLength', TYPES.Decimal, workDetailData.ImplantLength || null],
            ['ImplantDiameter', TYPES.Decimal, workDetailData.ImplantDiameter || null],
            ['Material', TYPES.NVarChar, workDetailData.Material || null],
            ['LabName', TYPES.NVarChar, workDetailData.LabName || null],
            ['ItemCost', TYPES.Int, workDetailData.ItemCost || null],
            ['StartDate', TYPES.Date, workDetailData.StartDate || null],
            ['CompletedDate', TYPES.Date, workDetailData.CompletedDate || null],
            ['Note', TYPES.NVarChar, workDetailData.Note || null]
        ],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );

    // If teeth are provided, update the junction table
    if (workDetailData.TeethIds !== undefined) {
        await setWorkItemTeeth(detailId, workDetailData.TeethIds || []);
    }

    return result;
};

// Alias for new naming convention
export const updateWorkItem = updateWorkDetail;

export const deleteWorkDetail = async (detailId) => {
    return executeQuery(
        `DELETE FROM tblWorkItems WHERE ID = @ID`,
        [['ID', TYPES.Int, detailId]],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

// Alias for new naming convention
export const deleteWorkItem = deleteWorkDetail;

export const addWork = async (workData) => {
    // Determine Status: default to Active, or use provided Status
    const status = workData.Status || WORK_STATUS.ACTIVE;

    return executeQuery(
        `INSERT INTO tblwork (
            PersonID, TotalRequired, Currency, Typeofwork, Notes, Status,
            StartDate, DebondDate, FPhotoDate, IPhotoDate, EstimatedDuration,
            DrID, NotesDate, KeyWordID1, KeyWordID2, KeywordID3, KeywordID4, KeywordID5
        ) VALUES (
            @PersonID, @TotalRequired, @Currency, @Typeofwork, @Notes, @Status,
            @StartDate, @DebondDate, @FPhotoDate, @IPhotoDate, @EstimatedDuration,
            @DrID, @NotesDate, @KeyWordID1, @KeyWordID2, @KeywordID3, @KeywordID4, @KeywordID5
        );
        SELECT SCOPE_IDENTITY() as workid;`,
        [
            ['PersonID', TYPES.Int, workData.PersonID],
            ['TotalRequired', TYPES.Int, workData.TotalRequired ?? null],
            ['Currency', TYPES.NVarChar, workData.Currency || null],
            ['Typeofwork', TYPES.Int, workData.Typeofwork ?? null],
            ['Notes', TYPES.NVarChar, workData.Notes || null],
            ['Status', TYPES.TinyInt, status],
            ['StartDate', TYPES.Date, workData.StartDate || null],
            ['DebondDate', TYPES.Date, workData.DebondDate || null],
            ['FPhotoDate', TYPES.Date, workData.FPhotoDate || null],
            ['IPhotoDate', TYPES.Date, workData.IPhotoDate || null],
            ['EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration ?? null],
            ['DrID', TYPES.Int, workData.DrID],
            ['NotesDate', TYPES.Date, workData.NotesDate || null],
            ['KeyWordID1', TYPES.Int, workData.KeyWordID1 || null],
            ['KeyWordID2', TYPES.Int, workData.KeyWordID2 || null],
            ['KeywordID3', TYPES.Int, workData.KeywordID3 || null],
            ['KeywordID4', TYPES.Int, workData.KeywordID4 || null],
            ['KeywordID5', TYPES.Int, workData.KeywordID5 || null]
        ],
        (columns) => {
            return { workid: columns[0].value };
        },
        (results) => results.length > 0 ? results[0] : null
    );
};

export const updateWork = async (workId, workData) => {
    // Build dynamic UPDATE query - only update fields that are provided
    const fieldMappings = {
        TotalRequired: { param: 'TotalRequired', type: TYPES.Int, value: workData.TotalRequired ?? null }, // Use ?? to preserve 0
        Currency: { param: 'Currency', type: TYPES.NVarChar, value: workData.Currency || null },
        Typeofwork: { param: 'Typeofwork', type: TYPES.Int, value: workData.Typeofwork ?? null }, // Use ?? to preserve 0
        Notes: { param: 'Notes', type: TYPES.NVarChar, value: workData.Notes || null },
        Status: { param: 'Status', type: TYPES.TinyInt, value: workData.Status ?? WORK_STATUS.ACTIVE }, // Use ?? to preserve 0
        StartDate: { param: 'StartDate', type: TYPES.Date, value: workData.StartDate || null },
        DebondDate: { param: 'DebondDate', type: TYPES.Date, value: workData.DebondDate || null },
        FPhotoDate: { param: 'FPhotoDate', type: TYPES.Date, value: workData.FPhotoDate || null },
        IPhotoDate: { param: 'IPhotoDate', type: TYPES.Date, value: workData.IPhotoDate || null },
        EstimatedDuration: { param: 'EstimatedDuration', type: TYPES.TinyInt, value: workData.EstimatedDuration || null },
        DrID: { param: 'DrID', type: TYPES.Int, value: workData.DrID },
        NotesDate: { param: 'NotesDate', type: TYPES.Date, value: workData.NotesDate || null },
        KeyWordID1: { param: 'KeyWordID1', type: TYPES.Int, value: workData.KeyWordID1 || null },
        KeyWordID2: { param: 'KeyWordID2', type: TYPES.Int, value: workData.KeyWordID2 || null },
        KeywordID3: { param: 'KeywordID3', type: TYPES.Int, value: workData.KeywordID3 || null },
        KeywordID4: { param: 'KeywordID4', type: TYPES.Int, value: workData.KeywordID4 || null },
        KeywordID5: { param: 'KeywordID5', type: TYPES.Int, value: workData.KeywordID5 || null }
    };

    // Only include fields that are present in workData
    const setClause = [];
    const parameters = [['WorkID', TYPES.Int, workId]];

    Object.keys(fieldMappings).forEach(field => {
        if (workData.hasOwnProperty(field)) {
            const mapping = fieldMappings[field];
            setClause.push(`${field} = @${mapping.param}`);
            parameters.push([mapping.param, mapping.type, mapping.value]);
        }
    });

    // If no fields to update, return early
    if (setClause.length === 0) {
        return { success: true, rowCount: 0 };
    }

    const query = `UPDATE tblwork SET ${setClause.join(', ')} WHERE workid = @WorkID`;

    return executeQuery(
        query,
        parameters,
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

export const finishWork = async (workId) => {
    return executeQuery(
        `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
        [
            ['WorkID', TYPES.Int, workId],
            ['Status', TYPES.TinyInt, WORK_STATUS.FINISHED]
        ],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

/**
 * Mark a work as discontinued (patient abandoned treatment)
 * @param {number} workId - Work ID to discontinue
 * @returns {Promise<Object>} - Result with success status
 */
export const discontinueWork = async (workId) => {
    return executeQuery(
        `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
        [
            ['WorkID', TYPES.Int, workId],
            ['Status', TYPES.TinyInt, WORK_STATUS.DISCONTINUED]
        ],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

/**
 * Reactivate a work (change from discontinued/finished back to active)
 * @param {number} workId - Work ID to reactivate
 * @returns {Promise<Object>} - Result with success status
 */
export const reactivateWork = async (workId) => {
    return executeQuery(
        `UPDATE tblwork SET Status = @Status WHERE workid = @WorkID`,
        [
            ['WorkID', TYPES.Int, workId],
            ['Status', TYPES.TinyInt, WORK_STATUS.ACTIVE]
        ],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

/**
 * Add work with invoice using SQL transaction
 * Creates a finished work and a full payment invoice atomically
 * @param {Object} workData - Work data including all work fields
 * @returns {Promise<Object>} - { workId, invoiceId }
 */
export const addWorkWithInvoice = async (workData) => {
    const today = new Date().toISOString().split('T')[0];
    let connection = null;

    try {
        // Get connection from pool
        connection = await ConnectionPool.getConnection();

        // Use a single SQL batch with transaction control
        const result = await new Promise((resolve, reject) => {
            let workId = null;
            let invoiceId = null;

            const usdReceived = (workData.Currency === 'USD' || workData.Currency === 'EUR') ? workData.TotalRequired : 0;
            const iqdReceived = workData.Currency === 'IQD' ? workData.TotalRequired : 0;

            const request = new Request(
                `BEGIN TRANSACTION;

                DECLARE @workId INT;

                INSERT INTO tblwork (
                    PersonID, TotalRequired, Currency, Typeofwork, Notes, Status,
                    StartDate, DebondDate, FPhotoDate, IPhotoDate, EstimatedDuration,
                    DrID, NotesDate, KeyWordID1, KeyWordID2, KeywordID3, KeywordID4, KeywordID5
                )
                VALUES (
                    @PersonID, @TotalRequired, @Currency, @Typeofwork, @Notes, 2,
                    @StartDate, @DebondDate, @FPhotoDate, @IPhotoDate, @EstimatedDuration,
                    @DrID, @NotesDate, @KeyWordID1, @KeyWordID2, @KeywordID3, @KeywordID4, @KeywordID5
                );

                SET @workId = SCOPE_IDENTITY();

                INSERT INTO dbo.tblInvoice (workid, Amountpaid, Dateofpayment, USDReceived, IQDReceived, Change)
                VALUES (@workId, @TotalRequired, @paymentDate, @usdReceived, @iqdReceived, @change);

                COMMIT TRANSACTION;

                SELECT @workId AS workId, SCOPE_IDENTITY() AS invoiceId;`,
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ workId, invoiceId });
                    }
                }
            );

            request.on('row', (columns) => {
                workId = columns[0].value;
                invoiceId = columns[1].value;
            });

            request.addParameter('PersonID', TYPES.Int, workData.PersonID);
            request.addParameter('TotalRequired', TYPES.Int, workData.TotalRequired ?? null);
            request.addParameter('Currency', TYPES.NVarChar, workData.Currency || null);
            request.addParameter('Typeofwork', TYPES.Int, workData.Typeofwork ?? null);
            request.addParameter('Notes', TYPES.NVarChar, workData.Notes || null);
            request.addParameter('StartDate', TYPES.Date, workData.StartDate || null);
            request.addParameter('DebondDate', TYPES.Date, workData.DebondDate || null);
            request.addParameter('FPhotoDate', TYPES.Date, workData.FPhotoDate || null);
            request.addParameter('IPhotoDate', TYPES.Date, workData.IPhotoDate || null);
            request.addParameter('EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration ?? null);
            request.addParameter('DrID', TYPES.Int, workData.DrID);
            request.addParameter('NotesDate', TYPES.Date, workData.NotesDate || null);
            request.addParameter('KeyWordID1', TYPES.Int, workData.KeyWordID1 || null);
            request.addParameter('KeyWordID2', TYPES.Int, workData.KeyWordID2 || null);
            request.addParameter('KeywordID3', TYPES.Int, workData.KeywordID3 || null);
            request.addParameter('KeywordID4', TYPES.Int, workData.KeywordID4 || null);
            request.addParameter('KeywordID5', TYPES.Int, workData.KeywordID5 || null);
            request.addParameter('paymentDate', TYPES.Date, today);
            request.addParameter('usdReceived', TYPES.Int, usdReceived);
            request.addParameter('iqdReceived', TYPES.Int, iqdReceived);
            request.addParameter('change', TYPES.Int, null);

            connection.execSql(request);
        });

        return result;

    } catch (error) {
        throw error;
    } finally {
        if (connection) {
            ConnectionPool.releaseConnection(connection);
        }
    }
};

export const deleteWork = async (workId) => {
    // Check for dependencies before deletion
    const dependencyCheck = await executeQuery(
        `SELECT
            (SELECT COUNT(*) FROM tblInvoice WHERE workid = @WorkID) AS InvoiceCount,
            (SELECT COUNT(*) FROM tblvisits WHERE WorkID = @WorkID) AS VisitCount,
            (SELECT COUNT(*) FROM tblWorkItems WHERE WorkID = @WorkID) AS ItemCount,
            (SELECT COUNT(*) FROM tblDiagnosis WHERE WorkID = @WorkID) AS DiagnosisCount,
            (SELECT COUNT(*) FROM tblImplant WHERE WorkID = @WorkID) AS ImplantCount,
            (SELECT COUNT(*) FROM tblscrews WHERE WorkID = @WorkID) AS ScrewCount`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => ({
            InvoiceCount: columns[0].value,
            VisitCount: columns[1].value,
            ItemCount: columns[2].value,
            DiagnosisCount: columns[3].value,
            ImplantCount: columns[4].value,
            ScrewCount: columns[5].value
        }),
        (results) => results[0]
    );

    // Return dependency information if any exist
    if (dependencyCheck.InvoiceCount > 0 || dependencyCheck.VisitCount > 0 ||
        dependencyCheck.ItemCount > 0 || dependencyCheck.DiagnosisCount > 0 ||
        dependencyCheck.ImplantCount > 0 || dependencyCheck.ScrewCount > 0) {
        return {
            canDelete: false,
            dependencies: dependencyCheck
        };
    }

    // If no dependencies, proceed with deletion
    const result = await executeQuery(
        `DELETE FROM tblwork WHERE workid = @WorkID`,
        [['WorkID', TYPES.Int, workId]],
        null,
        (results) => ({
            success: true,
            rowCount: results.length || 0
        })
    );

    return {
        canDelete: true,
        success: result.success,
        rowCount: result.rowCount
    };
};

export const getActiveWork = async (personId) => {
    return executeQuery(
        `SELECT TOP 1
            w.*,
            e.employeeName as DoctorName,
            wt.WorkType as TypeName,
            ws.StatusName
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
        WHERE w.PersonID = @PersonID AND w.Status = 1
        ORDER BY w.AdditionDate DESC`,
        [['PersonID', TYPES.Int, personId]],
        (columns) => {
            const result = {};
            columns.forEach(column => {
                result[column.metadata.colName] = column.value;
            });
            return result;
        },
        (results) => results.length > 0 ? results[0] : null
    );
};

/**
 * Get work by ID with full details
 * @param {number} workId - Work ID
 * @returns {Promise<Object|null>} Work object or null if not found
 */
export const getWorkById = async (workId) => {
    return executeQuery(
        `SELECT
            w.*,
            e.employeeName as DoctorName,
            wt.WorkType as TypeName,
            ws.StatusName
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
        WHERE w.workid = @WorkID`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => {
            const result = {};
            columns.forEach(column => {
                result[column.metadata.colName] = column.value;
            });
            return result;
        },
        (results) => results.length > 0 ? results[0] : null
    );
};

/**
 * Validate status transition for a work
 * Prevents multiple active works per patient (enforces UNQ_tblWork_Active constraint)
 * @param {number} workId - Work ID being updated
 * @param {number} newStatus - New status value (1=Active, 2=Finished, 3=Discontinued)
 * @param {number} personId - Patient ID (required for Active status validation)
 * @returns {Promise<{valid: boolean, error?: string, existingWork?: Object}>}
 */
export const validateStatusChange = async (workId, newStatus, personId) => {
    // If changing to Active (1), check for existing active work
    if (newStatus === WORK_STATUS.ACTIVE && personId) {
        const activeWork = await getActiveWork(personId);

        // If there's an active work and it's NOT the one being updated
        if (activeWork && activeWork.workid !== workId) {
            return {
                valid: false,
                error: 'Patient already has an active work',
                existingWork: {
                    workid: activeWork.workid,
                    type: activeWork.TypeName,
                    doctor: activeWork.DoctorName
                }
            };
        }
    }

    return { valid: true };
};

export const getWorkTypes = async () => {
    return executeQuery(
        `SELECT ID, WorkType
        FROM tblWorkType
        ORDER BY WorkType`,
        [],
        (columns) => {
            const workType = {};
            columns.forEach(column => {
                workType[column.metadata.colName] = column.value;
            });
            return workType;
        }
    );
};

export const getWorkKeywords = async () => {
    return executeQuery(
        `SELECT ID, KeyWord
        FROM tblKeyWord
        ORDER BY KeyWord`,
        [],
        (columns) => {
            const keyword = {};
            columns.forEach(column => {
                keyword[column.metadata.colName] = column.value;
            });
            return keyword;
        }
    );
};

// ===== TOOTH NUMBER FUNCTIONS =====

/**
 * Get all tooth numbers for dropdowns/selection
 * @param {boolean} includePermanent - Include permanent teeth (default: true)
 * @param {boolean} includeDeciduous - Include deciduous teeth (default: true)
 * @returns {Promise<Array>} Array of tooth objects
 */
export const getToothNumbers = async (includePermanent = true, includeDeciduous = true) => {
    let whereClause = '';
    if (includePermanent && !includeDeciduous) {
        whereClause = 'WHERE IsPermanent = 1';
    } else if (!includePermanent && includeDeciduous) {
        whereClause = 'WHERE IsPermanent = 0';
    }

    return executeQuery(
        `SELECT ID, ToothCode, ToothName, Quadrant, ToothNumber, IsPermanent, SortOrder
        FROM tblToothNumber
        ${whereClause}
        ORDER BY SortOrder`,
        [],
        (columns) => {
            const tooth = {};
            columns.forEach(column => {
                tooth[column.metadata.colName] = column.value;
            });
            return tooth;
        }
    );
};

/**
 * Set teeth for a work item (replaces existing teeth)
 * @param {number} workItemId - Work item ID
 * @param {Array<number>} teethIds - Array of tooth IDs
 * @returns {Promise<Object>} Result with success status
 */
export const setWorkItemTeeth = async (workItemId, teethIds) => {
    // First, delete existing teeth for this work item
    await executeQuery(
        `DELETE FROM tblWorkItemTeeth WHERE WorkItemID = @WorkItemID`,
        [['WorkItemID', TYPES.Int, workItemId]],
        null,
        () => ({ success: true })
    );

    // If no teeth to add, return early
    if (!teethIds || teethIds.length === 0) {
        return { success: true, count: 0 };
    }

    // Insert new teeth
    const values = teethIds.map((_, index) => `(@WorkItemID, @ToothID${index})`).join(', ');
    const params = [['WorkItemID', TYPES.Int, workItemId]];
    teethIds.forEach((toothId, index) => {
        params.push([`ToothID${index}`, TYPES.Int, toothId]);
    });

    await executeQuery(
        `INSERT INTO tblWorkItemTeeth (WorkItemID, ToothID) VALUES ${values}`,
        params,
        null,
        () => ({ success: true })
    );

    return { success: true, count: teethIds.length };
};

/**
 * Get teeth for a specific work item
 * @param {number} workItemId - Work item ID
 * @returns {Promise<Array>} Array of tooth objects
 */
export const getWorkItemTeeth = async (workItemId) => {
    return executeQuery(
        `SELECT tn.ID, tn.ToothCode, tn.ToothName, tn.Quadrant, tn.IsPermanent
        FROM tblWorkItemTeeth wit
        INNER JOIN tblToothNumber tn ON wit.ToothID = tn.ID
        WHERE wit.WorkItemID = @WorkItemID
        ORDER BY tn.SortOrder`,
        [['WorkItemID', TYPES.Int, workItemId]],
        (columns) => {
            const tooth = {};
            columns.forEach(column => {
                tooth[column.metadata.colName] = column.value;
            });
            return tooth;
        }
    );
};

