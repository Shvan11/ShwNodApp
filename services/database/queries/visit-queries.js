/**
 * Visit and wire-related database queries
 */
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import { getActiveWID } from './patient-queries.js';

/**
 * Retrieves visit summaries for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of visit summary objects.
 */
export async function getVisitsSummary(PID) {
    const WID = await getActiveWID(PID);
    return executeStoredProcedure(
        'ProVisitSum',
        [['WID', TYPES.Int, WID]],
        null,
        (columns) => ({
            PatientName: columns[0].value,
            WorkID: columns[1].value,
            ID: columns[2].value,
            VisitDate: columns[3].value,
            OPG: columns[4].value,
            IPhoto: columns[5].value,
            FPhoto: columns[6].value,
            PPhoto: columns[7].value,
            ApplianceRemoved: columns[8].value,
            Summary: columns[9].value,
        })
    );
}

/**
 * Retrieves the latest visit summary for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with the latest visit summary object.
 */
export async function getLatestVisitsSum(PID) {
    const WID = await getActiveWID(PID);
    return executeStoredProcedure(
        'ProlatestVisitSum',
        [['WID', TYPES.Int, WID]],
        null,
        (columns) => ({
            VisitDate: columns[0].value,
            Summary: columns[1].value,
        }),
        (result) => result[0]
    );
}

/**
 * Adds a new visit for a given patient ID.
 * @param {number} PID - The patient ID.
 * @param {Date} visitDate - The visit date.
 * @param {number} upperWireID - The ID of the upper wire.
 * @param {number} lowerWireID - The ID of the lower wire.
 * @param {string} others - Other information.
 * @param {string} next - Next visit information.
 * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating the success of the operation.
 */
export async function addVisit(PID, visitDate, upperWireID, lowerWireID, others, next) {
    const WID = await getActiveWID(PID);
    return executeStoredProcedure(
        'proAddVisit',
        [
            ['WID', TYPES.Int, WID],
            ['visitDate', TYPES.Date, visitDate],
            ['upperWireID', TYPES.Int, upperWireID],
            ['lowerWireID', TYPES.Int, lowerWireID],
            ['others', TYPES.NVarChar, others],
            ['next', TYPES.NVarChar, next],
        ],
        null,
        null,
        () => true
    );
}

/**
 * Retrieves visit details by visit ID.
 * @param {number} VID - The visit ID.
 * @returns {Promise<Object>} - A promise that resolves with an object containing visit details.
 */
export async function getVisitDetailsByID(VID) {
    return executeStoredProcedure(
        'proGetVisitSum',
        [['VID', TYPES.Int, VID]],
        null,
        (columns) => ({
            visitDate: columns[0].value,
            upperWireID: columns[1].value,
            lowerWireID: columns[2].value,
            others: columns[3].value,
            next: columns[4].value,
        }),
        (result) => result[0]
    );
}

/**
 * Updates a visit by visit ID.
 * @param {number} VID - The visit ID.
 * @param {Date} visitDate - The visit date.
 * @param {number} upperWireID - The ID of the upper wire.
 * @param {number} lowerWireID - The ID of the lower wire.
 * @param {string} others - Other information.
 * @param {string} next - Next visit information.
 * @returns {Promise<Object>} - A promise that resolves with an object indicating the success of the operation.
 */
export async function updateVisit(VID, visitDate, upperWireID, lowerWireID, others, next) {
    return executeQuery(
        `UPDATE dbo.tblVisits
         SET VisitDate = @visitDate, UpperWireID = @upperWireID, LowerWireID = @lowerWireID, Others = @others, NextVisit = @next
         WHERE ID = @VID`,
        [
            ['VID', TYPES.Int, VID],
            ['visitDate', TYPES.Date, visitDate],
            ['upperWireID', TYPES.Int, upperWireID],
            ['lowerWireID', TYPES.Int, lowerWireID],
            ['others', TYPES.NVarChar, others],
            ['next', TYPES.NVarChar, next],
        ],
        null,
        () => ({ success: true })
    );
}

/**
 * Deletes a visit by visit ID.
 * @param {number} VID - The visit ID.
 * @returns {Promise<Object>} - A promise that resolves with an object indicating the success of the operation.
 */
