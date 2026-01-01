/**
 * Patient-related database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'node:readline';
import { executeQuery, TYPES, SqlParam } from '../index.js';
import config from '../../../config/config.js';
import { createPathResolver } from '../../../utils/path-resolver.js';
import { log } from '../../../utils/logger.js';

// Type definitions
interface PatientInfo {
  PersonID: number;
  patientID: string | null;
  PatientName: string | null;
  FirstName: string | null;
  LastName: string | null;
  Phone: string | null;
  Phone2: string | null;
  Email: string | null;
  DateOfBirth: string | null;
  Gender: number | null;
  GenderDisplay: string | null;
  Address: string | null;
  ReferralSource: string | null;
  PatientType: string | null;
  Tag: string | null;
  Notes: string | null;
  Language: number | null;
  CountryCode: string | null;
  EstimatedCost: number | null;
  Currency: string | null;
  DolphinId: number | null;
  DateAdded: string | null;
  AlertCount: number;
  // Legacy fields for backwards compatibility
  name: string | null;
  phone: string | null;
  StartDate: Date | null;
  estimatedCost: number | null;
  currency: string | null;
  activeAlert: ActiveAlert | null;
}

interface ActiveAlert {
  alertId: number;
  alertType: string;
  alertDetails: string;
  alertSeverity: number;
}

interface PatientAssets {
  xrays: XrayInfo[];
  assets: string[];
}

interface XrayInfo {
  name: string;
  detailsDirName?: string;
  previewImagePartialPath?: string;
  date?: string | null;
}

interface PatientPhone {
  id: number;
  name: string;
  phone: string;
}

interface PatientData {
  patientID?: string;
  patientName: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  gender?: string | number;
  phone2?: string;
  email?: string;
  addressID?: string | number;
  referralSourceID?: string | number;
  patientTypeID?: string | number;
  notes?: string;
  language?: string | number;
  countryCode?: string;
  estimatedCost?: string | number;
  currency?: string;
}

interface CreatePatientResult {
  personId: number;
}

interface LookupItem {
  id: number;
  name: string;
}

interface PatientDetails {
  PersonID: number;
  patientID: string | null;
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
  Notes: string | null;
  Language: number | null;
  CountryCode: string | null;
  EstimatedCost: number | null;
  Currency: string | null;
  TagID: number | null;
  DateAdded: Date | null;
}

interface PatientWithRelations extends PatientDetails {
  GenderName: string | null;
  AddressName: string | null;
  ReferralSource: string | null;
  PatientTypeName: string | null;
}

interface UpdatePatientData {
  patientID?: string;
  PatientName: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Phone2?: string;
  Email?: string;
  DateofBirth?: Date;
  Gender?: string | number;
  AddressID?: string | number;
  ReferralSourceID?: string | number;
  PatientTypeID?: string | number;
  Notes?: string;
  Language?: string | number;
  CountryCode?: string;
  EstimatedCost?: string | number;
  Currency?: string;
  TagID?: string | number;
}

interface NoWorkReceiptData {
  PersonID: number;
  PatientName: string;
  Phone: string | null;
  AppDate: Date | null;
}

interface DuplicatePatientError extends Error {
  code: string;
  existingPatientId: number;
}

/**
 * Helper function to check if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieves patient information for a given patient ID.
 * Returns full patient details with all related lookup values.
 */
