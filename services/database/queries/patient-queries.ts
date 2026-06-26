/**
 * Patient-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). This was a facade
 * bypasser (`withTransaction` + `new sql.Request(tx)`); the delete-cascade now runs on
 * a Kysely transaction via `withPgTransaction`. The `V_rptNoWork` → `VLastApp` view
 * chain (not yet recreated in PG — views are Phase 5) is inlined here as a correlated
 * "latest future appointment" subquery. `patient_name`/`currency`/`country_code` are
 * `citext`, so the duplicate-name check stays case-insensitive (matches Arabic_CI_AS).
 */
import { sql } from 'kysely';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'node:readline';
import { getKysely, withPgTransaction } from '../kysely.js';
import { patientPath } from '../../files/clinic-paths.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';
import { isUniqueViolation } from '../../../utils/pg-errors.js';

// The `genders` lookup table was dissolved (immutable Male/Female domain, enforced by the
// existing CHECK on patients.gender). The int→label mapping lives here; any UI translation
// (Kurdish/Arabic RTL) belongs in app i18n, not the DB.
const GENDER_LABELS: Record<number, string> = { 1: 'Male', 2: 'Female' };

// type definitions
interface PatientInfo {
  person_id: number;
  patient_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  DateOfBirth: string | null;
  gender: number | null;
  gender_display: string | null;
  address_name: string | null;
  referral_source: string | null;
  patient_type_name: string | null;
  tag_name: string | null;
  notes: string | null;
  language: number | null;
  country_code: string | null;
  estimated_cost: number | null;
  currency: string | null;
  DolphinId: number | null;
  date_added: string | null;
  AlertCount: number;
  // Legacy fields for backwards compatibility
  name: string | null;
  start_date: string | null;
  estimatedCost: number | null;
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

type PatientPhone = {
  id: number;
  name: string;
  phone: string | null;
};

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

// `type` (not `interface`) so a LookupItem[] is assignable to the lookup
// contract's `z.array(z.looseObject({ id }))` sendData arg — see the index-
// signature rule in docs/shared-contract-progress.md.
type LookupItem = {
  id: number;
  name: string;
};

// `type` (not `interface`) so a `PatientDetails & { alerts }` value is assignable to
// the patientById contract's `z.looseObject({...})` sendData arg — the looseObject
// string index-signature rule (docs/shared-contract-progress.md).
type PatientDetails = {
  person_id: number;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: number | null;
  address_id: number | null;
  referral_source_id: number | null;
  patient_type_id: number | null;
  notes: string | null;
  language: number | null;
  country_code: string | null;
  estimated_cost: number | null;
  currency: string | null;
  tag_id: number | null;
  date_added: string | null;
};

interface UpdatePatientData {
  patient_name: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  date_of_birth?: Date;
  gender?: string | number;
  address_id?: string | number;
  referral_source_id?: string | number;
  patient_type_id?: string | number;
  notes?: string;
  language?: string | number;
  country_code?: string;
  estimated_cost?: string | number;
  currency?: string;
  tag_id?: string | number;
}

interface NoWorkReceiptData {
  person_id: number;
  patient_name: string;
  phone: string | null;
  app_date: Date | null;
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
 * Retrieves patient information for a given patient id.
 * Returns full patient details with all related lookup values.
 */
export async function getInfos(PID: number): Promise<PatientInfo & PatientAssets> {
  // The patient row and the asset bundle are independent reads — issue them
  // concurrently rather than serially.
  const rowPromise = getKysely()
    .selectFrom('patients as p')
    .leftJoin('addresses as a', 'a.id', 'p.address_id')
    .leftJoin('referrals as r', 'r.id', 'p.referral_source_id')
    .leftJoin('patient_types as pt', 'pt.id', 'p.patient_type_id')
    .leftJoin('tag_options as tag', 'tag.id', 'p.tag_id')
    // First active work (status=1); a patient can have several — executeTakeFirst keeps one.
    .leftJoin(
      (eb) => eb.selectFrom('works').select(['person_id', 'start_date']).where('status', '=', 1).as('w'),
      (join) => join.onRef('w.person_id', '=', 'p.person_id')
    )
    // Most-severe active alert (was TOP 1 … ORDER BY alert_severity DESC, creation_date DESC).
    .leftJoin(
      (eb) =>
        eb
          .selectFrom('alerts')
          .select(['alert_id', 'person_id', 'alert_type_id', 'alert_details', 'alert_severity'])
          .where('person_id', '=', PID)
          .where('status', '=', 'active')
          .where((w) =>
            w.or([w('expires_at', 'is', null), w('expires_at', '>=', sql<string>`CURRENT_DATE`)])
          )
          .orderBy('alert_severity', 'desc')
          .orderBy('creation_date', 'desc')
          .limit(1)
          .as('alert'),
      (join) => join.onRef('alert.person_id', '=', 'p.person_id')
    )
    .leftJoin('alert_types as at', 'at.alert_type_id', 'alert.alert_type_id')
    .where('p.person_id', '=', PID)
    .select((eb) => [
      'p.person_id',
      'p.patient_name',
      'p.first_name',
      'p.last_name',
      'p.phone',
      'p.phone2',
      'p.email',
      // date_of_birth is a PG `date` → the parser already returns 'YYYY-MM-DD' (was CONVERT(...,23)).
      eb.ref('p.date_of_birth').$castTo<string>().as('DateOfBirth'),
      'p.gender',
      'a.zone as address_name',
      'r.referral as referral_source',
      'pt.patient_type as patient_type_name',
      'tag.tag as tag_name',
      'p.notes',
      'p.language',
      'p.country_code',
      'p.estimated_cost',
      'p.currency',
      sql<number | null>`null`.as('DolphinId'),
      // date_added is a `timestamp`; force the date-only form the old CONVERT(...,23) produced.
      sql<string | null>`to_char(${eb.ref('p.date_added')}, 'YYYY-MM-DD')`.as('date_added'),
      eb
        .selectFrom('alerts')
        .select((e) => e.fn.countAll<number>().as('c'))
        .where('person_id', '=', PID)
        .where('status', '=', 'active')
        .where((w) =>
          w.or([w('expires_at', 'is', null), w('expires_at', '>=', sql<string>`CURRENT_DATE`)])
        )
        .as('AlertCount'),
      'w.start_date',
      eb.ref('alert.alert_id').as('alert_id'),
      'at.type_name as AlertType',
      eb.ref('alert.alert_details').as('alert_details'),
      eb.ref('alert.alert_severity').as('alert_severity'),
    ])
    .executeTakeFirst();

  const [row, assets] = await Promise.all([rowPromise, getAssets(PID)]);

  const patientInfo: PatientInfo = row
    ? {
        person_id: row.person_id,
        patient_name: row.patient_name,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        phone2: row.phone2,
        email: row.email,
        DateOfBirth: row.DateOfBirth,
        gender: row.gender,
        gender_display: row.gender != null ? (GENDER_LABELS[row.gender] ?? null) : null,
        address_name: row.address_name,
        referral_source: row.referral_source,
        patient_type_name: row.patient_type_name,
        tag_name: row.tag_name,
        notes: row.notes,
        language: row.language,
        country_code: row.country_code,
        estimated_cost: row.estimated_cost,
        currency: row.currency,
        DolphinId: row.DolphinId,
        date_added: row.date_added,
        AlertCount: Number(row.AlertCount ?? 0),
        start_date: row.start_date,
        // Legacy fields for backwards compatibility
        name: row.patient_name,
        estimatedCost: row.estimated_cost,
        activeAlert:
          row.alert_id != null
            ? {
                alertId: row.alert_id,
                alertType: row.AlertType as string,
                alertDetails: row.alert_details as string,
                alertSeverity: row.alert_severity as number,
              }
            : null,
      }
    : ({} as PatientInfo);

  return { ...patientInfo, ...assets };
}

/**
 * Retrieves asset information (X-rays and other assets) for a given patient id.
 */
async function getAssets(pid: number): Promise<PatientAssets> {
  const xrayDir = patientPath(pid, 'OPG');
  const assetsDir = patientPath(pid, 'assets');

  const xrays = (await pathExists(xrayDir)) ? await getXrays(xrayDir, pid) : [];

  const assets = (await pathExists(assetsDir)) ? await fs.readdir(assetsDir) : [];

  return { xrays, assets };
}

/**
 * Retrieves X-ray information for a given directory.
 */
async function getXrays(
  xrayDir: string,
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
  const parentDetailsDirPath = patientPath(pid, 'OPG/.csi_data/.version_4.4');
  const detailsSubDirs = (await pathExists(parentDetailsDirPath))
    ? await fs.readdir(parentDetailsDirPath)
    : [];

  const xrays = await Promise.all(
    xrayNames.map(async (xrayName) => {
      const xray: XrayInfo = { name: xrayName };

      for (const subDir of detailsSubDirs) {
        if (subDir.endsWith(xrayName)) {
          xray.detailsDirName = subDir;
          const previewPath = patientPath(
            pid,
            `OPG/.csi_data/.version_4.4/${subDir}/t.png`
          );

          if (await pathExists(previewPath)) {
            xray.previewImagePartialPath = `/OPG/.csi_data/.version_4.4/${subDir}/t.png`;
          }

          const metaFile = patientPath(
            pid,
            `OPG/.csi_data/.version_4.4/${subDir}/meta`
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
    .selectFrom('patients')
    .select(['person_id as id', 'patient_name as name', 'phone as phone'])
    .execute() as Promise<PatientPhone[]>;
}

/**
 * Retrieves the active work id for a given patient id.
 */
export async function getActiveWID(PID: number): Promise<number | null> {
  const row = await getKysely()
    .selectFrom('works')
    .select('work_id')
    .where('person_id', '=', PID)
    .where('status', '=', 1)
    .executeTakeFirst();
  return row?.work_id ?? null;
}

/**
 * Creates a new patient record in the database.
 */
export async function createPatient(patientData: PatientData): Promise<CreatePatientResult> {
  const db = getKysely();

  const toInt = (v: string | number | undefined): number | null =>
    v ? parseInt(String(v), 10) : null;

  // Duplicate names are rejected by the unique index ix_name_id (on the citext
  // patient_name column → case-insensitive, matching Arabic_CI_AS). We let the
  // INSERT hit it rather than pre-checking with a SELECT, which was racy: two
  // concurrent creates could both pass the SELECT and then one would throw an
  // unhandled pg error. This mirrors how updatePatient's caller handles the
  // same constraint.
  try {
    const inserted = await db
      .insertInto('patients')
      .values({
        patient_name: patientData.patientName,
        phone: patientData.phone || null,
        first_name: patientData.firstName || null,
        last_name: patientData.lastName || null,
        date_of_birth: patientData.dateOfBirth ? toDateOnly(patientData.dateOfBirth) : null,
        gender: toInt(patientData.gender),
        phone2: patientData.phone2 || null,
        email: patientData.email || null,
        address_id: toInt(patientData.addressID),
        referral_source_id: toInt(patientData.referralSourceID),
        patient_type_id: toInt(patientData.patientTypeID),
        notes: patientData.notes || null,
        language: patientData.language ? parseInt(String(patientData.language), 10) : 0,
        country_code: patientData.countryCode || null,
        estimated_cost: toInt(patientData.estimatedCost),
        currency: patientData.currency || null,
      })
      .returning('person_id')
      .executeTakeFirstOrThrow();

    return { personId: inserted.person_id };
  } catch (error) {
    if (isUniqueViolation(error, 'ix_name_id')) {
      // Recover the existing patient's id for the API contract — only on the
      // (rare) conflict path, and no longer racy: we're reporting an
      // already-committed duplicate, not gating the insert.
      const existing = await db
        .selectFrom('patients')
        .select('person_id')
        .where('patient_name', '=', patientData.patientName)
        .executeTakeFirst();
      const dup = new Error(
        `A patient with the name "${patientData.patientName}" already exists.`
      ) as DuplicatePatientError;
      dup.code = 'DUPLICATE_PATIENT_NAME';
      dup.existingPatientId = existing?.person_id ?? 0;
      throw dup;
    }
    throw error;
  }
}

/**
 * Retrieves all referral sources for dropdown lists.
 */
export function getReferralSources(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('referrals')
    .select(['id as id', 'referral as name'])
    .orderBy('referral')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all patient types for dropdown lists.
 */
export function getPatientTypes(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('patient_types')
    .select(['id as id', 'patient_type as name'])
    .orderBy('patient_type')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all addresses for dropdown lists.
 */
export function getAddresses(): Promise<LookupItem[]> {
  return getKysely()
    .selectFrom('addresses')
    .select(['id as id', 'zone as name'])
    .orderBy('zone')
    .execute() as Promise<LookupItem[]>;
}

/**
 * Retrieves all genders for dropdown lists.
 */
export function getGenders(): Promise<LookupItem[]> {
  // genders lookup dissolved — return the fixed Male/Female domain (was a DB table read).
  return Promise.resolve(
    Object.entries(GENDER_LABELS).map(([id, name]) => ({ id: Number(id), name }))
  );
}

/**
 * Retrieves a single patient's full details by person_id.
 */
export async function getPatientById(personId: number): Promise<PatientDetails | null> {
  // NOTE: date_of_birth is a PG `date` so its runtime value is a 'YYYY-MM-DD' string;
  // codegen types it `string` and PatientDetails.date_of_birth matches (`string | null`).
  // date_added is a `timestamp` (Date at runtime); it's to_char'd to a date-only string
  // in the select below so PatientDetails.date_added is honestly `string | null`.
  const row = await getKysely()
    .selectFrom('patients as p')
    .where('p.person_id', '=', personId)
    .select([
      'p.person_id',
      'p.patient_name',
      'p.first_name',
      'p.last_name',
      'p.phone',
      'p.phone2',
      'p.email',
      'p.date_of_birth',
      'p.gender',
      'p.address_id',
      'p.referral_source_id',
      'p.patient_type_id',
      'p.notes',
      'p.language',
      'p.country_code',
      'p.estimated_cost',
      'p.currency',
      'p.tag_id',
      // date_added is a `timestamp` → a Date at runtime. Convert to a date-only string
      // here (matching the patient-list query) so every endpoint serves the same
      // 'YYYY-MM-DD' shape and no raw Date hits res.json() → toISOString() (UTC).
      sql<string | null>`to_char(p."date_added", 'YYYY-MM-DD')`.as('date_added'),
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
      .updateTable('patients')
      .set({
        patient_name: patientData.patient_name,
        first_name: patientData.first_name || null,
        last_name: patientData.last_name || null,
        phone: patientData.phone || null,
        phone2: patientData.phone2 || null,
        email: patientData.email || null,
        date_of_birth: patientData.date_of_birth ? toDateOnly(patientData.date_of_birth) : null,
        gender: toInt(patientData.gender),
        address_id: toInt(patientData.address_id),
        referral_source_id: toInt(patientData.referral_source_id),
        patient_type_id: toInt(patientData.patient_type_id),
        notes: patientData.notes || null,
        language: patientData.language ? parseInt(String(patientData.language), 10) : 0,
        country_code: patientData.country_code || null,
        estimated_cost: toInt(patientData.estimated_cost),
        currency: patientData.currency || null,
        tag_id: toInt(patientData.tag_id),
      })
      .where('person_id', '=', personId)
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
      await trx.deleteFrom('works').where('person_id', '=', personId).execute();
      await trx.deleteFrom('carried_wires').where('person_id', '=', personId).execute();
      await trx.deleteFrom('waiting').where('person_id', '=', personId).execute();
      await trx.deleteFrom('appointments').where('person_id', '=', personId).execute();
      await trx.deleteFrom('screws').where('person_id', '=', personId).execute();
      await trx.deleteFrom('patients').where('person_id', '=', personId).execute();
    });

    return { success: true };
  } catch (error) {
    log.error('Error in deletePatient cascade', { error: (error as Error).message });
    throw new Error(`Failed to delete patient and related records: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Retrieves patient data for no-work receipt from V_rptNoWork view
 */
export async function getPatientNoWorkReceiptData(
  patientId: number
): Promise<NoWorkReceiptData | null> {
  try {
    // Inlined V_rptNoWork → VLastApp: app_date is the patient's latest FUTURE appointment
    // (max app_date filtered to > local now), or NULL. For a single patient this equals
    // the view's "max-over-all-appts where that max is in the future" semantics.
    const row = await getKysely()
      .selectFrom('patients as p')
      .where('p.person_id', '=', patientId)
      .select((eb) => [
        'p.person_id',
        'p.patient_name',
        'p.phone',
        eb
          .selectFrom('appointments as a')
          .whereRef('a.person_id', '=', 'p.person_id')
          .where('a.app_date', '>', sql<Date>`localtimestamp`)
          .select((e) => e.fn.max('a.app_date').as('m'))
          .as('app_date'),
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
    // Inlined V_rptNoWork: "app_date IS NOT NULL" ⟺ the patient has a future appointment.
    const row = await getKysely()
      .selectFrom('appointments as a')
      .where('a.person_id', '=', patientId)
      .where('a.app_date', '>', sql<Date>`localtimestamp`)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    return Number(row?.count ?? 0) > 0;
  } catch (error) {
    log.error('[PATIENT-QUERIES] Error checking appointment', { patientId, error: (error as Error).message });
    throw error;
  }
}