export async function deleteVisit(VID) {
    return executeQuery(
        'DELETE FROM dbo.tblVisits WHERE ID = @VID',
        [['VID', TYPES.Int, VID]],
        null,
        () => ({ success: true })
    );
}

/**
 * Retrieves available wires.
 * @returns {Promise<Array>} - A promise that resolves with an array of wire objects.
 */
export function getWires() {
    return executeQuery(
        'SELECT Wire_ID as id, Wire as name FROM dbo.tblWires ORDER BY Wire',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value,
        })
    );
}

/**
 * Retrieves the latest wire IDs for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with an object containing the latest upper and lower wire IDs.
 */
export async function getLatestWire(PID) {
    const WID = await getActiveWID(PID);
    return executeStoredProcedure(
        'proGetLatestWire',
        [['WID', TYPES.Int, WID]],
        null,
        (columns) => ({
            upperWireID: columns[0].value,
            lowerWireID: columns[1].value,
        }),
        (result) => result && result.length > 0 ? result[0] : null
    );
}

/**
 * Retrieves all visits for a specific work ID (not dependent on active work).
 * @param {number} workId - The work ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of visit objects.
 */
export async function getVisitsByWorkId(workId) {
    return executeQuery(
        `SELECT
            v.ID,
            v.WorkID,
            v.VisitDate,
            v.BracketChange,
            v.WireBending,
            v.OPG,
            v.Others,
            v.NextVisit,
            v.Elastics,
            v.UpperWireID,
            v.LowerWireID,
            v.PPhoto,
            v.IPhoto,
            v.FPhoto,
            v.ApplianceRemoved,
            v.OperatorID,
            uw.Wire as UpperWireName,
            lw.Wire as LowerWireName,
            e.employeeName as OperatorName
        FROM tblvisits v
        LEFT JOIN tblWires uw ON v.UpperWireID = uw.Wire_ID
        LEFT JOIN tblWires lw ON v.LowerWireID = lw.Wire_ID
        LEFT JOIN tblEmployees e ON v.OperatorID = e.ID
        WHERE v.WorkID = @WorkID
        ORDER BY v.VisitDate ASC`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => {
            const visit = {};
            columns.forEach(column => {
                visit[column.metadata.colName] = column.value;
            });
            return visit;
        }
    );
}

/**
 * Retrieves a single visit by visit ID.
 * @param {number} visitId - The visit ID.
 * @returns {Promise<Object>} - A promise that resolves with the visit object.
 */
export async function getVisitById(visitId) {
    return executeQuery(
        `SELECT
            v.ID,
            v.WorkID,
            v.VisitDate,
            v.BracketChange,
            v.WireBending,
            v.OPG,
            v.Others,
            v.NextVisit,
            v.Elastics,
            v.UpperWireID,
            v.LowerWireID,
            v.PPhoto,
            v.IPhoto,
            v.FPhoto,
            v.ApplianceRemoved,
            v.OperatorID,
            uw.Wire as UpperWireName,
            lw.Wire as LowerWireName,
            e.employeeName as OperatorName
        FROM tblvisits v
        LEFT JOIN tblWires uw ON v.UpperWireID = uw.Wire_ID
        LEFT JOIN tblWires lw ON v.LowerWireID = lw.Wire_ID
        LEFT JOIN tblEmployees e ON v.OperatorID = e.ID
        WHERE v.ID = @VisitID`,
        [['VisitID', TYPES.Int, visitId]],
        (columns) => {
            const visit = {};
            columns.forEach(column => {
                visit[column.metadata.colName] = column.value;
            });
            return visit;
        },
        (results) => results.length > 0 ? results[0] : null
    );
}

/**
 * Adds a new visit with workId directly (not dependent on active work).
 * @param {Object} visitData - The visit data object.
 * @returns {Promise<Object>} - A promise that resolves with the new visit ID.
 */
