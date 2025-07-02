/**
 * Patient-related database queries
 */
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';
import fs from 'fs';
import * as readline from 'node:readline';
import config from '../../../config/config.js';
import { createPathResolver } from '../../../utils/path-resolver.js';

/**
 * Retrieves patient information for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with an object containing patient information.
 */
export function getInfos(PID) {
    return executeQuery(
        `SELECT p.PatientName, p.Phone, w.StartDate
         FROM dbo.tblpatients p
         LEFT OUTER JOIN (
           SELECT PersonID, StartDate
           FROM dbo.tblwork
           WHERE Finished = 0
         ) w ON p.PersonID = w.PersonID
         WHERE p.PersonID = @PID`,
        [['PID', TYPES.Int, PID]],
        (columns) => ({
            name: columns[0].value,
            phone: columns[1].value,
            StartDate: columns[2].value,
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

    const xrays = fs.existsSync(xrayDir)
        ? await getXrays(xrayDir, pathResolver, pid)
        : [];

    const assets = fs.existsSync(assetsDir)
        ? fs.readdirSync(assetsDir)
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
    const xrayNames = fs.readdirSync(xrayDir).filter((xrayName) =>
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
            if (fs.existsSync(parentDetailsDirPath)) {
                const subDirs = fs.readdirSync(parentDetailsDirPath);
                for (const subDir of subDirs) {
                    if (subDir.endsWith(xrayName)) {
                        xray.detailsDirName = subDir;
                        const detailsDirPath = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}`);
                        if (fs.existsSync(pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}/t.png`))) {
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
        const fileStream = fs.createReadStream(metaFile);
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
        'SELECT WorkID FROM dbo.tblwork WHERE PersonID = @PID AND Finished = 0',
        [['PID', TYPES.Int, PID]],
        (columns) => columns[0].value
    );
    return result[0] || null;
}

/**
 * Creates a new patient record in the database.
 * @param {Object} patientData - The patient data object.
 * @returns {Promise<Object>} - A promise that resolves with the created patient information.
 */
export async function createPatient(patientData) {
    const query = `
        INSERT INTO dbo.tblpatients (
            patientID, PatientName, Phone, FirstName, LastName, 
            DateofBirth, Gender, Phone2, Email, AddressID,
            ReferralSourceID, PatientTypeID, Notes, Alerts, 
            Language, CountryCode
        ) 
        OUTPUT INSERTED.PersonID
        VALUES (
            @patientID, @patientName, @phone, @firstName, @lastName,
            @dateOfBirth, @gender, @phone2, @email, @addressID,
            @referralSourceID, @patientTypeID, @notes, @alerts, 
            @language, @countryCode
        )
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
        ['alerts', TYPES.NVarChar, patientData.alerts || null],
        ['language', TYPES.TinyInt, patientData.language ? parseInt(patientData.language) : 0],
        ['countryCode', TYPES.NVarChar, patientData.countryCode || null]
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