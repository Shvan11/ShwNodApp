/**
 * Patient-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). This was a facade
 * bypasser (`withTransaction` + `new sql.Request(tx)`); the delete-cascade now runs on
 * a Kysely transaction via `withPgTransaction`. The `V_rptNoWork` → `VLastApp` view
 * chain (not yet recreated in PG — views are Phase 5) is inlined here as a correlated
 * "latest future appointment" subquery. `PatientName`/`Currency`/`CountryCode` are
 * `citext`, so the duplicate-name check stays case-insensitive (matches Arabic_CI_AS).
 */
import { sql } from 'kysely';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'node:readline';
import { getKysely, withPgTransaction } from '../kysely.js';
import config from '../../../config/config.js';
import { createPathResolver } from '../../../utils/path-resolver.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

// Type definitions
interface PatientInfo {
  PersonID: number;
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

interface UpdatePatientData {
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
  const row = await getKysely()
    .selectFrom('tblpatients as p')
    .leftJoin('tblGender as g', 'g.Gender_ID', 'p.Gender')
    .leftJoin('tblAddress as a', 'a.ID', 'p.AddressID')
    .leftJoin('tblReferrals as r', 'r.ID', 'p.ReferralSourceID')
    .leftJoin('tblPatientType as pt', 'pt.ID', 'p.PatientTypeID')
    .leftJoin('tblTagOptions as tag', 'tag.ID', 'p.TagID')
    // First active work (Status=1); a patient can have several — executeTakeFirst keeps one.
    .leftJoin(
      (eb) => eb.selectFrom('tblwork').select(['PersonID', 'StartDate']).where('Status', '=', 1).as('w'),
      (join) => join.onRef('w.PersonID', '=', 'p.PersonID')
    )
    // Most-severe active alert (was TOP 1 … ORDER BY AlertSeverity DESC, CreationDate DESC).
    .leftJoin(
      (eb) =>
        eb
          .selectFrom('tblAlerts')
          .select(['AlertID', 'PersonID', 'AlertTypeID', 'AlertDetails', 'AlertSeverity'])
          .where('PersonID', '=', PID)
          .where('IsActive', '=', true)
          .orderBy('AlertSeverity', 'desc')
          .orderBy('CreationDate', 'desc')
          .limit(1)
          .as('alert'),
      (join) => join.onRef('alert.PersonID', '=', 'p.PersonID')
    )
    .leftJoin('tblAlertTypes as at', 'at.AlertTypeID', 'alert.AlertTypeID')
    .where('p.PersonID', '=', PID)
    .select((eb) => [
      'p.PersonID',
      'p.PatientName',
      'p.FirstName',
      'p.LastName',
      'p.Phone',
      'p.Phone2',
      'p.Email',
      // DateofBirth is a PG `date` → the parser already returns 'YYYY-MM-DD' (was CONVERT(...,23)).
      eb.ref('p.DateofBirth').$castTo<string>().as('DateOfBirth'),
      'p.Gender',
      'g.Gender as GenderDisplay',
      'a.Zone as Address',
      'r.Referral as ReferralSource',
      'pt.PatientType',
      'tag.Tag',
      'p.Notes',
      'p.Language',
      'p.CountryCode',
      'p.EstimatedCost',
      'p.Currency',
      sql<number | null>`null`.as('DolphinId'),
      // DateAdded is a `timestamp`; force the date-only form the old CONVERT(...,23) produced.
      sql<string | null>`to_char(${eb.ref('p.DateAdded')}, 'YYYY-MM-DD')`.as('DateAdded'),
      eb
        .selectFrom('tblAlerts')
        .select((e) => e.fn.countAll<number>().as('c'))
        .where('PersonID', '=', PID)
        .where('IsActive', '=', true)
        .as('AlertCount'),
      'w.StartDate',
      eb.ref('alert.AlertID').as('AlertID'),
      'at.TypeName as AlertType',
      eb.ref('alert.AlertDetails').as('AlertDetails'),
      eb.ref('alert.AlertSeverity').as('AlertSeverity'),
    ])
    .executeTakeFirst();

  const assets = await getAssets(PID);