export async function getInfos(PID: number): Promise<PatientInfo & PatientAssets> {
  const infos = await executeQuery<PatientInfo>(
    `SELECT
            p.PersonID,
            p.patientID,
            p.PatientName,
            p.FirstName,
            p.LastName,
            p.Phone,
            p.Phone2,
            p.Email,
            CONVERT(varchar, p.DateofBirth, 23) as DateOfBirth,
            p.Gender,
            g.Gender as GenderDisplay,
            a.Zone as Address,
            r.Referral as ReferralSource,
            pt.PatientType,
            tag.Tag,
            p.Notes,
            p.Language,
            p.CountryCode,
            p.EstimatedCost,
            p.Currency,
            NULL as DolphinId,
            CONVERT(varchar, p.DateAdded, 23) as DateAdded,
            (SELECT COUNT(*) FROM dbo.tblAlerts WHERE PersonID = @PID AND IsActive = 1) as AlertCount,
            w.StartDate,
            alert.AlertID,
            at.TypeName as AlertType,
            alert.AlertDetails,
            alert.AlertSeverity
     FROM dbo.tblpatients p
     LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
     LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
     LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
     LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
     LEFT JOIN dbo.tblTagOptions tag ON p.TagID = tag.ID
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
     ) alert ON p.PersonID = alert.PersonID
     LEFT OUTER JOIN dbo.tblAlertTypes at ON alert.AlertTypeID = at.AlertTypeID
     WHERE p.PersonID = @PID`,
    [['PID', TYPES.Int, PID]],
    (columns: ColumnValue[]) => ({
      PersonID: columns[0].value as number,
      patientID: columns[1].value as string | null,
      PatientName: columns[2].value as string | null,
      FirstName: columns[3].value as string | null,
      LastName: columns[4].value as string | null,
      Phone: columns[5].value as string | null,
      Phone2: columns[6].value as string | null,
      Email: columns[7].value as string | null,
      DateOfBirth: columns[8].value as string | null,
      Gender: columns[9].value as number | null,
      GenderDisplay: columns[10].value as string | null,
      Address: columns[11].value as string | null,
      ReferralSource: columns[12].value as string | null,
      PatientType: columns[13].value as string | null,
      Tag: columns[14].value as string | null,
      Notes: columns[15].value as string | null,
      Language: columns[16].value as number | null,
      CountryCode: columns[17].value as string | null,
      EstimatedCost: columns[18].value as number | null,
      Currency: columns[19].value as string | null,
      DolphinId: columns[20].value as number | null,
      DateAdded: columns[21].value as string | null,
      AlertCount: columns[22].value as number,
      StartDate: columns[23].value as Date | null,
      // Legacy fields for backwards compatibility
      name: columns[2].value as string | null,
      phone: columns[5].value as string | null,
      estimatedCost: columns[18].value as number | null,
      currency: columns[19].value as string | null,
      activeAlert: columns[24].value
        ? {
            alertId: columns[24].value as number,
            alertType: columns[25].value as string,
            alertDetails: columns[26].value as string,
            alertSeverity: columns[27].value as number,
          }
        : null,
    })
  );

  const assets = await getAssets(PID);
  const patientInfo = infos[0] || ({} as PatientInfo);

  return { ...patientInfo, ...assets };
}

/**
 * Retrieves asset information (X-rays and other assets) for a given patient ID.
 */
async function getAssets(pid: number): Promise<PatientAssets> {
  const pathResolver = createPathResolver(config.fileSystem.machinePath || '');
  const xrayDir = pathResolver(`clinic1/${pid}/opg`);
  const assetsDir = pathResolver(`clinic1/${pid}/assets`);

  const xrays = (await pathExists(xrayDir)) ? await getXrays(xrayDir, pathResolver, pid) : [];

  const assets = (await pathExists(assetsDir)) ? await fs.readdir(assetsDir) : [];

  return { xrays, assets };
}

/**
 * Retrieves X-ray information for a given directory.
 */
