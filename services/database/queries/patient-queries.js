/**
 * Patient-related database queries
 */
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'node:readline';
import config from '../../../config/config.js';
import { createPathResolver } from '../../../utils/path-resolver.js';

/**
 * Helper function to check if a path exists
 * Non-blocking async alternative to fs.existsSync()
 * @param {string} path - The path to check
 * @returns {Promise<boolean>} - True if path exists, false otherwise
 */
async function pathExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Retrieves patient information for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with an object containing patient information.
 */
export function getInfos(PID) {
    return executeQuery(
        `SELECT p.PatientName, p.Phone, w.StartDate, p.EstimatedCost, p.Currency,
                a.AlertID, at.TypeName as AlertType, a.AlertDetails, a.AlertSeverity
         FROM dbo.tblpatients p
         LEFT OUTER JOIN (
           SELECT PersonID, StartDate
           FROM dbo.tblwork
           WHERE Status = 1
         ) w ON p.PersonID = w.PersonID
         LEFT OUTER JOIN (
           SELECT TOP 1 AlertID, PersonID, AlertTypeID, AlertDetails, AlertSeverity
           FROM dbo.tblAlerts
           WHERE PersonID = @PID AND IsActive = 1
           ORDER BY AlertSeverity DESC, CreationDate DESC
         ) a ON p.PersonID = a.PersonID
         LEFT OUTER JOIN dbo.tblAlertTypes at ON a.AlertTypeID = at.AlertTypeID
         WHERE p.PersonID = @PID`,
        [['PID', TYPES.Int, PID]],
        (columns) => ({
            name: columns[0].value,
            phone: columns[1].value,
            StartDate: columns[2].value,
            estimatedCost: columns[3].value,
            currency: columns[4].value,
            activeAlert: columns[5].value ? {
                alertId: columns[5].value,
                alertType: columns[6].value,
                alertDetails: columns[7].value,
                alertSeverity: columns[8].value
            } : null
        }),
        async (infos) => ({ ...infos[0] || {}, ...await getAssets(PID) })
    );
}

/**
 * Retrieves asset information (X-rays and other assets) for a given patient ID.
 * @param {number} pid - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with an object containing asset information.
 */
async function getAssets(pid) {
    const pathResolver = createPathResolver(config.fileSystem.machinePath);
    const xrayDir = pathResolver(`clinic1/${pid}/opg`);
    const assetsDir = pathResolver(`clinic1/${pid}/assets`);

    // Non-blocking async file operations
    const xrays = await pathExists(xrayDir)
        ? await getXrays(xrayDir, pathResolver, pid)
        : [];

    const assets = await pathExists(assetsDir)
        ? await fs.readdir(assetsDir)
        : [];

    return { xrays, assets };
}

/**
 * Retrieves X-ray information for a given directory.
 * @param {string} xrayDir - The directory path containing X-ray files.
 * @param {function} pathResolver - Path resolver function.
 * @param {string} pid - Patient ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of X-ray objects.
 */