  const patientInfo: PatientInfo = row
    ? {
        PersonID: row.PersonID,
        PatientName: row.PatientName,
        FirstName: row.FirstName,
        LastName: row.LastName,
        Phone: row.Phone,
        Phone2: row.Phone2,
        Email: row.Email,
        DateOfBirth: row.DateOfBirth,
        Gender: row.Gender,
        GenderDisplay: row.GenderDisplay,
        Address: row.Address,
        ReferralSource: row.ReferralSource,
        PatientType: row.PatientType,
        Tag: row.Tag,
        Notes: row.Notes,
        Language: row.Language,
        CountryCode: row.CountryCode,
        EstimatedCost: row.EstimatedCost,
        Currency: row.Currency,
        DolphinId: row.DolphinId,
        DateAdded: row.DateAdded,
        AlertCount: Number(row.AlertCount ?? 0),
        StartDate: row.StartDate as Date | null,
        // Legacy fields for backwards compatibility
        name: row.PatientName,
        phone: row.Phone,
        estimatedCost: row.EstimatedCost,
        currency: row.Currency,
        activeAlert:
          row.AlertID != null
            ? {
                alertId: row.AlertID,
                alertType: row.AlertType as string,
                alertDetails: row.AlertDetails as string,
                alertSeverity: row.AlertSeverity as number,
              }
            : null,
      }
    : ({} as PatientInfo);

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

  // The details dir is the same for every xray of this patient, so read it ONCE
  // up front rather than re-running pathExists + readdir inside the per-file map.
  const parentDetailsDirPath = pathResolver(`clinic1/${pid}/opg/.csi_data/.version_4.4`);
  const detailsSubDirs = (await pathExists(parentDetailsDirPath))
    ? await fs.readdir(parentDetailsDirPath)
    : [];