async function getXrays(
  xrayDir: string,
  pathResolver: (path: string) => string,
  pid: number
): Promise<XrayInfo[]> {
  const allFiles = await fs.readdir(xrayDir);
  const xrayNames = allFiles.filter(
    (xrayName) =>
      xrayName.endsWith('.dcm') ||
      xrayName.endsWith('.pano') ||
      xrayName.endsWith('.ceph') ||
      xrayName.endsWith('.rvg') ||
      xrayName.startsWith('TASK_')
  );

  const xrays = await Promise.all(
    xrayNames.map(async (xrayName) => {
      const xray: XrayInfo = { name: xrayName };
      const parentDetailsDirPath = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4`);

      if (await pathExists(parentDetailsDirPath)) {
        const subDirs = await fs.readdir(parentDetailsDirPath);
        for (const subDir of subDirs) {
          if (subDir.endsWith(xrayName)) {
            xray.detailsDirName = subDir;
            const previewPath = pathResolver(
              `clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}/t.png`
            );

            if (await pathExists(previewPath)) {
              xray.previewImagePartialPath = `/OPG/.csi_data/.version_4.4/${subDir}/t.png`;
            }

            const metaFile = pathResolver(
              `clinic1/${pid}/opg/.csi_data/.version_4.4/${subDir}/meta`
            );
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
 */
async function extractDate(metaFile: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const fileStream = createReadStream(metaFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let dateString = '';
    let targetLine: number | null = null;
    let lineCount = 0;

    rl.on('line', (line: string) => {
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

    rl.on('error', (err: Error) => {
      log.error('Error reading file', { error: err.message });
      reject(err);
    });

    rl.on('close', () => {
      if (!dateString) {
        resolve(null);
      }
    });
  });
}

/**
 * Retrieves patient names and phone numbers.
 */
export function getPatientsPhones(): Promise<PatientPhone[]> {
  return executeQuery<PatientPhone>(
    'SELECT PersonID, PatientName, Phone FROM dbo.tblpatients',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
      phone: columns[2].value as string,
    })
  );
}

/**
 * Retrieves the active work ID for a given patient ID.
 */
export async function getActiveWID(PID: number): Promise<number | null> {
  const result = await executeQuery<number>(
    'SELECT WorkID FROM dbo.tblwork WHERE PersonID = @PID AND Status = 1',
    [['PID', TYPES.Int, PID]],
    (columns: ColumnValue[]) => columns[0].value as number
  );
  return result[0] || null;
}

/**
 * Creates a new patient record in the database.
 */
export async function createPatient(patientData: PatientData): Promise<CreatePatientResult> {
  const duplicateCheck = await executeQuery<{ personId: number; patientName: string }>(
    'SELECT PersonID, PatientName FROM dbo.tblpatients WHERE PatientName = @patientName',
    [['patientName', TYPES.NVarChar, patientData.patientName]],
    (columns: ColumnValue[]) => ({
      personId: columns[0].value as number,
      patientName: columns[1].value as string,
    })
  );

  if (duplicateCheck && duplicateCheck.length > 0) {
    const error = new Error(
      `A patient with the name "${patientData.patientName}" already exists.`
    ) as DuplicatePatientError;
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

  const parameters: SqlParam[] = [
    ['patientID', TYPES.NVarChar, patientData.patientID || null],
    ['patientName', TYPES.NVarChar, patientData.patientName],
    ['phone', TYPES.NVarChar, patientData.phone || null],
    ['firstName', TYPES.NVarChar, patientData.firstName || null],
    ['lastName', TYPES.NVarChar, patientData.lastName || null],
    ['dateOfBirth', TYPES.Date, patientData.dateOfBirth || null],
    ['gender', TYPES.Int, patientData.gender ? parseInt(String(patientData.gender)) : null],
    ['phone2', TYPES.NVarChar, patientData.phone2 || null],
    ['email', TYPES.NChar, patientData.email || null],
    ['addressID', TYPES.Int, patientData.addressID ? parseInt(String(patientData.addressID)) : null],
    [
      'referralSourceID',
      TYPES.Int,
      patientData.referralSourceID ? parseInt(String(patientData.referralSourceID)) : null,
    ],
    [
      'patientTypeID',
      TYPES.Int,
      patientData.patientTypeID ? parseInt(String(patientData.patientTypeID)) : null,
    ],
    ['notes', TYPES.NVarChar, patientData.notes || null],
    ['language', TYPES.TinyInt, patientData.language ? parseInt(String(patientData.language)) : 0],
    ['countryCode', TYPES.NVarChar, patientData.countryCode || null],
    [
      'estimatedCost',
      TYPES.Int,
      patientData.estimatedCost ? parseInt(String(patientData.estimatedCost)) : null,
    ],
    ['currency', TYPES.NVarChar, patientData.currency || null],
  ];

  const result = await executeQuery<CreatePatientResult>(
    query,
    parameters,
    (columns: ColumnValue[]) => ({
      personId: columns[0]?.value as number,
    })
  );

  if (!result?.[0]) {
    throw new Error('Failed to create patient: no ID returned');
  }

  return result[0];
}

/**
 * Retrieves all referral sources for dropdown lists.
 */
export function getReferralSources(): Promise<LookupItem[]> {
  return executeQuery<LookupItem>(
    'SELECT ID, Referral FROM dbo.tblReferrals ORDER BY Referral',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
}

/**
 * Retrieves all patient types for dropdown lists.
 */
export function getPatientTypes(): Promise<LookupItem[]> {
  return executeQuery<LookupItem>(
    'SELECT ID, PatientType FROM dbo.tblPatientType ORDER BY PatientType',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
}

/**
 * Retrieves all addresses for dropdown lists.
 */
export function getAddresses(): Promise<LookupItem[]> {
  return executeQuery<LookupItem>(
    'SELECT ID, Zone FROM dbo.tblAddress ORDER BY Zone',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
}

/**
 * Retrieves all genders for dropdown lists.
 */
export function getGenders(): Promise<LookupItem[]> {
  return executeQuery<LookupItem>(
    'SELECT Gender_ID, Gender FROM dbo.tblGender ORDER BY Gender',
    [],
    (columns: ColumnValue[]) => ({
      id: columns[0].value as number,
      name: columns[1].value as string,
    })
  );
}

/**
 * Retrieves a single patient's full details by PersonID.
 */
export async function getPatientById(personId: number): Promise<PatientDetails | null> {
  const result = await executeQuery<PatientDetails>(
    `SELECT p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
            p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
            p.AddressID, p.ReferralSourceID, p.PatientTypeID,
            p.Notes, p.Language, p.CountryCode,
            p.EstimatedCost, p.Currency, p.TagID, p.DateAdded
     FROM dbo.tblpatients p
     WHERE p.PersonID = @personId`,
    [['personId', TYPES.Int, personId]],
    (columns: ColumnValue[]) => ({
      PersonID: columns[0].value as number,
      patientID: columns[1].value as string | null,
      PatientName: columns[2].value as string,
      FirstName: columns[3].value as string | null,
      LastName: columns[4].value as string | null,
      Phone: columns[5].value as string | null,
      Phone2: columns[6].value as string | null,
      Email: columns[7].value as string | null,
      DateofBirth: columns[8].value as Date | null,
      Gender: columns[9].value as number | null,
      AddressID: columns[10].value as number | null,
      ReferralSourceID: columns[11].value as number | null,
      PatientTypeID: columns[12].value as number | null,
      Notes: columns[13].value as string | null,
      Language: columns[14].value as number | null,
      CountryCode: columns[15].value as string | null,
      EstimatedCost: columns[16].value as number | null,
      Currency: columns[17].value as string | null,
      TagID: columns[18].value as number | null,
      DateAdded: columns[19].value as Date | null,
    })
  );
  return result[0] || null;
}

/**
 * Retrieves all patients with full details.
 */
export function getAllPatients(): Promise<PatientWithRelations[]> {
  return executeQuery<PatientWithRelations>(
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
    (columns: ColumnValue[]) => ({
      PersonID: columns[0].value as number,
      patientID: columns[1].value as string | null,
      PatientName: columns[2].value as string,
      FirstName: columns[3].value as string | null,
      LastName: columns[4].value as string | null,
      Phone: columns[5].value as string | null,
      Phone2: columns[6].value as string | null,
      Email: columns[7].value as string | null,
      DateofBirth: columns[8].value as Date | null,
      Gender: columns[9].value as number | null,
      AddressID: columns[10].value as number | null,
      ReferralSourceID: columns[11].value as number | null,
      PatientTypeID: columns[12].value as number | null,
      Notes: columns[13].value as string | null,
      Language: columns[14].value as number | null,
      CountryCode: columns[15].value as string | null,
      GenderName: columns[16].value as string | null,
      AddressName: columns[17].value as string | null,
      ReferralSource: columns[18].value as string | null,
      PatientTypeName: columns[19].value as string | null,
      EstimatedCost: null,
      Currency: null,
      TagID: null,
      DateAdded: null,
    })
  );
}

/**
 * Updates an existing patient record.
 */
export async function updatePatient(
  personId: number,
  patientData: UpdatePatientData
): Promise<{ success: boolean }> {
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

  const parameters: SqlParam[] = [
    ['personId', TYPES.Int, personId],
    ['patientID', TYPES.NVarChar, patientData.patientID || null],
    ['patientName', TYPES.NVarChar, patientData.PatientName],
    ['firstName', TYPES.NVarChar, patientData.FirstName || null],
    ['lastName', TYPES.NVarChar, patientData.LastName || null],
    ['phone', TYPES.NVarChar, patientData.Phone || null],
    ['phone2', TYPES.NVarChar, patientData.Phone2 || null],
    ['email', TYPES.NChar, patientData.Email || null],
    ['dateOfBirth', TYPES.Date, patientData.DateofBirth || null],
    ['gender', TYPES.Int, patientData.Gender ? parseInt(String(patientData.Gender)) : null],
    ['addressID', TYPES.Int, patientData.AddressID ? parseInt(String(patientData.AddressID)) : null],
    [
      'referralSourceID',
      TYPES.Int,
      patientData.ReferralSourceID ? parseInt(String(patientData.ReferralSourceID)) : null,
    ],
    [
      'patientTypeID',
      TYPES.Int,
      patientData.PatientTypeID ? parseInt(String(patientData.PatientTypeID)) : null,
    ],
    ['notes', TYPES.NVarChar, patientData.Notes || null],
    ['language', TYPES.TinyInt, patientData.Language ? parseInt(String(patientData.Language)) : 0],
    ['countryCode', TYPES.NVarChar, patientData.CountryCode || null],
    [
      'estimatedCost',
      TYPES.Int,
      patientData.EstimatedCost ? parseInt(String(patientData.EstimatedCost)) : null,
    ],
    ['currency', TYPES.NVarChar, patientData.Currency || null],
    ['tagID', TYPES.Int, patientData.TagID ? parseInt(String(patientData.TagID)) : null],
  ];

  await executeQuery(query, parameters, () => ({}));
  return { success: true };
}

/**
 * Deletes a patient record.
 */
export async function deletePatient(personId: number): Promise<{ success: boolean }> {
  try {
    // Delete in order based on dependencies
    await executeQuery('DELETE FROM dbo.tblwork WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblCarriedWires WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblWaiting WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblappointments WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblOpened WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblscrews WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    await executeQuery('DELETE FROM dbo.tblpatients WHERE PersonID = @personId', [
      ['personId', TYPES.Int, personId],
    ], () => ({}));

    return { success: true };
  } catch (error) {
    log.error('Error in deletePatient cascade', { error: (error as Error).message });
    throw new Error(`Failed to delete patient and related records: ${(error as Error).message}`);
  }
}

/**
 * Retrieves patient data for no-work receipt from V_rptNoWork view
 */
export async function getPatientNoWorkReceiptData(
  patientId: number
): Promise<NoWorkReceiptData | null> {
  try {
    const result = await executeQuery<NoWorkReceiptData>(
      `SELECT PersonID, PatientName, Phone, AppDate
       FROM dbo.V_rptNoWork
       WHERE PersonID = @patientId`,
      [['patientId', TYPES.Int, patientId]],
      (columns: ColumnValue[]) => ({
        PersonID: columns[0].value as number,
        PatientName: columns[1].value as string,
        Phone: columns[2].value as string | null,
        AppDate: columns[3].value as Date | null,
      })
    );

    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    log.error('[PATIENT-QUERIES] Error getting no-work receipt data', { patientId, error: (error as Error).message });
    throw error;
  }
}

/**
 * Checks if a patient has a future appointment scheduled
 */
export async function hasNextAppointment(patientId: number): Promise<boolean> {
  try {
    const result = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM dbo.V_rptNoWork
       WHERE PersonID = @patientId AND AppDate IS NOT NULL`,
      [['patientId', TYPES.Int, patientId]],
      (columns: ColumnValue[]) => ({ count: columns[0].value as number })
    );

    return result && result.length > 0 && result[0].count > 0;
  } catch (error) {
    log.error('[PATIENT-QUERIES] Error checking appointment', { patientId, error: (error as Error).message });
    throw error;
  }
}