async function getXrays(xrayDir, pathResolver, pid) {
    // Non-blocking async directory read
    const allFiles = await fs.readdir(xrayDir);
    const xrayNames = allFiles.filter((xrayName) =>
        xrayName.endsWith('.dcm') ||
        xrayName.endsWith('.pano') ||
        xrayName.endsWith('.ceph') ||
        xrayName.endsWith('.rvg') ||
        xrayName.startsWith('TASK_')
    );

    const xrays = await Promise.all(
        xrayNames.map(async (xrayName) => {
            const xray = { name: xrayName };
            const parentDetailsDirPath = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4`);

            // Non-blocking async path existence check
            if (await pathExists(parentDetailsDirPath)) {
                const subDirs = await fs.readdir(parentDetailsDirPath);
                for (const subDir of subDirs) {
                    if (subDir.endsWith(xrayName)) {
                        xray.detailsDirName = subDir;
                        const previewPath = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}/t.png`);

                        // Non-blocking async check for preview image
                        if (await pathExists(previewPath)) {
                            xray.previewImagePartialPath = `/OPG/.csi_data/.version_4.4/${subDir}/t.png`;
                        }

                        const metaFile = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}/meta`);
                        xray.date = await extractDate(metaFile);
                    }
                }
            }
            return xray;
        })
    );
    return xrays;
}

/**
 * Extracts the date from a metadata file.
 * @param {string} metaFile - The path to the metadata file.
 * @returns {Promise<string>} - A promise that resolves with the extracted date string.
 */
async function extractDate(metaFile) {
    return new Promise((resolve, reject) => {
        const fileStream = createReadStream(metaFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        let dateString = '';
        let targetLine = null;
        let lineCount = 0;

        rl.on('line', (line) => {
            lineCount++;
            if (targetLine === null && line.endsWith("'seriesDate'")) {
                targetLine = lineCount + 2;
            } else if (lineCount === targetLine) {
                dateString = line.split("'")[1];
                rl.close();
                fileStream.close();
                resolve(dateString);
            }
        });

        rl.on('error', (err) => {
            console.error('Error reading file:', err);
            reject(err);
        });
        
        // Handle case where the target line is never found
        rl.on('close', () => {
            if (!dateString) {
                resolve(null);
            }
        });
    });
}

/**
 * Retrieves patient names and phone numbers.
 * @returns {Promise<Array>} - A promise that resolves with an array of patient information objects.
 */
export function getPatientsPhones() {
    return executeQuery(
        'SELECT PersonID, PatientName, Phone FROM dbo.tblpatients',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value,
            phone: columns[2].value,
        })
    );
}

/**
 * Retrieves the active work ID for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<number>} - A promise that resolves with the active work ID.
 */
export async function getActiveWID(PID) {
    const result = await executeQuery(
        'SELECT WorkID FROM dbo.tblwork WHERE PersonID = @PID AND Status = 1',
        [['PID', TYPES.Int, PID]],
        (columns) => columns[0].value
    );
    return result[0] || null;
}

/**
 * Creates a new patient record in the database.
 * @param {Object} patientData - The patient data object.
 * @returns {Promise<Object>} - A promise that resolves with the created patient information.
 * @throws {Error} - Throws an error if a patient with the same name already exists.
 */
export async function createPatient(patientData) {
    // Check for duplicate patient name (case-insensitive)
    const duplicateCheck = await executeQuery(
        'SELECT PersonID, PatientName FROM dbo.tblpatients WHERE PatientName = @patientName',
        [['patientName', TYPES.NVarChar, patientData.patientName]],
        (columns) => ({
            personId: columns[0].value,
            patientName: columns[1].value
        })
    );

    if (duplicateCheck && duplicateCheck.length > 0) {
        const error = new Error(`A patient with the name "${patientData.patientName}" already exists.`);
        error.code = 'DUPLICATE_PATIENT_NAME';
        error.existingPatientId = duplicateCheck[0].personId;
        throw error;
    }

    const query = `
        INSERT INTO dbo.tblpatients (
            patientID, PatientName, Phone, FirstName, LastName,
            DateofBirth, Gender, Phone2, Email, AddressID,
            ReferralSourceID, PatientTypeID, Notes,
            Language, CountryCode, EstimatedCost, Currency
        )
        VALUES (
            @patientID, @patientName, @phone, @firstName, @lastName,
            @dateOfBirth, @gender, @phone2, @email, @addressID,
            @referralSourceID, @patientTypeID, @notes,
            @language, @countryCode, @estimatedCost, @currency
        );
        SELECT SCOPE_IDENTITY() AS PersonID;
    `;

    const parameters = [
        ['patientID', TYPES.NVarChar, patientData.patientID || null],
        ['patientName', TYPES.NVarChar, patientData.patientName],
        ['phone', TYPES.NVarChar, patientData.phone || null],
        ['firstName', TYPES.NVarChar, patientData.firstName || null],
        ['lastName', TYPES.NVarChar, patientData.lastName || null],
        ['dateOfBirth', TYPES.Date, patientData.dateOfBirth || null],
        ['gender', TYPES.Int, patientData.gender ? parseInt(patientData.gender) : null],
        ['phone2', TYPES.NVarChar, patientData.phone2 || null],
        ['email', TYPES.NChar, patientData.email || null],
        ['addressID', TYPES.Int, patientData.addressID ? parseInt(patientData.addressID) : null],
        ['referralSourceID', TYPES.Int, patientData.referralSourceID ? parseInt(patientData.referralSourceID) : null],
        ['patientTypeID', TYPES.Int, patientData.patientTypeID ? parseInt(patientData.patientTypeID) : null],
        ['notes', TYPES.NVarChar, patientData.notes || null],
        ['language', TYPES.TinyInt, patientData.language ? parseInt(patientData.language) : 0],
        ['countryCode', TYPES.NVarChar, patientData.countryCode || null],
        ['estimatedCost', TYPES.Int, patientData.estimatedCost ? parseInt(patientData.estimatedCost) : null],
        ['currency', TYPES.NVarChar, patientData.currency || null]
    ];

    const result = await executeQuery(
        query,
        parameters,
        (columns) => ({
            personId: columns[0].value
        })
    );

    return result[0];
}

/**
 * Retrieves all referral sources for dropdown lists.
 * @returns {Promise<Array>} - A promise that resolves with an array of referral sources.
 */
export function getReferralSources() {
    return executeQuery(
        'SELECT ID, Referral FROM dbo.tblReferrals ORDER BY Referral',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value
        })
    );
}

/**
 * Retrieves all patient types for dropdown lists.
 * @returns {Promise<Array>} - A promise that resolves with an array of patient types.
 */
export function getPatientTypes() {
    return executeQuery(
        'SELECT ID, PatientType FROM dbo.tblPatientType ORDER BY PatientType',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value
        })
    );
}

/**
 * Retrieves all addresses for dropdown lists.
 * @returns {Promise<Array>} - A promise that resolves with an array of addresses.
 */
export function getAddresses() {
    return executeQuery(
        'SELECT ID, Zone FROM dbo.tblAddress ORDER BY Zone',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value
        })
    );
}

/**
 * Retrieves all genders for dropdown lists.
 * @returns {Promise<Array>} - A promise that resolves with an array of genders.
 */
export function getGenders() {
    return executeQuery(
        'SELECT Gender_ID, Gender FROM dbo.tblGender ORDER BY Gender',
        [],
        (columns) => ({
            id: columns[0].value,
            name: columns[1].value
        })
    );
}

/**
 * Retrieves a single patient's full details by PersonID.
 * @param {number} personId - The person ID.
 * @returns {Promise<Object>} - A promise that resolves with the patient details.
 */
export async function getPatientById(personId) {
    const result = await executeQuery(
        `SELECT p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
                p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                p.AddressID, p.ReferralSourceID, p.PatientTypeID,
                p.Notes, p.Language, p.CountryCode,
                p.EstimatedCost, p.Currency, p.TagID, p.DateAdded
         FROM dbo.tblpatients p
         WHERE p.PersonID = @personId`,
        [['personId', TYPES.Int, personId]],
        (columns) => ({
            PersonID: columns[0].value,
            patientID: columns[1].value,
            PatientName: columns[2].value,
            FirstName: columns[3].value,
            LastName: columns[4].value,
            Phone: columns[5].value,
            Phone2: columns[6].value,
            Email: columns[7].value,
            DateofBirth: columns[8].value,
            Gender: columns[9].value,
            AddressID: columns[10].value,
            ReferralSourceID: columns[11].value,
            PatientTypeID: columns[12].value,
            Notes: columns[13].value,
            Language: columns[14].value,
            CountryCode: columns[15].value,
            EstimatedCost: columns[16].value,
            Currency: columns[17].value,
            TagID: columns[18].value,
            DateAdded: columns[19].value
        })
    );
    return result[0] || null;
}

/**
 * Retrieves all patients with full details.
 * @returns {Promise<Array>} - A promise that resolves with an array of all patients.
 */
export function getAllPatients() {
    return executeQuery(
        `SELECT p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
                p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                p.AddressID, p.ReferralSourceID, p.PatientTypeID,
                p.Notes, p.Language, p.CountryCode,
                g.Gender as GenderName, a.Zone as AddressName,
                r.Referral as ReferralSource, pt.PatientType as PatientTypeName
         FROM dbo.tblpatients p
         LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
         LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
         LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
         LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
         ORDER BY p.PatientName`,
        [],
        (columns) => ({
            PersonID: columns[0].value,
            patientID: columns[1].value,
            PatientName: columns[2].value,
            FirstName: columns[3].value,
            LastName: columns[4].value,
            Phone: columns[5].value,
            Phone2: columns[6].value,
            Email: columns[7].value,
            DateofBirth: columns[8].value,
            Gender: columns[9].value,
            AddressID: columns[10].value,
            ReferralSourceID: columns[11].value,
            PatientTypeID: columns[12].value,
            Notes: columns[13].value,
            Language: columns[14].value,
            CountryCode: columns[15].value,
            GenderName: columns[16].value,
            AddressName: columns[17].value,
            ReferralSource: columns[18].value,
            PatientTypeName: columns[19].value
        })
    );
}

/**
 * Updates an existing patient record.
 * @param {number} personId - The person ID.
 * @param {Object} patientData - The patient data to update.
 * @returns {Promise<Object>} - A promise that resolves with the update result.
 */
export async function updatePatient(personId, patientData) {
    const query = `
        UPDATE dbo.tblpatients
        SET patientID = @patientID,
            PatientName = @patientName,
            FirstName = @firstName,
            LastName = @lastName,
            Phone = @phone,
            Phone2 = @phone2,
            Email = @email,
            DateofBirth = @dateOfBirth,
            Gender = @gender,
            AddressID = @addressID,
            ReferralSourceID = @referralSourceID,
            PatientTypeID = @patientTypeID,
            Notes = @notes,
            Language = @language,
            CountryCode = @countryCode,
            EstimatedCost = @estimatedCost,
            Currency = @currency,
            TagID = @tagID
        WHERE PersonID = @personId
    `;

    const parameters = [
        ['personId', TYPES.Int, personId],
        ['patientID', TYPES.NVarChar, patientData.patientID || null],
        ['patientName', TYPES.NVarChar, patientData.PatientName],
        ['firstName', TYPES.NVarChar, patientData.FirstName || null],
        ['lastName', TYPES.NVarChar, patientData.LastName || null],
        ['phone', TYPES.NVarChar, patientData.Phone || null],
        ['phone2', TYPES.NVarChar, patientData.Phone2 || null],
        ['email', TYPES.NChar, patientData.Email || null],
        ['dateOfBirth', TYPES.Date, patientData.DateofBirth || null],
        ['gender', TYPES.Int, patientData.Gender ? parseInt(patientData.Gender) : null],
        ['addressID', TYPES.Int, patientData.AddressID ? parseInt(patientData.AddressID) : null],
        ['referralSourceID', TYPES.Int, patientData.ReferralSourceID ? parseInt(patientData.ReferralSourceID) : null],
        ['patientTypeID', TYPES.Int, patientData.PatientTypeID ? parseInt(patientData.PatientTypeID) : null],
        ['notes', TYPES.NVarChar, patientData.Notes || null],
        ['language', TYPES.TinyInt, patientData.Language ? parseInt(patientData.Language) : 0],
        ['countryCode', TYPES.NVarChar, patientData.CountryCode || null],
        ['estimatedCost', TYPES.Int, patientData.EstimatedCost ? parseInt(patientData.EstimatedCost) : null],
        ['currency', TYPES.NVarChar, patientData.Currency || null],
        ['tagID', TYPES.Int, patientData.TagID ? parseInt(patientData.TagID) : null]
    ];

    await executeQuery(query, parameters);
    return { success: true };

}

/**
 * Deletes a patient record.
 * @param {number} personId - The person ID.
 * @returns {Promise<Object>} - A promise that resolves with the delete result.
 */
export async function deletePatient(personId) {
    // Note: This is a hard delete with cascade in code
    // Foreign keys with NO_ACTION prevent direct deletion, so we delete related records first

    try {
        // Delete in order based on dependencies:
        // 1. Delete works (has NO_ACTION constraint)
        await executeQuery('DELETE FROM dbo.tblwork WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 2. Delete carried wires (has NO_ACTION constraint)
        await executeQuery('DELETE FROM dbo.tblCarriedWires WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 3. Delete waiting records (has NO_ACTION constraint)
        await executeQuery('DELETE FROM dbo.tblWaiting WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 4. Delete appointments (has CASCADE, but we'll explicitly delete for clarity)
        await executeQuery('DELETE FROM dbo.tblappointments WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 5. Delete opened records (has CASCADE)
        await executeQuery('DELETE FROM dbo.tblOpened WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 6. Delete screws (has CASCADE)
        await executeQuery('DELETE FROM dbo.tblscrews WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        // 7. Finally, delete the patient
        await executeQuery('DELETE FROM dbo.tblpatients WHERE PersonID = @personId', [['personId', TYPES.Int, personId]]);

        return { success: true };
    } catch (error) {
        console.error('Error in deletePatient cascade:', error);
        throw new Error(`Failed to delete patient and related records: ${error.message}`);
    }
}

/**
 * Retrieves patient data for no-work receipt from V_rptNoWork view
 * @param {number} patientId - The patient ID
 * @returns {Promise<Object|null>} - Patient data with next appointment or null if not found
 */
export async function getPatientNoWorkReceiptData(patientId) {
    try {
        const result = await executeQuery(
            `SELECT PersonID, PatientName, Phone, AppDate
             FROM dbo.V_rptNoWork
             WHERE PersonID = @patientId`,
            [['patientId', TYPES.Int, patientId]],
            (columns) => ({
                PersonID: columns[0].value,
                PatientName: columns[1].value,
                Phone: columns[2].value,
                AppDate: columns[3].value
            })
        );

        return result && result.length > 0 ? result[0] : null;
    } catch (error) {
        console.error(`[PATIENT-QUERIES] Error getting no-work receipt data for patient ${patientId}:`, error);
        throw error;
    }
}

/**
 * Checks if a patient has a future appointment scheduled
 * @param {number} patientId - The patient ID
 * @returns {Promise<boolean>} - True if patient has future appointment, false otherwise
 */
export async function hasNextAppointment(patientId) {
    try {
        const result = await executeQuery(
            `SELECT COUNT(*) as count
             FROM dbo.V_rptNoWork
             WHERE PersonID = @patientId AND AppDate IS NOT NULL`,
            [['patientId', TYPES.Int, patientId]],
            (columns) => ({ count: columns[0].value })
        );

        return result && result.length > 0 && result[0].count > 0;
    } catch (error) {
        console.error(`[PATIENT-QUERIES] Error checking appointment for patient ${patientId}:`, error);
        throw error;
    }
}