export async function addVisitByWorkId(visitData) {
    return executeQuery(
        `INSERT INTO tblvisits (
            WorkID, VisitDate, BracketChange, WireBending, OPG, Others,
            NextVisit, Elastics, UpperWireID, LowerWireID, PPhoto, IPhoto,
            FPhoto, ApplianceRemoved, OperatorID
        ) VALUES (
            @WorkID, @VisitDate, @BracketChange, @WireBending, @OPG, @Others,
            @NextVisit, @Elastics, @UpperWireID, @LowerWireID, @PPhoto, @IPhoto,
            @FPhoto, @ApplianceRemoved, @OperatorID
        );
        SELECT SCOPE_IDENTITY() as ID;`,
        [
            ['WorkID', TYPES.Int, visitData.WorkID],
            ['VisitDate', TYPES.DateTime2, visitData.VisitDate],
            ['BracketChange', TYPES.NVarChar, visitData.BracketChange || null],
            ['WireBending', TYPES.NVarChar, visitData.WireBending || null],
            ['OPG', TYPES.Bit, visitData.OPG || false],
            ['Others', TYPES.NVarChar, visitData.Others || null],
            ['NextVisit', TYPES.NVarChar, visitData.NextVisit || null],
            ['Elastics', TYPES.NVarChar, visitData.Elastics || null],
            ['UpperWireID', TYPES.Int, visitData.UpperWireID || null],
            ['LowerWireID', TYPES.Int, visitData.LowerWireID || null],
            ['PPhoto', TYPES.Bit, visitData.PPhoto || false],
            ['IPhoto', TYPES.Bit, visitData.IPhoto || false],
            ['FPhoto', TYPES.Bit, visitData.FPhoto || false],
            ['ApplianceRemoved', TYPES.Bit, visitData.ApplianceRemoved || false],
            ['OperatorID', TYPES.Int, visitData.OperatorID || null]
        ],
        (columns) => {
            return { ID: columns[0].value };
        },
        (results) => results.length > 0 ? results[0] : null
    );
}

/**
 * Updates a visit by visit ID.
 * @param {number} visitId - The visit ID.
 * @param {Object} visitData - The visit data object.
 * @returns {Promise<Object>} - A promise that resolves with success status.
 */
export async function updateVisitByWorkId(visitId, visitData) {
    return executeQuery(
        `UPDATE tblvisits SET
            VisitDate = @VisitDate,
            BracketChange = @BracketChange,
            WireBending = @WireBending,
            OPG = @OPG,
            Others = @Others,
            NextVisit = @NextVisit,
            Elastics = @Elastics,
            UpperWireID = @UpperWireID,
            LowerWireID = @LowerWireID,
            PPhoto = @PPhoto,
            IPhoto = @IPhoto,
            FPhoto = @FPhoto,
            ApplianceRemoved = @ApplianceRemoved,
            OperatorID = @OperatorID
        WHERE ID = @VisitID`,
        [
            ['VisitID', TYPES.Int, visitId],
            ['VisitDate', TYPES.DateTime2, visitData.VisitDate],
            ['BracketChange', TYPES.NVarChar, visitData.BracketChange || null],
            ['WireBending', TYPES.NVarChar, visitData.WireBending || null],
            ['OPG', TYPES.Bit, visitData.OPG || false],
            ['Others', TYPES.NVarChar, visitData.Others || null],
            ['NextVisit', TYPES.NVarChar, visitData.NextVisit || null],
            ['Elastics', TYPES.NVarChar, visitData.Elastics || null],
            ['UpperWireID', TYPES.Int, visitData.UpperWireID || null],
            ['LowerWireID', TYPES.Int, visitData.LowerWireID || null],
            ['PPhoto', TYPES.Bit, visitData.PPhoto || false],
            ['IPhoto', TYPES.Bit, visitData.IPhoto || false],
            ['FPhoto', TYPES.Bit, visitData.FPhoto || false],
            ['ApplianceRemoved', TYPES.Bit, visitData.ApplianceRemoved || false],
            ['OperatorID', TYPES.Int, visitData.OperatorID || null]
        ],
        null,
        () => ({ success: true })
    );
}

/**
 * Deletes a visit by visit ID.
 * @param {number} visitId - The visit ID.
 * @returns {Promise<Object>} - A promise that resolves with success status.
 */
export async function deleteVisitByWorkId(visitId) {
    return executeQuery(
        'DELETE FROM tblvisits WHERE ID = @VisitID',
        [['VisitID', TYPES.Int, visitId]],
        null,
        () => ({ success: true })
    );
}