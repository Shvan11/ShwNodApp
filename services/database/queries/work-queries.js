import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

export const getWorksByPatient = async (personId) => {
    return executeQuery(
        `SELECT 
            w.workid,
            w.PersonID,
            w.TotalRequired,
            w.Currency,
            w.Typeofwork,
            w.Notes,
            w.Finished,
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
            k1.KeyWord as Keyword1,
            k2.KeyWord as Keyword2,
            k3.KeyWord as Keyword3,
            k4.KeyWord as Keyword4,
            k5.KeyWord as Keyword5,
            CASE 
                WHEN w.Finished = 1 THEN 'Completed'
                WHEN w.StartDate IS NOT NULL THEN 'In Progress'
                ELSE 'Planned'
            END as WorkStatus,
            COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
        LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
        LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
        LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
        LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
        LEFT JOIN tblInvoice i ON w.workid = i.workid
        WHERE w.PersonID = @PersonID
        GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes, 
                 w.Finished, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate, 
                 w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1, 
                 w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
                 e.employeeName, wt.WorkType, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord
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
        LEFT JOIN tblKeyWord k1 ON w.KeyWordID1 = k1.ID
        LEFT JOIN tblKeyWord k2 ON w.KeyWordID2 = k2.ID
        LEFT JOIN tblKeyWord k3 ON w.KeywordID3 = k3.ID
        LEFT JOIN tblKeyWord k4 ON w.KeywordID4 = k4.ID
        LEFT JOIN tblKeyWord k5 ON w.KeywordID5 = k5.ID
        LEFT JOIN tblpatients p ON w.PersonID = p.PersonID
        LEFT JOIN tblInvoice i ON w.workid = i.workid
        WHERE w.workid = @WorkID
        GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.Notes, 
                 w.Finished, w.AdditionDate, w.StartDate, w.DebondDate, w.FPhotoDate, 
                 w.IPhotoDate, w.EstimatedDuration, w.DrID, w.NotesDate, w.KeyWordID1, 
                 w.KeyWordID2, w.KeywordID3, w.KeywordID4, w.KeywordID5,
                 e.employeeName, wt.WorkType, k1.KeyWord, k2.KeyWord, k3.KeyWord, k4.KeyWord, k5.KeyWord,
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
            wd.ID,
            wd.WorkID,
            wd.Tooth,
            wd.FillingType,
            wd.FillingDepth,
            wd.CanalsNo,
            wd.Note
        FROM tblWorkDetails wd
        WHERE wd.WorkID = @WorkID
        ORDER BY wd.ID`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => {
            const detail = {};
            columns.forEach(column => {
                detail[column.metadata.colName] = column.value;
            });
            return detail;
        }
    );
};

export const addWorkDetail = async (workDetailData) => {
    return executeQuery(
        `INSERT INTO tblWorkDetails (
            WorkID, Tooth, FillingType, FillingDepth, CanalsNo, Note
        ) VALUES (
            @WorkID, @Tooth, @FillingType, @FillingDepth, @CanalsNo, @Note
        );
        SELECT SCOPE_IDENTITY() as ID;`,
        [
            ['WorkID', TYPES.Int, workDetailData.WorkID],
            ['Tooth', TYPES.NVarChar, workDetailData.Tooth || null],
            ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
            ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
            ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
            ['Note', TYPES.NVarChar, workDetailData.Note || null]
        ],
        (columns) => {
            return { ID: columns[0].value };
        },
        (results) => results.length > 0 ? results[0] : null
    );
};

export const updateWorkDetail = async (detailId, workDetailData) => {
    return executeQuery(
        `UPDATE tblWorkDetails SET
            Tooth = @Tooth,
            FillingType = @FillingType,
            FillingDepth = @FillingDepth,
            CanalsNo = @CanalsNo,
            Note = @Note
        WHERE ID = @ID`,
        [
            ['ID', TYPES.Int, detailId],
            ['Tooth', TYPES.NVarChar, workDetailData.Tooth || null],
            ['FillingType', TYPES.NVarChar, workDetailData.FillingType || null],
            ['FillingDepth', TYPES.NVarChar, workDetailData.FillingDepth || null],
            ['CanalsNo', TYPES.Int, workDetailData.CanalsNo || null],
            ['Note', TYPES.NVarChar, workDetailData.Note || null]
        ],
        null,
        (results, outputParams) => ({ 
            success: true, 
            rowCount: results.length || 0
        })
    );
};

export const deleteWorkDetail = async (detailId) => {
    return executeQuery(
        `DELETE FROM tblWorkDetails WHERE ID = @ID`,
        [['ID', TYPES.Int, detailId]],
        null,
        (results, outputParams) => ({ 
            success: true, 
            rowCount: results.length || 0
        })
    );
};