  const xrays = await Promise.all(
    xrayNames.map(async (xrayName) => {
      const xray: XrayInfo = { name: xrayName };

      for (const subDir of detailsSubDirs) {
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
  return getKysely()
    .selectFrom('tblpatients')
    .select(['PersonID as id', 'PatientName as name', 'Phone as phone'])
    .execute() as Promise<PatientPhone[]>;
}

/**
 * Retrieves the active work ID for a given patient ID.
 */
export async function getActiveWID(PID: number): Promise<number | null> {
  const row = await getKysely()
    .selectFrom('tblwork')
    .select('workid')
    .where('PersonID', '=', PID)
    .where('Status', '=', 1)
    .executeTakeFirst();
  return row?.workid ?? null;
}

/**
 * Creates a new patient record in the database.
 */
export async function createPatient(patientData: PatientData): Promise<CreatePatientResult> {
  const db = getKysely();

  // PatientName is citext → this duplicate check is case-insensitive (matches Arabic_CI_AS).
  const duplicateCheck = await db
    .selectFrom('tblpatients')
    .select(['PersonID', 'PatientName'])
    .where('PatientName', '=', patientData.patientName)
    .execute();

  if (duplicateCheck.length > 0) {
    const error = new Error(
      `A patient with the name "${patientData.patientName}" already exists.`
    ) as DuplicatePatientError;
    error.code = 'DUPLICATE_PATIENT_NAME';
    error.existingPatientId = duplicateCheck[0].PersonID;
    throw error;
  }

  const toInt = (v: string | number | undefined): number | null =>
    v ? parseInt(String(v), 10) : null;

  const inserted = await db
    .insertInto('tblpatients')
    .values({
      PatientName: patientData.patientName,
      Phone: patientData.phone || null,
      FirstName: patientData.firstName || null,
      LastName: patientData.lastName || null,
      DateofBirth: patientData.dateOfBirth ? toDateOnly(patientData.dateOfBirth) : null,
      Gender: toInt(patientData.gender),
      Phone2: patientData.phone2 || null,
      Email: patientData.email || null,
      AddressID: toInt(patientData.addressID),
      ReferralSourceID: toInt(patientData.referralSourceID),
      PatientTypeID: toInt(patientData.patientTypeID),
      Notes: patientData.notes || null,
      Language: patientData.language ? parseInt(String(patientData.language), 10) : 0,
      CountryCode: patientData.countryCode || null,
      EstimatedCost: toInt(patientData.estimatedCost),
      Currency: patientData.currency || null,
    })
    .returning('PersonID')
    .executeTakeFirstOrThrow();

  return { personId: inserted.PersonID };
}

/**
 * Retrieves all referral sources for dropdown lists.
 */
export function getReferralSources(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('tblReferrals')
    .select(['ID as id', 'Referral as name'])
    .orderBy('Referral')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all patient types for dropdown lists.
 */
export function getPatientTypes(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('tblPatientType')
    .select(['ID as id', 'PatientType as name'])
    .orderBy('PatientType')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all addresses for dropdown lists.
 */
export function getAddresses(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('tblAddress')
    .select(['ID as id', 'Zone as name'])
    .orderBy('Zone')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all genders for dropdown lists.
 */
export function getGenders(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('tblGender')
    .select(['Gender_ID as id', 'Gender as name'])
    .orderBy('Gender')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves a single patient's full details by PersonID.
 */
export async function getPatientById(personId: number): Promise<PatientDetails | null> {
  // NOTE: DateofBirth is a PG `date` so its runtime value is a 'YYYY-MM-DD' string
  // (kysely-codegen still types it as Date — the declared PatientDetails.DateofBirth
  // type is preserved). DateAdded is a `timestamp` → genuine Date. (Phase 6/7 review.)
  const row = await getKysely()
    .selectFrom('tblpatients as p')
    .where('p.PersonID', '=', personId)
    .select([
      'p.PersonID',
      'p.PatientName',
      'p.FirstName',
      'p.LastName',
      'p.Phone',
      'p.Phone2',
      'p.Email',
      'p.DateofBirth',
      'p.Gender',
      'p.AddressID',
      'p.ReferralSourceID',
      'p.PatientTypeID',
      'p.Notes',
      'p.Language',
      'p.CountryCode',
      'p.EstimatedCost',
      'p.Currency',
      'p.TagID',
      'p.DateAdded',
    ])
    .executeTakeFirst();
  return (row as PatientDetails | undefined) ?? null;
}

/**
 * Updates an existing patient record.
 */
export async function updatePatient(
  personId: number,
  patientData: UpdatePatientData
): Promise<{ success: boolean }> {
  const toInt = (v: string | number | undefined): number | null =>
    v ? parseInt(String(v), 10) : null;

  await withPgTransaction(async (trx) => {
    await trx
      .updateTable('tblpatients')
      .set({
        PatientName: patientData.PatientName,
        FirstName: patientData.FirstName || null,
        LastName: patientData.LastName || null,
        Phone: patientData.Phone || null,
        Phone2: patientData.Phone2 || null,
        Email: patientData.Email || null,
        DateofBirth: patientData.DateofBirth ? toDateOnly(patientData.DateofBirth) : null,
        Gender: toInt(patientData.Gender),
        AddressID: toInt(patientData.AddressID),
        ReferralSourceID: toInt(patientData.ReferralSourceID),
        PatientTypeID: toInt(patientData.PatientTypeID),
        Notes: patientData.Notes || null,
        Language: patientData.Language ? parseInt(String(patientData.Language), 10) : 0,
        CountryCode: patientData.CountryCode || null,
        EstimatedCost: toInt(patientData.EstimatedCost),
        Currency: patientData.Currency || null,
        TagID: toInt(patientData.TagID),
      })
      .where('PersonID', '=', personId)
      .execute();

  });
  return { success: true };
}

/**
 * Deletes a patient record.
 */
export async function deletePatient(personId: number): Promise<{ success: boolean }> {
  try {
    // All child + parent rows are removed in a single transaction so a
    // mid-cascade failure rolls back fully — no FK orphans / half-deleted patient.
    // Children before parent, matching the original delete order.
    await withPgTransaction(async (trx) => {
      await trx.deleteFrom('tblwork').where('PersonID', '=', personId).execute();
      await trx.deleteFrom('tblCarriedWires').where('PersonID', '=', personId).execute();
      await trx.deleteFrom('tblWaiting').where('PersonID', '=', personId).execute();
      await trx.deleteFrom('tblappointments').where('PersonID', '=', personId).execute();
      await trx.deleteFrom('tblscrews').where('PersonID', '=', personId).execute();
      await trx.deleteFrom('tblpatients').where('PersonID', '=', personId).execute();
    });

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
    // Inlined V_rptNoWork → VLastApp: AppDate is the patient's latest FUTURE appointment
    // (max AppDate filtered to > local now), or NULL. For a single patient this equals
    // the view's "max-over-all-appts where that max is in the future" semantics.
    const row = await getKysely()
      .selectFrom('tblpatients as p')
      .where('p.PersonID', '=', patientId)
      .select((eb) => [
        'p.PersonID',
        'p.PatientName',
        'p.Phone',
        eb
          .selectFrom('tblappointments as a')
          .whereRef('a.PersonID', '=', 'p.PersonID')
          .where('a.AppDate', '>', sql<Date>`localtimestamp`)
          .select((e) => e.fn.max('a.AppDate').as('m'))
          .as('AppDate'),
      ])
      .executeTakeFirst();

    return (row as NoWorkReceiptData | undefined) ?? null;
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
    // Inlined V_rptNoWork: "AppDate IS NOT NULL" ⟺ the patient has a future appointment.
    const row = await getKysely()
      .selectFrom('tblappointments as a')
      .where('a.PersonID', '=', patientId)
      .where('a.AppDate', '>', sql<Date>`localtimestamp`)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return Number(row?.count ?? 0) > 0;
  } catch (error) {
    log.error('[PATIENT-QUERIES] Error checking appointment', { patientId, error: (error as Error).message });
    throw error;
  }
}