export const addWork = async (workData) => {
    return executeQuery(
        `INSERT INTO tblwork (
            PersonID, TotalRequired, Currency, Typeofwork, Notes, Finished,
            StartDate, DebondDate, FPhotoDate, IPhotoDate, EstimatedDuration,
            DrID, NotesDate, KeyWordID1, KeyWordID2, KeywordID3, KeywordID4, KeywordID5
        ) VALUES (
            @PersonID, @TotalRequired, @Currency, @Typeofwork, @Notes, @Finished,
            @StartDate, @DebondDate, @FPhotoDate, @IPhotoDate, @EstimatedDuration,
            @DrID, @NotesDate, @KeyWordID1, @KeyWordID2, @KeywordID3, @KeywordID4, @KeywordID5
        );
        SELECT SCOPE_IDENTITY() as workid;`,
        [
            ['PersonID', TYPES.Int, workData.PersonID],
            ['TotalRequired', TYPES.Int, workData.TotalRequired ?? null], // Use ?? to allow 0 as valid value
            ['Currency', TYPES.NVarChar, workData.Currency || null],
            ['Typeofwork', TYPES.Int, workData.Typeofwork ?? null], // Use ?? to allow 0 as valid value if needed
            ['Notes', TYPES.NVarChar, workData.Notes || null],
            ['Finished', TYPES.Bit, workData.Finished || 0],
            ['StartDate', TYPES.Date, workData.StartDate || null],
            ['DebondDate', TYPES.Date, workData.DebondDate || null],
            ['FPhotoDate', TYPES.Date, workData.FPhotoDate || null],
            ['IPhotoDate', TYPES.Date, workData.IPhotoDate || null],
            ['EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration ?? null], // Use ?? to allow 0 as valid value
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
    return executeQuery(
        `UPDATE tblwork SET
            TotalRequired = @TotalRequired,
            Currency = @Currency,
            Typeofwork = @Typeofwork,
            Notes = @Notes,
            Finished = @Finished,
            StartDate = @StartDate,
            DebondDate = @DebondDate,
            FPhotoDate = @FPhotoDate,
            IPhotoDate = @IPhotoDate,
            EstimatedDuration = @EstimatedDuration,
            DrID = @DrID,
            NotesDate = @NotesDate,
            KeyWordID1 = @KeyWordID1,
            KeyWordID2 = @KeyWordID2,
            KeywordID3 = @KeywordID3,
            KeywordID4 = @KeywordID4,
            KeywordID5 = @KeywordID5
        WHERE workid = @WorkID`,
        [
            ['WorkID', TYPES.Int, workId],
            ['TotalRequired', TYPES.Int, workData.TotalRequired || null],
            ['Currency', TYPES.NVarChar, workData.Currency || null],
            ['Typeofwork', TYPES.Int, workData.Typeofwork || null],
            ['Notes', TYPES.NVarChar, workData.Notes || null],
            ['Finished', TYPES.Bit, workData.Finished || 0],
            ['StartDate', TYPES.Date, workData.StartDate || null],
            ['DebondDate', TYPES.Date, workData.DebondDate || null],
            ['FPhotoDate', TYPES.Date, workData.FPhotoDate || null],
            ['IPhotoDate', TYPES.Date, workData.IPhotoDate || null],
            ['EstimatedDuration', TYPES.TinyInt, workData.EstimatedDuration || null],
            ['DrID', TYPES.Int, workData.DrID],
            ['NotesDate', TYPES.Date, workData.NotesDate || null],
            ['KeyWordID1', TYPES.Int, workData.KeyWordID1 || null],
            ['KeyWordID2', TYPES.Int, workData.KeyWordID2 || null],
            ['KeywordID3', TYPES.Int, workData.KeywordID3 || null],
            ['KeywordID4', TYPES.Int, workData.KeywordID4 || null],
            ['KeywordID5', TYPES.Int, workData.KeywordID5 || null]
        ],
        null,
        (results, outputParams) => ({ 
            success: true, 
            rowCount: results.length || 0
        })
    );
};

export const finishWork = async (workId) => {
    return executeQuery(
        `UPDATE tblwork SET Finished = 1 WHERE workid = @WorkID`,
        [['WorkID', TYPES.Int, workId]],
        null,
        (results, outputParams) => ({
            success: true,
            rowCount: results.length || 0
        })
    );
};

export const deleteWork = async (workId) => {
    // Check for dependencies before deletion
    const dependencyCheck = await executeQuery(
        `SELECT
            (SELECT COUNT(*) FROM tblInvoice WHERE workid = @WorkID) AS InvoiceCount,
            (SELECT COUNT(*) FROM tblvisits WHERE WorkID = @WorkID) AS VisitCount,
            (SELECT COUNT(*) FROM tblWorkDetails WHERE WorkID = @WorkID) AS DetailCount,
            (SELECT COUNT(*) FROM tblDiagnosis WHERE WorkID = @WorkID) AS DiagnosisCount,
            (SELECT COUNT(*) FROM tblImplant WHERE WorkID = @WorkID) AS ImplantCount,
            (SELECT COUNT(*) FROM tblscrews WHERE WorkID = @WorkID) AS ScrewCount`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => ({
            InvoiceCount: columns[0].value,
            VisitCount: columns[1].value,
            DetailCount: columns[2].value,
            DiagnosisCount: columns[3].value,
            ImplantCount: columns[4].value,
            ScrewCount: columns[5].value
        }),
        (results) => results[0]
    );

    // Return dependency information if any exist
    if (dependencyCheck.InvoiceCount > 0 || dependencyCheck.VisitCount > 0 ||
        dependencyCheck.DetailCount > 0 || dependencyCheck.DiagnosisCount > 0 ||
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
        (results, outputParams) => ({
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
            wt.WorkType as TypeName
        FROM tblwork w
        LEFT JOIN tblEmployees e ON w.DrID = e.ID
        LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
        WHERE w.PersonID = @PersonID AND w.Finished = 0
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

export const getWorkTypes = async () => {
    return executeQuery(
        `SELECT ID, WorkType as TypeName
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

