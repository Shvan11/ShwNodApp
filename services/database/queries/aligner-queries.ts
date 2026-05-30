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
 *
 * Migration Phase 4 + 5: all functions are typed Kysely (PostgreSQL) via `getKysely()` /
 * `withPgTransaction()`. The four batch stored procedures (usp_CreateAlignerBatch /
 * usp_UpdateAlignerBatch / usp_UpdateBatchStatus / usp_DeleteAlignerBatch) are reimplemented as
 * transactional TS write paths here (`createBatch` / `updateBatch` / `updateBatchStatus` /
 * `deleteBatch`); `resequenceBatches()` is the verbatim port of the procs' resequencing CTEs.
 * `createNote` folds in trg_AlignerNotes_DoctorActivity (Doctor-note → activity flag).
 *
 * The batch procs only adjust `tblAlignerSets.Remaining{Upper,Lower}Aligners`, which touches none
 * of the tblAlignerSets UPDATE triggers (they fire only on Days/SetCost/Currency/CreationDate),
 * so no extra set-trigger cascade is needed here.
 *
 * Two SQL Server views are inlined (no PG equivalent): `v_allsets` → `getAllAlignerSets`;
 * `vw_AlignerSetPayments` → `getAlignerSetsByWorkId` + `getAlignerSetBalance`.
 *
 * FLAG (Phase 7 parity): `createAlignerSet`/`updateAlignerSet` preserve the inline SetSequence /
 * work-total / remaining-aligner logic carried over from Phase 4 (the tblAlignerSets INSERT-trigger
 * effects); verify against the SQL Server baseline.
 */
import { sql, type Transaction } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';

type PgTransaction = Transaction<Database>;
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

// ==============================
// TYPE DEFINITIONS
// ==============================

interface AlignerDoctor {
  DrID: number;
  DoctorName: string;
  DoctorEmail: string | null;
  LogoPath: string | null;
}

interface AlignerDoctorWithUnread extends AlignerDoctor {
  UnreadDoctorNotes: number;
  // Aliased properties for frontend compatibility
  id: number;
  name: string;
  logoPath: string | null;
}

interface DoctorData {
  DoctorName: string;
  DoctorEmail?: string | null;
  LogoPath?: string | null;
}

interface AlignerSet {
  AlignerSetID: number;
  WorkID: number;
  SetSequence: number | null;
  Type: string | null;
  UpperAlignersCount: number;
  LowerAlignersCount: number;
  RemainingUpperAligners: number;
  RemainingLowerAligners: number;
  CreationDate: Date;
  Days: number | null;
  IsActive: boolean;
  Notes: string | null;
  FolderPath: string | null;
  AlignerDrID: number;
  SetUrl: string | null;
  SetPdfUrl: string | null;
  SetVideo: string | null;
  SetCost: number | null;
  Currency: string | null;
  ArchformID: number | null;
}

interface AlignerSetWithDetails extends AlignerSet {
  AlignerDoctorName: string | null;
  TotalBatches: number;
  DeliveredBatches: number;
  TotalPaid: number | null;
  Balance: number | null;
  PaymentStatus: string | null;
  UnreadActivityCount: number;
}

interface AlignerSetFromView {
  PersonID: number;
  PatientName: string;
  WorkID: number;
  AlignerDrID: number;
  AlignerSetID: number;
  SetSequence: number | null;
  SetIsActive: boolean;
  BatchSequence: number | null;
  CreationDate: Date | null;
  BatchCreationDate: Date | null;
  ManufactureDate: Date | null;
  DeliveredToPatientDate: Date | null;
  NextDueDate: Date | null;
  Notes: string | null;
  IsLast: boolean | null;
  NextBatchPresent: string | null;
  LabStatus: string | null;
  DoctorName: string;
  WorkStatus: number | null;
  WorkStatusName: string | null;
}

interface AlignerSetData {
  WorkID: number;
  SetSequence?: number | null;
  Type?: string | null;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
  Days?: number | null;
  AlignerDrID: number;
  SetUrl?: string | null;
  SetPdfUrl?: string | null;
  SetCost?: number | null;
  Currency?: string | null;
  Notes?: string | null;
  IsActive?: boolean;
}

interface AlignerSetUpdateData {
  SetSequence?: number | null;
  Type?: string | null;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
  Days?: number | null;
  AlignerDrID?: number | null;
  SetUrl?: string | null;
  SetPdfUrl?: string | null;
  SetVideo?: string | null;
  SetCost?: number | null;
  Currency?: string | null;
  Notes?: string | null;
  IsActive?: boolean;
}

interface AlignerPatient {
  PersonID: number;
  FirstName: string | null;
  LastName: string | null;
  PatientName: string;
  Phone: string | null;
  workid: number;
  WorkType: string;
  WorkTypeID: number;
  TotalSets?: number;
  ActiveSets?: number;
  UnreadDoctorNotes?: number;
  DateOfBirth?: Date | null;
  StartDate?: Date | null;
}

interface AlignerBatch {
  AlignerBatchID: number;
  AlignerSetID: number;
  BatchSequence: number;
  UpperAlignerCount: number;
  LowerAlignerCount: number;
  UpperAlignerStartSequence: number | null;
  UpperAlignerEndSequence: number | null;
  LowerAlignerStartSequence: number | null;
  LowerAlignerEndSequence: number | null;
  CreationDate: Date;
  ManufactureDate: Date | null;
  DeliveredToPatientDate: Date | null;
  Days: number | null;
  ValidityPeriod: number | null;
  BatchExpiryDate: Date | null;
  Notes: string | null;
  IsActive: boolean;
  IsLast: boolean;
  HasUpperTemplate: boolean;
  HasLowerTemplate: boolean;
}

interface BatchData {
  AlignerSetID: number;
  UpperAlignerCount?: number;
  LowerAlignerCount?: number;
  // NOTE: ManufactureDate and DeliveredToPatientDate are managed via updateBatchStatus()
  Days?: number | null;
  Notes?: string | null;
  IsActive?: boolean;
  HasUpperTemplate?: boolean;
  HasLowerTemplate?: boolean;
  IsLast?: boolean;
  BatchSequence?: number;
  AlignersInBatch?: number;
  UpperAlignerStartSequence?: number;
  UpperAlignerEndSequence?: number;
  LowerAlignerStartSequence?: number;
  LowerAlignerEndSequence?: number;
  // Note: BatchExpiryDate and ValidityPeriod are computed columns - cannot be set directly
}

interface BatchUpdateData extends Omit<BatchData, 'AlignerSetID'> {
  AlignerSetID?: number;
}

interface AlignerNote {
  NoteID: number;
  AlignerSetID: number;
  NoteType: 'Lab' | 'Doctor';
  NoteText: string;
  CreatedAt: Date;
  IsEdited: boolean;
  EditedAt: Date | null;
  IsRead: boolean;
  DoctorName: string;
}

interface AlignerActivity {
  ActivityID: number;
  AlignerSetID: number;
  ActivityType: string;
  ActivityDescription: string;
  CreatedAt: Date;
  IsRead: boolean;
  ReadAt: Date | null;
  RelatedRecordID: number | null;
}

interface AlignerPaymentData {
  workid: number;
  AlignerSetID: number | null;
  Amountpaid: number | string;
  Dateofpayment: Date | string;
  ActualAmount?: number | null;
  ActualCur?: string | null;
  Change?: number | null;
  USDReceived?: number;
  IQDReceived?: number;
  Notes?: string;
}

interface AlignerSetBalance {
  AlignerSetID: number;
  SetCost: number | null;
  TotalPaid: number | null;
  Balance: number | null;
}

interface DeactivatedBatchInfo {
  deactivatedBatch: {
    batchId: number;
    batchSequence: number;
  };
}

/**
 * Parsed result from batch status update
 */
export interface UpdateBatchStatusResult {
  batchId: number;
  batchSequence: number;
  setId: number;
  action: string;
  success: boolean;
  message: string;
  wasActivated: boolean;
  wasAlreadyActive: boolean;
  wasAlreadyDelivered: boolean;
  previouslyActiveBatchSequence: number | null;
}

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 */
export async function getDoctorsWithUnreadCounts(): Promise<AlignerDoctorWithUnread[]> {
  try {
    const rows = await getKysely()
      .selectFrom('AlignerDoctors as ad')
      .select((eb) => [
        'ad.DrID',
        'ad.DoctorName',
        'ad.LogoPath',
        eb
          .selectFrom('tblAlignerNotes as n')
          .innerJoin('tblAlignerSets as s', 'n.AlignerSetID', 's.AlignerSetID')
          .whereRef('s.AlignerDrID', '=', 'ad.DrID')
          .where('n.NoteType', '=', 'Doctor')
          .where('n.IsRead', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .distinct()
      .orderBy('ad.DoctorName')
      .execute();

    return rows.map((r) => ({
      DrID: r.DrID,
      DoctorName: r.DoctorName,
      DoctorEmail: null,
      LogoPath: r.LogoPath,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
      // Aliased properties for frontend compatibility (PrintQueueContext expects these)
      id: r.DrID,
      name: r.DoctorName,
      logoPath: r.LogoPath,
    }));
  } catch (err) {
    log.error('Failed to get doctors with unread counts', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get all aligner doctors (simple list)
 */
export async function getAllDoctors(): Promise<AlignerDoctor[]> {
  try {
    return (await getKysely()
      .selectFrom('AlignerDoctors')
      .select(['DrID', 'DoctorName', 'DoctorEmail', 'LogoPath'])
      .orderBy('DoctorName')
      .execute()) as AlignerDoctor[];
  } catch (err) {
    log.error('Failed to get all doctors', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if doctor email exists (excluding specific doctor)
 */
export async function isDoctorEmailTaken(
  email: string,
  excludeDrID: number | null = null
): Promise<boolean> {
  if (!email || email.trim() === '') {
    return false;
  }

  try {
    let q = getKysely()
      .selectFrom('AlignerDoctors')
      .select('DrID')
      // DoctorEmail is citext → case-insensitive comparison, matching Arabic_CI_AS.
      .where('DoctorEmail', '=', email.trim());

    if (excludeDrID) {
      q = q.where('DrID', '!=', excludeDrID);
    }

    const row = await q.executeTakeFirst();
    return !!row;
  } catch (err) {
    log.error('Failed to check if doctor email is taken', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get count of aligner sets for a doctor
 */
export async function getDoctorSetCount(drID: number): Promise<number> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerSets')
      .where('AlignerDrID', '=', drID)
      .select((eb) => eb.fn.countAll().as('SetCount'))
      .executeTakeFirst();

    return Number(row?.SetCount) || 0;
  } catch (err) {
    log.error('Failed to get doctor set count', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner doctor
 */
export async function createDoctor(doctorData: DoctorData): Promise<number | null> {
  const { DoctorName, DoctorEmail, LogoPath } = doctorData;

  try {
    const row = await getKysely()
      .insertInto('AlignerDoctors')
      .values({
        DoctorName: DoctorName.trim(),
        DoctorEmail: DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null,
        LogoPath: LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null,
      })
      .returning('DrID')
      .executeTakeFirstOrThrow();

    return row.DrID;
  } catch (err) {
    log.error('Failed to create doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update an aligner doctor
 */
export async function updateDoctor(drID: number, doctorData: DoctorData): Promise<void> {
  const { DoctorName, DoctorEmail, LogoPath } = doctorData;

  try {
    await getKysely()
      .updateTable('AlignerDoctors')
      .set({
        DoctorName: DoctorName.trim(),
        DoctorEmail: DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null,
        LogoPath: LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null,
      })
      .where('DrID', '=', drID)
      .execute();
  } catch (err) {
    log.error('Failed to update doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete an aligner doctor
 */
export async function deleteDoctor(drID: number): Promise<void> {
  try {
    await getKysely().deleteFrom('AlignerDoctors').where('DrID', '=', drID).execute();
  } catch (err) {
    log.error('Failed to delete doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER SETS QUERIES
// ==============================

/**
 * Get all aligner sets.
 *
 * FLAG (inlined view): the SQL Server `dbo.v_allsets` view does not exist in the PG
 * schema (views land in Phase 5). Its logic is inlined here:
 *   - "latest batch" per set: ROW_NUMBER() OVER (PARTITION BY AlignerSetID
 *     ORDER BY active-first, BatchSequence DESC) = 1
 *   - NextDueDate: BatchExpiryDate of the latest DELIVERED batch
 *   - NextBatchPresent ('True'/'False'): a manufactured-but-undelivered batch exists
 *     beyond the last delivered sequence
 *   - LabStatus: no_batches / in_lab / needs_mfg / all_delivered
 *   - the view itself filters Typeofwork IN (19,20,21)
 */
export async function getAllAlignerSets(): Promise<AlignerSetFromView[]> {
  try {
    const db = getKysely();

    const rows = await db
      .with('lb', (qb) =>
        qb
          .selectFrom('tblAlignerBatches')
          .select((_eb) => [
            'AlignerSetID',
            'AlignerBatchID',
            'BatchSequence',
            'CreationDate',
            'ManufactureDate',
            'DeliveredToPatientDate',
            'BatchExpiryDate',
            'Notes',
            'IsLast',
            sql<number>`row_number() over (partition by "AlignerSetID" order by case when "IsActive" = true then 0 else 1 end, "BatchSequence" desc)`.as(
              'RowNum'
            ),
          ])
      )
      .selectFrom('tblpatients as p')
      .innerJoin('tblwork as w', 'w.PersonID', 'p.PersonID')
      .innerJoin('tblAlignerSets as s', 'w.workid', 's.WorkID')
      .innerJoin('AlignerDoctors as ad', 's.AlignerDrID', 'ad.DrID')
      .leftJoin('lb', (join) =>
        join.onRef('s.AlignerSetID', '=', 'lb.AlignerSetID').on('lb.RowNum', '=', 1)
      )
      .leftJoin('tblWorkStatus as ws', 'w.Status', 'ws.StatusID')
      .where((eb) =>
        eb.or([
          eb('w.Typeofwork', '=', 19),
          eb('w.Typeofwork', '=', 20),
          eb('w.Typeofwork', '=', 21),
        ])
      )
      .select((eb) => [
        'w.PersonID as PersonID',
        'p.PatientName as PatientName',
        's.WorkID as WorkID',
        's.AlignerDrID as AlignerDrID',
        's.AlignerSetID as AlignerSetID',
        's.SetSequence as SetSequence',
        's.IsActive as SetIsActive',
        'lb.BatchSequence as BatchSequence',
        eb.ref('s.CreationDate').$castTo<Date | null>().as('CreationDate'),
        eb.ref('lb.CreationDate').$castTo<Date | null>().as('BatchCreationDate'),
        eb.ref('lb.ManufactureDate').$castTo<Date | null>().as('ManufactureDate'),
        eb.ref('lb.DeliveredToPatientDate').$castTo<Date | null>().as('DeliveredToPatientDate'),
        // NextDueDate: BatchExpiryDate of the latest DELIVERED batch
        eb
          .selectFrom('tblAlignerBatches as b')
          .whereRef('b.AlignerSetID', '=', 's.AlignerSetID')
          .where('b.DeliveredToPatientDate', 'is not', null)
          .orderBy('b.BatchSequence', 'desc')
          .select('b.BatchExpiryDate')
          .limit(1)
          .$castTo<Date | null>()
          .as('NextDueDate'),
        'lb.Notes as Notes',
        'lb.IsLast as IsLast',
        // NextBatchPresent: a manufactured-but-undelivered batch beyond the last delivered seq?
        sql<string>`case when exists (
          select 1 from "tblAlignerBatches" "ReadyBatch"
          where "ReadyBatch"."AlignerSetID" = ${eb.ref('s.AlignerSetID')}
            and "ReadyBatch"."ManufactureDate" is not null
            and "ReadyBatch"."DeliveredToPatientDate" is null
            and "ReadyBatch"."BatchSequence" > coalesce(
              (select max("b2"."BatchSequence") from "tblAlignerBatches" "b2"
               where "b2"."AlignerSetID" = ${eb.ref('s.AlignerSetID')}
                 and "b2"."DeliveredToPatientDate" is not null), 0)
        ) then 'True' else 'False' end`.as('NextBatchPresent'),
        // LabStatus
        sql<string>`case
          when not exists (select 1 from "tblAlignerBatches" "b2" where "b2"."AlignerSetID" = ${eb.ref('s.AlignerSetID')}) then 'no_batches'
          when exists (select 1 from "tblAlignerBatches" "b2" where "b2"."AlignerSetID" = ${eb.ref('s.AlignerSetID')} and "b2"."ManufactureDate" is not null and "b2"."DeliveredToPatientDate" is null) then 'in_lab'
          when exists (select 1 from "tblAlignerBatches" "b2" where "b2"."AlignerSetID" = ${eb.ref('s.AlignerSetID')} and "b2"."ManufactureDate" is null) then 'needs_mfg'
          else 'all_delivered' end`.as('LabStatus'),
        'ad.DoctorName as DoctorName',
        'w.Status as WorkStatus',
        'ws.StatusName as WorkStatusName',
      ])
      .orderBy(sql`case when "s"."IsActive" = true then 0 else 1 end`)
      .orderBy(
        sql`case when (case when exists (
          select 1 from "tblAlignerBatches" "ReadyBatch"
          where "ReadyBatch"."AlignerSetID" = "s"."AlignerSetID"
            and "ReadyBatch"."ManufactureDate" is not null
            and "ReadyBatch"."DeliveredToPatientDate" is null
            and "ReadyBatch"."BatchSequence" > coalesce(
              (select max("b2"."BatchSequence") from "tblAlignerBatches" "b2"
               where "b2"."AlignerSetID" = "s"."AlignerSetID"
                 and "b2"."DeliveredToPatientDate" is not null), 0)
        ) then 'True' else 'False' end) = 'False' then 0 else 1 end`
      )
      .orderBy(
        sql`(select b."BatchExpiryDate" from "tblAlignerBatches" b
          where b."AlignerSetID" = "s"."AlignerSetID" and b."DeliveredToPatientDate" is not null
          order by b."BatchSequence" desc limit 1) asc`
      )
      .orderBy('p.PatientName')
      .execute();

    return rows as unknown as AlignerSetFromView[];
  } catch (err) {
    log.error('Failed to get all aligner sets', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner sets for a specific work ID.
 *
 * FLAG (inlined view): joins the `vw_AlignerSetPayments` view (absent from PG — Phase 5).
 * Its TotalPaid/Balance/PaymentStatus logic is inlined as a per-set aggregate subquery.
 */
export async function getAlignerSetsByWorkId(workId: number): Promise<AlignerSetWithDetails[]> {
  try {
    const db = getKysely();

    const rows = await db
      .selectFrom('tblAlignerSets as s')
      .leftJoin('tblAlignerBatches as b', 's.AlignerSetID', 'b.AlignerSetID')
      .leftJoin('AlignerDoctors as ad', 's.AlignerDrID', 'ad.DrID')
      .where('s.WorkID', '=', workId)
      .groupBy([
        's.AlignerSetID',
        's.WorkID',
        's.SetSequence',
        's.Type',
        's.UpperAlignersCount',
        's.LowerAlignersCount',
        's.RemainingUpperAligners',
        's.RemainingLowerAligners',
        's.CreationDate',
        's.Days',
        's.IsActive',
        's.Notes',
        's.FolderPath',
        's.AlignerDrID',
        's.SetUrl',
        's.SetPdfUrl',
        's.SetVideo',
        's.SetCost',
        's.Currency',
        's.ArchformID',
        'ad.DoctorName',
      ])
      .select((eb) => [
        's.AlignerSetID',
        's.WorkID',
        's.SetSequence',
        's.Type',
        's.UpperAlignersCount',
        's.LowerAlignersCount',
        's.RemainingUpperAligners',
        's.RemainingLowerAligners',
        eb.ref('s.CreationDate').$castTo<Date>().as('CreationDate'),
        's.Days',
        's.IsActive',
        's.Notes',
        's.FolderPath',
        's.AlignerDrID',
        's.SetUrl',
        's.SetPdfUrl',
        's.SetVideo',
        eb.ref('s.SetCost').$castTo<number | null>().as('SetCost'),
        's.Currency',
        's.ArchformID',
        'ad.DoctorName as AlignerDoctorName',
        eb.fn.count('b.AlignerBatchID').as('TotalBatches'),
        eb.fn
          .sum(sql<number>`case when "b"."DeliveredToPatientDate" is not null then 1 else 0 end`)
          .as('DeliveredBatches'),
        // vw_AlignerSetPayments inlined: TotalPaid / Balance / PaymentStatus
        eb
          .selectFrom('tblInvoice as i')
          .whereRef('i.AlignerSetID', '=', 's.AlignerSetID')
          .select((e) => e.fn.coalesce(e.fn.sum('i.Amountpaid'), sql<number>`0`).as('tp'))
          .$castTo<number | null>()
          .as('TotalPaid'),
        sql<number | null>`(${eb.ref('s.SetCost')} - coalesce((select sum(i."Amountpaid") from "tblInvoice" i where i."AlignerSetID" = ${eb.ref('s.AlignerSetID')}), 0))`.as(
          'Balance'
        ),
        sql<string | null>`case
          when ${eb.ref('s.SetCost')} is null then 'No Cost Set'
          when coalesce((select sum(i."Amountpaid") from "tblInvoice" i where i."AlignerSetID" = ${eb.ref('s.AlignerSetID')}), 0) = 0 then 'Unpaid'
          when coalesce((select sum(i."Amountpaid") from "tblInvoice" i where i."AlignerSetID" = ${eb.ref('s.AlignerSetID')}), 0) < ${eb.ref('s.SetCost')} then 'Partial'
          when coalesce((select sum(i."Amountpaid") from "tblInvoice" i where i."AlignerSetID" = ${eb.ref('s.AlignerSetID')}), 0) >= ${eb.ref('s.SetCost')} then 'Paid'
          else 'Unknown' end`.as('PaymentStatus'),
        eb
          .selectFrom('tblAlignerNotes as n')
          .whereRef('n.AlignerSetID', '=', 's.AlignerSetID')
          .where('n.NoteType', '=', 'Doctor')
          .where('n.IsRead', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadActivityCount'),
      ])
      .orderBy('s.SetSequence')
      .execute();

    return rows.map((r) => ({
      AlignerSetID: r.AlignerSetID,
      WorkID: r.WorkID,
      SetSequence: r.SetSequence,
      Type: r.Type,
      UpperAlignersCount: r.UpperAlignersCount ?? 0,
      LowerAlignersCount: r.LowerAlignersCount ?? 0,
      RemainingUpperAligners: r.RemainingUpperAligners ?? 0,
      RemainingLowerAligners: r.RemainingLowerAligners ?? 0,
      CreationDate: r.CreationDate,
      Days: r.Days,
      IsActive: !!r.IsActive,
      Notes: r.Notes,
      FolderPath: r.FolderPath,
      AlignerDrID: r.AlignerDrID,
      SetUrl: r.SetUrl,
      SetPdfUrl: r.SetPdfUrl,
      SetVideo: r.SetVideo,
      SetCost: r.SetCost,
      Currency: r.Currency,
      ArchformID: r.ArchformID,
      AlignerDoctorName: r.AlignerDoctorName,
      TotalBatches: Number(r.TotalBatches) || 0,
      DeliveredBatches: Number(r.DeliveredBatches) || 0,
      TotalPaid: r.TotalPaid,
      Balance: r.Balance,
      PaymentStatus: r.PaymentStatus,
      UnreadActivityCount: Number(r.UnreadActivityCount) || 0,
    }));
  } catch (err) {
    log.error('Failed to get aligner sets by work id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get a single aligner set by ID
 */
export async function getAlignerSetById(setId: number): Promise<AlignerSet | null> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerSets')
      .where('AlignerSetID', '=', setId)
      .select((eb) => [
        'AlignerSetID',
        'WorkID',
        'SetSequence',
        'Type',
        'UpperAlignersCount',
        'LowerAlignersCount',
        'RemainingUpperAligners',
        'RemainingLowerAligners',
        eb.ref('CreationDate').$castTo<Date>().as('CreationDate'),
        'Days',
        'IsActive',
        'Notes',
        'FolderPath',
        'AlignerDrID',
        'SetUrl',
        'SetPdfUrl',
        'SetVideo',
        eb.ref('SetCost').$castTo<number | null>().as('SetCost'),
        'Currency',
        'ArchformID',
      ])
      .executeTakeFirst();

    if (!row) return null;

    return {
      AlignerSetID: row.AlignerSetID,
      WorkID: row.WorkID,
      SetSequence: row.SetSequence,
      Type: row.Type,
      UpperAlignersCount: row.UpperAlignersCount ?? 0,
      LowerAlignersCount: row.LowerAlignersCount ?? 0,
      RemainingUpperAligners: row.RemainingUpperAligners ?? 0,
      RemainingLowerAligners: row.RemainingLowerAligners ?? 0,
      CreationDate: row.CreationDate,
      Days: row.Days,
      IsActive: !!row.IsActive,
      Notes: row.Notes,
      FolderPath: row.FolderPath,
      AlignerDrID: row.AlignerDrID,
      SetUrl: row.SetUrl,
      SetPdfUrl: row.SetPdfUrl,
      SetVideo: row.SetVideo,
      SetCost: row.SetCost,
      Currency: row.Currency,
      ArchformID: row.ArchformID,
    };
  } catch (err) {
    log.error('Failed to get aligner set by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner set with business logic.
 * Deactivates other sets if creating an active set.
 *
 * FLAG (Phase 5 / trigger-dependent): under SQL Server, INSERT triggers on
 * `tblAlignerSets` maintain derived state (SetSequence allocation, work-total roll-up,
 * remaining-aligner seeding). Those triggers don't exist in PG. This translation seeds
 * RemainingUpper/LowerAligners = Upper/LowerAlignersCount explicitly (as the original
 * INSERT did) and writes the provided SetSequence verbatim; any other trigger-maintained
 * column must be reconciled in the Phase-5 AlignerService write path.
 */
export async function createAlignerSet(setData: AlignerSetData): Promise<number | null> {
  const startTime = Date.now();
  const {
    WorkID,
    SetSequence,
    Type,
    UpperAlignersCount,
    LowerAlignersCount,
    Days,
    AlignerDrID,
    SetUrl,
    SetPdfUrl,
    SetCost,
    Currency,
    Notes,
    IsActive,
  } = setData;

  const isActive = IsActive !== undefined ? IsActive : true;
  const upper = UpperAlignersCount ?? 0;
  const lower = LowerAlignersCount ?? 0;

  try {
    return await withPgTransaction(async (trx) => {
      // Deactivate all other sets for this work if creating an active set
      if (isActive) {
        await trx
          .updateTable('tblAlignerSets')
          .set({ IsActive: false })
          .where('WorkID', '=', WorkID)
          .where('IsActive', '=', true)
          .execute();
      }

      const inserted = await trx
        .insertInto('tblAlignerSets')
        .values({
          WorkID,
          SetSequence: SetSequence ?? null,
          Type: Type || null,
          UpperAlignersCount: upper,
          LowerAlignersCount: lower,
          RemainingUpperAligners: upper,
          RemainingLowerAligners: lower,
          Days: Days ?? null,
          AlignerDrID,
          SetUrl: SetUrl || null,
          SetPdfUrl: SetPdfUrl || null,
          SetCost: SetCost ?? null,
          Currency: Currency || null,
          Notes: Notes || null,
          IsActive: isActive,
          CreationDate: sql`localtimestamp`,
        })
        .returning('AlignerSetID')
        .executeTakeFirstOrThrow();

      log.debug(`[DB QUERY TIMING] Total createAlignerSet() took: ${Date.now() - startTime}ms`);
      return inserted.AlignerSetID;
    });
  } catch (err) {
    log.error('Failed to create aligner set', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update an aligner set.
 *
 * FLAG (Phase 5 / trigger-dependent): writes `tblAlignerSets` directly; SQL Server
 * UPDATE triggers maintaining derived state are absent in PG. The remaining-aligner
 * delta arithmetic below is preserved verbatim from the original statement.
 */
export async function updateAlignerSet(
  setId: number,
  setData: AlignerSetUpdateData
): Promise<void> {
  const {
    SetSequence,
    Type,
    UpperAlignersCount,
    LowerAlignersCount,
    Days,
    AlignerDrID,
    SetUrl,
    SetPdfUrl,
    SetVideo,
    SetCost,
    Currency,
    Notes,
    IsActive,
  } = setData;

  const newUpperCount = UpperAlignersCount ?? 0;
  const newLowerCount = LowerAlignersCount ?? 0;

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
    throw new Error(
      `Cannot reduce upper aligners to ${newUpperCount}. ${usedUpper} are already assigned to batches.`
    );
  }
  if (newLowerCount < usedLower) {
    throw new Error(
      `Cannot reduce lower aligners to ${newLowerCount}. ${usedLower} are already assigned to batches.`
    );
  }

  try {
    await getKysely()
      .updateTable('tblAlignerSets')
      .set((eb) => ({
        SetSequence: SetSequence ?? null,
        Type: Type || null,
        RemainingUpperAligners: sql<number>`${eb.ref('RemainingUpperAligners')} + (${newUpperCount} - ${eb.ref('UpperAlignersCount')})`,
        RemainingLowerAligners: sql<number>`${eb.ref('RemainingLowerAligners')} + (${newLowerCount} - ${eb.ref('LowerAlignersCount')})`,
        UpperAlignersCount: newUpperCount,
        LowerAlignersCount: newLowerCount,
        Days: Days ?? null,
        // AlignerDrID is NOT NULL; the original statement bound null when absent (a
        // latent SQL Server bug). Preserve that by binding the raw value via sql<number>.
        AlignerDrID: sql<number>`${AlignerDrID ?? null}`,
        SetUrl: SetUrl || null,
        SetPdfUrl: SetPdfUrl || null,
        SetVideo: SetVideo || null,
        SetCost: SetCost ?? null,
        Currency: Currency || null,
        Notes: Notes || null,
        IsActive: IsActive !== undefined ? IsActive : true,
      }))
      .where('AlignerSetID', '=', setId)
      .execute();
  } catch (err) {
    log.error('Failed to update aligner set', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete batches for a set
 */
export async function deleteBatchesBySetId(setId: number): Promise<void> {
  try {
    await getKysely().deleteFrom('tblAlignerBatches').where('AlignerSetID', '=', setId).execute();
  } catch (err) {
    log.error('Failed to delete batches by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete an aligner set
 */
export async function deleteAlignerSet(setId: number): Promise<void> {
  try {
    await getKysely().deleteFrom('tblAlignerSets').where('AlignerSetID', '=', setId).execute();
  } catch (err) {
    log.error('Failed to delete aligner set', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER PATIENTS QUERIES
// ==============================

/**
 * Get all aligner patients (all doctors)
 */
export async function getAllAlignerPatients(): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblpatients as p')
      .innerJoin('tblwork as w', 'p.PersonID', 'w.PersonID')
      .innerJoin('tblWorkType as wt', 'w.Typeofwork', 'wt.ID')
      .innerJoin('tblAlignerSets as s', 'w.workid', 's.WorkID')
      .where('wt.ID', 'in', [19, 20, 21])
      .groupBy([
        'p.PersonID',
        'p.FirstName',
        'p.LastName',
        'p.PatientName',
        'p.Phone',
        'w.workid',
        'wt.WorkType',
        'w.Typeofwork',
      ])
      .select((eb) => [
        'p.PersonID',
        'p.FirstName',
        'p.LastName',
        'p.PatientName',
        'p.Phone',
        'w.workid',
        'wt.WorkType',
        'w.Typeofwork as WorkTypeID',
        eb.fn.count('s.AlignerSetID').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."IsActive" = true then 1 else 0 end`)
          .as('ActiveSets'),
      ])
      .orderBy('p.PatientName')
      .orderBy('p.FirstName')
      .orderBy('p.LastName')
      .distinct()
      .execute();

    return rows.map((r) => ({
      PersonID: r.PersonID,
      FirstName: r.FirstName,
      LastName: r.LastName,
      PatientName: r.PatientName,
      Phone: r.Phone,
      workid: r.workid,
      WorkType: r.WorkType,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
    }));
  } catch (err) {
    log.error('Failed to get all aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner patients by doctor ID
 */
export async function getAlignerPatientsByDoctor(doctorId: number): Promise<AlignerPatient[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblpatients as p')
      .innerJoin('tblwork as w', 'p.PersonID', 'w.PersonID')
      .innerJoin('tblWorkType as wt', 'w.Typeofwork', 'wt.ID')
      .innerJoin('tblAlignerSets as s', 'w.workid', 's.WorkID')
      .where('wt.ID', 'in', [19, 20, 21])
      .where('s.AlignerDrID', '=', doctorId)
      .groupBy([
        'p.PersonID',
        'p.FirstName',
        'p.LastName',
        'p.PatientName',
        'p.Phone',
        'w.workid',
        'wt.WorkType',
        'w.Typeofwork',
      ])
      .select((eb) => [
        'p.PersonID',
        'p.FirstName',
        'p.LastName',
        'p.PatientName',
        'p.Phone',
        'w.workid',
        'wt.WorkType',
        'w.Typeofwork as WorkTypeID',
        eb.fn.count('s.AlignerSetID').distinct().as('TotalSets'),
        eb.fn
          .sum(sql<number>`case when "s"."IsActive" = true then 1 else 0 end`)
          .as('ActiveSets'),
        eb
          .selectFrom('tblAlignerNotes as n')
          .innerJoin('tblAlignerSets as sets', 'n.AlignerSetID', 'sets.AlignerSetID')
          .whereRef('sets.WorkID', '=', 'w.workid')
          .where('n.NoteType', '=', 'Doctor')
          .where('n.IsRead', '=', false)
          .select((e) => e.fn.countAll().as('cnt'))
          .as('UnreadDoctorNotes'),
      ])
      .orderBy('p.PatientName')
      .orderBy('p.FirstName')
      .orderBy('p.LastName')
      .distinct()
      .execute();

    return rows.map((r) => ({
      PersonID: r.PersonID,
      FirstName: r.FirstName,
      LastName: r.LastName,
      PatientName: r.PatientName,
      Phone: r.Phone,
      workid: r.workid,
      WorkType: r.WorkType,
      WorkTypeID: r.WorkTypeID,
      TotalSets: Number(r.TotalSets) || 0,
      ActiveSets: Number(r.ActiveSets) || 0,
      UnreadDoctorNotes: Number(r.UnreadDoctorNotes) || 0,
    }));
  } catch (err) {
    log.error('Failed to get aligner patients by doctor', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Search for aligner patients
 */
export async function searchAlignerPatients(
  searchTerm: string,
  doctorId: number | null = null
): Promise<AlignerPatient[]> {
  try {
    const like = `%${searchTerm}%`;

    let q = getKysely()
      .selectFrom('tblpatients as p')
      .innerJoin('tblwork as w', 'p.PersonID', 'w.PersonID')
      .innerJoin('tblWorkType as wt', 'w.Typeofwork', 'wt.ID')
      .innerJoin('tblAlignerSets as s', 'w.workid', 's.WorkID')
      .where('wt.ID', 'in', [19, 20, 21])
      .where((eb) =>
        eb.or([
          // citext columns → case-insensitive LIKE, matching Arabic_CI_AS.
          eb('p.FirstName', 'like', like),
          eb('p.LastName', 'like', like),
          eb('p.PatientName', 'like', like),
          eb('p.Phone', 'like', like),
          eb(sql<string>`${eb.ref('p.FirstName')} || ' ' || ${eb.ref('p.LastName')}`, 'like', like),
        ])
      );

    if (doctorId && !isNaN(doctorId)) {
      q = q.where('s.AlignerDrID', '=', doctorId);
    }

    const rows = await q
      .select([
        'p.PersonID',
        'p.FirstName',
        'p.LastName',
        'p.PatientName',
        'p.Phone',
        'w.workid',
        'wt.WorkType',
        'w.Typeofwork as WorkTypeID',
      ])
      .distinct()
      .orderBy('p.FirstName')
      .orderBy('p.LastName')
      .execute();

    return rows as AlignerPatient[];
  } catch (err) {
    log.error('Failed to search aligner patients', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER BATCHES QUERIES
// ==============================

/**
 * Get batches for a specific aligner set
 */
export async function getBatchesBySetId(setId: number): Promise<AlignerBatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblAlignerBatches')
      .where('AlignerSetID', '=', setId)
      .select((eb) => [
        'AlignerBatchID',
        'AlignerSetID',
        'BatchSequence',
        'UpperAlignerCount',
        'LowerAlignerCount',
        'UpperAlignerStartSequence',
        'UpperAlignerEndSequence',
        'LowerAlignerStartSequence',
        'LowerAlignerEndSequence',
        eb.ref('CreationDate').$castTo<Date>().as('CreationDate'),
        eb.ref('ManufactureDate').$castTo<Date | null>().as('ManufactureDate'),
        eb.ref('DeliveredToPatientDate').$castTo<Date | null>().as('DeliveredToPatientDate'),
        'Days',
        'ValidityPeriod',
        eb.ref('BatchExpiryDate').$castTo<Date | null>().as('BatchExpiryDate'),
        'Notes',
        'IsActive',
        'IsLast',
        'HasUpperTemplate',
        'HasLowerTemplate',
      ])
      .orderBy('BatchSequence')
      .execute();

    return rows.map((r) => ({
      AlignerBatchID: r.AlignerBatchID,
      AlignerSetID: r.AlignerSetID,
      BatchSequence: r.BatchSequence,
      UpperAlignerCount: r.UpperAlignerCount,
      LowerAlignerCount: r.LowerAlignerCount,
      UpperAlignerStartSequence: r.UpperAlignerStartSequence,
      UpperAlignerEndSequence: r.UpperAlignerEndSequence,
      LowerAlignerStartSequence: r.LowerAlignerStartSequence,
      LowerAlignerEndSequence: r.LowerAlignerEndSequence,
      CreationDate: r.CreationDate,
      ManufactureDate: r.ManufactureDate,
      DeliveredToPatientDate: r.DeliveredToPatientDate,
      Days: r.Days,
      ValidityPeriod: r.ValidityPeriod,
      BatchExpiryDate: r.BatchExpiryDate,
      Notes: r.Notes,
      IsActive: !!r.IsActive,
      IsLast: r.IsLast,
      HasUpperTemplate: r.HasUpperTemplate,
      HasLowerTemplate: r.HasLowerTemplate,
    }));
  } catch (err) {
    log.error('Failed to get batches by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a new aligner batch using optimized stored procedure
 * Note: ManufactureDate and DeliveredToPatientDate are not set during creation
 * They should be set via usp_UpdateBatchStatus (MANUFACTURE/DELIVER actions)
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function createBatch(batchData: BatchData): Promise<number | null> {
  const {
    AlignerSetID,
    UpperAlignerCount,
    LowerAlignerCount,
    Days,
    Notes,
    IsActive,
    HasUpperTemplate,
    HasLowerTemplate,
    IsLast,
  } = batchData;

  const upper = UpperAlignerCount ?? 0;
  const lower = LowerAlignerCount ?? 0;
  const hasU = HasUpperTemplate ?? false;
  const hasL = HasLowerTemplate ?? false;
  const isActive = IsActive ?? false;
  const isLast = IsLast ?? false;

  return withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('tblAlignerBatches')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('AlignerSetID', '=', AlignerSetID)
      .executeTakeFirst();
    if (Number(existing?.n ?? 0) > 0 && (hasU || hasL)) {
      throw new Error('Template flag can only be set on the first batch in a set');
    }
    if (hasU && upper < 1) throw new Error('HasUpperTemplate = 1 requires UpperAlignerCount >= 1');
    if (hasL && lower < 1) throw new Error('HasLowerTemplate = 1 requires LowerAlignerCount >= 1');

    const set = await trx
      .selectFrom('tblAlignerSets')
      .select(['RemainingUpperAligners', 'RemainingLowerAligners'])
      .where('AlignerSetID', '=', AlignerSetID)
      .forUpdate()
      .executeTakeFirst();
    if (!set || set.RemainingUpperAligners == null) throw new Error('AlignerSet not found');
    const remU = set.RemainingUpperAligners;
    const remL = set.RemainingLowerAligners ?? 0;
    const upConsumed = upper - (hasU ? 1 : 0);
    const loConsumed = lower - (hasL ? 1 : 0);
    if (upConsumed > remU) throw new Error(`Cannot add aligner batch: requested upper aligners (${upConsumed}) exceed remaining count (${remU})`);
    if (loConsumed > remL) throw new Error(`Cannot add aligner batch: requested lower aligners (${loConsumed}) exceed remaining count (${remL})`);

    if (isActive) {
      await trx.updateTable('tblAlignerBatches').set({ IsActive: false }).where('AlignerSetID', '=', AlignerSetID).where('IsActive', '=', true).execute();
    }

    const upperBase = hasU ? -1 : 0;
    const lowerBase = hasL ? -1 : 0;
    const agg = await sql<{ upperstart: number; lowerstart: number; batchseq: number }>`
      SELECT COALESCE(MAX("UpperAlignerEndSequence"), ${upperBase}) + 1 AS upperstart,
             COALESCE(MAX("LowerAlignerEndSequence"), ${lowerBase}) + 1 AS lowerstart,
             COALESCE(MAX("BatchSequence"), 0) + 1 AS batchseq
      FROM "tblAlignerBatches" WHERE "AlignerSetID" = ${AlignerSetID}
    `.execute(trx);
    const a = agg.rows[0];

    const row = await trx
      .insertInto('tblAlignerBatches')
      .values({
        AlignerSetID,
        UpperAlignerCount: upper,
        LowerAlignerCount: lower,
        ManufactureDate: null,
        DeliveredToPatientDate: null,
        Days: Days ?? null,
        Notes: Notes || null,
        IsActive: isActive,
        IsLast: isLast,
        BatchSequence: a.batchseq,
        UpperAlignerStartSequence: upper === 0 ? null : a.upperstart,
        LowerAlignerStartSequence: lower === 0 ? null : a.lowerstart,
        HasUpperTemplate: hasU,
        HasLowerTemplate: hasL,
      })
      .returning('AlignerBatchID')
      .executeTakeFirstOrThrow();

    await trx
      .updateTable('tblAlignerSets')
      .set({ RemainingUpperAligners: remU - upConsumed, RemainingLowerAligners: remL - loConsumed })
      .where('AlignerSetID', '=', AlignerSetID)
      .execute();

    return row.AlignerBatchID;
  });
}

/**
 * Recompute BatchSequence + Upper/LowerAlignerStartSequence for all batches in a set, ordered by
 * (ManufactureDate, AlignerBatchID). Verbatim port of the resequencing CTEs in the delete/update procs.
 */
async function resequenceBatches(trx: PgTransaction, setId: number): Promise<void> {
  await sql`
    WITH ordered AS (
      SELECT "AlignerBatchID", ROW_NUMBER() OVER (ORDER BY "ManufactureDate", "AlignerBatchID") AS newseq
      FROM "tblAlignerBatches" WHERE "AlignerSetID" = ${setId}
    )
    UPDATE "tblAlignerBatches" b SET "BatchSequence" = o.newseq
    FROM ordered o WHERE b."AlignerBatchID" = o."AlignerBatchID" AND b."BatchSequence" <> o.newseq
  `.execute(trx);

  await sql`
    WITH ordered AS (
      SELECT "AlignerBatchID", "UpperAlignerCount", "LowerAlignerCount", "HasUpperTemplate", "HasLowerTemplate",
             ROW_NUMBER() OVER (ORDER BY "ManufactureDate", "AlignerBatchID") AS rownum
      FROM "tblAlignerBatches" WHERE "AlignerSetID" = ${setId}
    ),
    cumulative AS (
      SELECT "AlignerBatchID", "UpperAlignerCount", "LowerAlignerCount", rownum,
        COALESCE(SUM("UpperAlignerCount") OVER (ORDER BY rownum ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prevupper,
        COALESCE(SUM("LowerAlignerCount") OVER (ORDER BY rownum ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prevlower,
        FIRST_VALUE("HasUpperTemplate") OVER (ORDER BY rownum) AS firsthasupper,
        FIRST_VALUE("HasLowerTemplate") OVER (ORDER BY rownum) AS firsthaslower
      FROM ordered
    )
    UPDATE "tblAlignerBatches" b SET
      "UpperAlignerStartSequence" = CASE WHEN c."UpperAlignerCount" > 0 THEN c.prevupper + CASE WHEN c.firsthasupper THEN 0 ELSE 1 END ELSE NULL END,
      "LowerAlignerStartSequence" = CASE WHEN c."LowerAlignerCount" > 0 THEN c.prevlower + CASE WHEN c.firsthaslower THEN 0 ELSE 1 END ELSE NULL END
    FROM cumulative c WHERE b."AlignerBatchID" = c."AlignerBatchID"
  `.execute(trx);
}

/**
 * Update an aligner batch using optimized stored procedure
 * NOTE: ManufactureDate and DeliveredToPatientDate are managed via updateBatchStatus()
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function updateBatch(
  batchId: number,
  batchData: BatchUpdateData
): Promise<DeactivatedBatchInfo | null> {
  const {
    AlignerSetID,
    UpperAlignerCount,
    LowerAlignerCount,
    Notes,
    IsActive,
    Days,
    IsLast,
    HasUpperTemplate,
    HasLowerTemplate,
  } = batchData;

  const upper = UpperAlignerCount ?? 0;
  const lower = LowerAlignerCount ?? 0;

  await withPgTransaction(async (trx) => {
    const old = await trx
      .selectFrom('tblAlignerBatches')
      .select(['AlignerSetID', 'UpperAlignerCount', 'LowerAlignerCount', 'Days', 'HasUpperTemplate', 'HasLowerTemplate', 'DeliveredToPatientDate', 'BatchSequence'])
      .where('AlignerBatchID', '=', batchId)
      .executeTakeFirst();
    if (!old) throw new Error('Aligner batch not found');
    if (AlignerSetID !== old.AlignerSetID) throw new Error('Cannot change AlignerSetID');

    const oldHasU = old.HasUpperTemplate ?? false;
    const oldHasL = old.HasLowerTemplate ?? false;
    const newHasU = HasUpperTemplate ?? oldHasU;
    const newHasL = HasLowerTemplate ?? oldHasL;

    if (newHasU || newHasL) {
      const earlier = await trx
        .selectFrom('tblAlignerBatches')
        .select('AlignerBatchID')
        .where('AlignerSetID', '=', AlignerSetID)
        .where('AlignerBatchID', '<>', batchId)
        .where('BatchSequence', '<', old.BatchSequence)
        .executeTakeFirst();
      if (earlier) throw new Error('Template flag can only be set on the first batch in a set');
    }
    if (newHasU && upper < 1) throw new Error('HasUpperTemplate = 1 requires UpperAlignerCount >= 1');
    if (newHasL && lower < 1) throw new Error('HasLowerTemplate = 1 requires LowerAlignerCount >= 1');

    const set = await trx
      .selectFrom('tblAlignerSets')
      .select(['RemainingUpperAligners', 'RemainingLowerAligners'])
      .where('AlignerSetID', '=', AlignerSetID)
      .forUpdate()
      .executeTakeFirst();
    const remU = set?.RemainingUpperAligners ?? 0;
    const remL = set?.RemainingLowerAligners ?? 0;
    const oldUpConsumed = (old.UpperAlignerCount ?? 0) - (oldHasU ? 1 : 0);
    const oldLoConsumed = (old.LowerAlignerCount ?? 0) - (oldHasL ? 1 : 0);
    const newUpConsumed = upper - (newHasU ? 1 : 0);
    const newLoConsumed = lower - (newHasL ? 1 : 0);
    if (newUpConsumed > remU + oldUpConsumed) throw new Error(`Cannot update aligner batch: requested upper aligners (${newUpConsumed}) exceed available count (${remU + oldUpConsumed})`);
    if (newLoConsumed > remL + oldLoConsumed) throw new Error(`Cannot update aligner batch: requested lower aligners (${newLoConsumed}) exceed available count (${remL + oldLoConsumed})`);

    if (IsLast === true) {
      await trx.updateTable('tblAlignerBatches').set({ IsLast: false }).where('AlignerSetID', '=', AlignerSetID).where('AlignerBatchID', '<>', batchId).where('IsLast', '=', true).execute();
    }
    if (IsActive === true) {
      if (!old.DeliveredToPatientDate) throw new Error('Cannot set IsActive: batch must be delivered first');
      await trx.updateTable('tblAlignerBatches').set({ IsActive: false }).where('AlignerSetID', '=', AlignerSetID).where('AlignerBatchID', '<>', batchId).where('IsActive', '=', true).execute();
    }

    const countsChanged = upper !== (old.UpperAlignerCount ?? 0) || lower !== (old.LowerAlignerCount ?? 0);
    const templateChanged = newHasU !== oldHasU || newHasL !== oldHasL;
    const daysChanged = (Days ?? null) !== (old.Days ?? null);

    await trx
      .updateTable('tblAlignerBatches')
      .set({
        UpperAlignerCount: upper,
        LowerAlignerCount: lower,
        Days: Days ?? null,
        Notes: Notes || null,
        IsActive: IsActive ?? undefined,
        IsLast: IsLast ?? undefined,
        HasUpperTemplate: newHasU,
        HasLowerTemplate: newHasL,
      })
      .where('AlignerBatchID', '=', batchId)
      .execute();

    if (countsChanged || templateChanged) {
      await resequenceBatches(trx, AlignerSetID);
    }

    const upperDelta = newUpConsumed - oldUpConsumed;
    const lowerDelta = newLoConsumed - oldLoConsumed;
    if (upperDelta !== 0 || lowerDelta !== 0) {
      await trx
        .updateTable('tblAlignerSets')
        .set({ RemainingUpperAligners: remU - upperDelta, RemainingLowerAligners: remL - lowerDelta })
        .where('AlignerSetID', '=', AlignerSetID)
        .execute();
    }

    if (daysChanged) {
      await trx
        .insertInto('tblAlignerActivityFlags')
        .values({
          AlignerSetID,
          ActivityType: 'DaysChanged',
          ActivityDescription: `Days changed from ${old.Days ?? 'not set'} to ${Days ?? 'not set'}`,
          RelatedRecordID: batchId,
        })
        .execute();
    }
  });

  // usp_UpdateAlignerBatch returned no result set → no deactivated-batch info.
  return null;
}

/**
 * Update batch status using consolidated stored procedure
 *
 * Actions:
 * - MANUFACTURE: Sets ManufactureDate = @targetDate or GETDATE()
 *                If @targetDate provided and already manufactured, updates date
 * - DELIVER: Sets DeliveredToPatientDate = @targetDate or GETDATE()
 *            BatchExpiryDate is auto-computed from DeliveredToPatientDate + (Days * AlignerCount)
 *            If batch is latest (highest BatchSequence) AND not already active:
 *            - Deactivates other batches in the set
 *            - Activates this batch
 * - UNDO_MANUFACTURE: Clears ManufactureDate (requires batch not yet delivered)
 * - UNDO_DELIVERY: Clears DeliveredToPatientDate (BatchExpiryDate auto-clears as computed)
 *
 * @param batchId - The batch ID to update
 * @param action - The action to perform
 * @param targetDate - Optional date for backdating/correction. If null, uses GETDATE()
 * @returns Result with operation info and activation status
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function updateBatchStatus(
  batchId: number,
  action: 'MANUFACTURE' | 'DELIVER' | 'UNDO_MANUFACTURE' | 'UNDO_DELIVERY',
  targetDate?: Date | null
): Promise<UpdateBatchStatusResult> {
  const target = targetDate ? toDateOnly(targetDate) : null;

  return withPgTransaction(async (trx) => {
    const batch = await trx
      .selectFrom('tblAlignerBatches')
      .select(['AlignerSetID', 'BatchSequence', 'ManufactureDate', 'DeliveredToPatientDate', 'IsActive'])
      .where('AlignerBatchID', '=', batchId)
      .forUpdate()
      .executeTakeFirst();
    if (!batch) throw new Error('Aligner batch not found');

    const setId = batch.AlignerSetID;
    const batchSequence = batch.BatchSequence;
    const isCurrentlyActive = batch.IsActive ?? false;
    const manufactured = !!batch.ManufactureDate;
    const delivered = !!batch.DeliveredToPatientDate;
    const today = toDateOnly(new Date());

    const base = {
      batchId, batchSequence, setId, action,
      success: true, wasActivated: false, wasAlreadyActive: isCurrentlyActive,
      wasAlreadyDelivered: false, previouslyActiveBatchSequence: null as number | null,
    };

    if (action === 'MANUFACTURE') {
      if (manufactured && target === null) {
        return { ...base, message: 'Batch already manufactured' };
      }
      await trx.updateTable('tblAlignerBatches').set({ ManufactureDate: target ?? today }).where('AlignerBatchID', '=', batchId).execute();
      return { ...base, message: manufactured ? 'Manufacture date updated' : 'Batch marked as manufactured' };
    }

    if (action === 'DELIVER') {
      if (!manufactured) throw new Error('Cannot deliver: batch not yet manufactured');
      if (delivered && target === null) {
        return { ...base, wasAlreadyDelivered: true, message: 'Batch already delivered' };
      }
      await trx.updateTable('tblAlignerBatches').set({ DeliveredToPatientDate: target ?? today }).where('AlignerBatchID', '=', batchId).execute();

      const maxSeq = await trx
        .selectFrom('tblAlignerBatches')
        .select((eb) => eb.fn.max('BatchSequence').as('m'))
        .where('AlignerSetID', '=', setId)
        .executeTakeFirst();

      let wasActivated = false;
      let previouslyActiveBatchSequence: number | null = null;
      if (batchSequence === maxSeq?.m && !isCurrentlyActive) {
        const prev = await trx
          .selectFrom('tblAlignerBatches')
          .select('BatchSequence')
          .where('AlignerSetID', '=', setId)
          .where('IsActive', '=', true)
          .where('AlignerBatchID', '<>', batchId)
          .limit(1)
          .executeTakeFirst();
        previouslyActiveBatchSequence = prev?.BatchSequence ?? null;
        await trx.updateTable('tblAlignerBatches').set({ IsActive: false }).where('AlignerSetID', '=', setId).where('AlignerBatchID', '<>', batchId).where('IsActive', '=', true).execute();
        await trx.updateTable('tblAlignerBatches').set({ IsActive: true }).where('AlignerBatchID', '=', batchId).execute();
        wasActivated = true;
      }
      return { ...base, wasActivated, previouslyActiveBatchSequence, message: delivered ? 'Delivery date updated' : 'Batch marked as delivered' };
    }

    if (action === 'UNDO_MANUFACTURE') {
      if (delivered) throw new Error('Cannot undo manufacture: batch already delivered. Undo delivery first.');
      await trx.updateTable('tblAlignerBatches').set({ ManufactureDate: null }).where('AlignerBatchID', '=', batchId).execute();
      return { ...base, message: 'Manufacture undone' };
    }

    if (action === 'UNDO_DELIVERY') {
      await trx.updateTable('tblAlignerBatches').set({ DeliveredToPatientDate: null, IsActive: false }).where('AlignerBatchID', '=', batchId).execute();
      return { ...base, message: 'Delivery undone (batch deactivated)' };
    }

    throw new Error('Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY');
  });
}

/**
 * Delete a batch using optimized stored procedure
 *
 * Phase 5: reimplemented as a TS write path; still routes to the proc stub for now.
 */
export async function deleteBatch(batchId: number): Promise<void> {
  await withPgTransaction(async (trx) => {
    const batch = await trx
      .selectFrom('tblAlignerBatches')
      .select(['AlignerSetID', 'UpperAlignerCount', 'LowerAlignerCount', 'HasUpperTemplate', 'HasLowerTemplate'])
      .where('AlignerBatchID', '=', batchId)
      .executeTakeFirst();
    if (!batch) throw new Error('Aligner batch not found');

    await trx.deleteFrom('tblAlignerBatches').where('AlignerBatchID', '=', batchId).execute();

    const upperRestored = (batch.UpperAlignerCount ?? 0) - (batch.HasUpperTemplate ? 1 : 0);
    const lowerRestored = (batch.LowerAlignerCount ?? 0) - (batch.HasLowerTemplate ? 1 : 0);
    await sql`
      UPDATE "tblAlignerSets"
      SET "RemainingUpperAligners" = "RemainingUpperAligners" + ${upperRestored},
          "RemainingLowerAligners" = "RemainingLowerAligners" + ${lowerRestored}
      WHERE "AlignerSetID" = ${batch.AlignerSetID}
    `.execute(trx);

    await resequenceBatches(trx, batch.AlignerSetID);
  });
}

// ==============================
// ALIGNER NOTES QUERIES
// ==============================

/**
 * Get notes for an aligner set
 */
export async function getNotesBySetId(setId: number): Promise<AlignerNote[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblAlignerNotes as n')
      .innerJoin('tblAlignerSets as s', 'n.AlignerSetID', 's.AlignerSetID')
      .innerJoin('AlignerDoctors as d', 's.AlignerDrID', 'd.DrID')
      .where('n.AlignerSetID', '=', setId)
      .select((eb) => [
        'n.NoteID',
        'n.AlignerSetID',
        'n.NoteType',
        'n.NoteText',
        eb.ref('n.CreatedAt').$castTo<Date>().as('CreatedAt'),
        'n.IsEdited',
        eb.ref('n.EditedAt').$castTo<Date | null>().as('EditedAt'),
        'n.IsRead',
        'd.DoctorName',
      ])
      .orderBy('n.CreatedAt', 'desc')
      .execute();

    return rows.map((r) => ({
      NoteID: r.NoteID,
      AlignerSetID: r.AlignerSetID,
      NoteType: r.NoteType as 'Lab' | 'Doctor',
      NoteText: r.NoteText,
      CreatedAt: r.CreatedAt,
      IsEdited: !!r.IsEdited,
      EditedAt: r.EditedAt,
      IsRead: r.IsRead,
      DoctorName: r.DoctorName,
    }));
  } catch (err) {
    log.error('Failed to get notes by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Check if aligner set exists
 */
export async function alignerSetExists(setId: number): Promise<boolean> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerSets')
      .select('AlignerSetID')
      .where('AlignerSetID', '=', setId)
      .executeTakeFirst();

    return !!row;
  } catch (err) {
    log.error('Failed to check if aligner set exists', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Create a note
 *
 * FLAG (Phase 5 / trigger-dependent): SQL Server `trg_AlignerNotes_DoctorActivity` fires
 * on INSERT here to maintain doctor-activity flags. That trigger is absent in PG; this
 * statement is translated as the raw INSERT only.
 */
export async function createNote(
  setId: number,
  noteText: string,
  noteType: 'Lab' | 'Doctor' = 'Lab'
): Promise<number | null> {
  try {
    return await withPgTransaction(async (trx) => {
      const row = await trx
        .insertInto('tblAlignerNotes')
        .values({
          AlignerSetID: setId,
          NoteType: noteType,
          NoteText: noteText.trim(),
        })
        .returning('NoteID')
        .executeTakeFirstOrThrow();

      // trg_AlignerNotes_DoctorActivity: a Doctor note logs a "DoctorNote" activity flag.
      if (noteType === 'Doctor') {
        const doc = await trx
          .selectFrom('tblAlignerSets as s')
          .leftJoin('AlignerDoctors as d', 'd.DrID', 's.AlignerDrID')
          .where('s.AlignerSetID', '=', setId)
          .select('d.DoctorName')
          .executeTakeFirst();
        await trx
          .insertInto('tblAlignerActivityFlags')
          .values({
            AlignerSetID: setId,
            ActivityType: 'DoctorNote',
            ActivityDescription: `Dr. ${doc?.DoctorName ?? 'Unknown'} added a note`,
            RelatedRecordID: row.NoteID,
          })
          .execute();
      }

      return row.NoteID;
    });
  } catch (err) {
    log.error('Failed to create note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface NoteInfo {
  NoteID: number;
  NoteType: 'Lab' | 'Doctor';
}

/**
 * Check if note exists
 */
export async function getNoteById(noteId: number): Promise<NoteInfo | null> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerNotes')
      .select(['NoteID', 'NoteType'])
      .where('NoteID', '=', noteId)
      .executeTakeFirst();

    if (!row) return null;
    return { NoteID: row.NoteID, NoteType: row.NoteType as 'Lab' | 'Doctor' };
  } catch (err) {
    log.error('Failed to get note by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update a note
 */
export async function updateNote(noteId: number, noteText: string): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerNotes')
      .set({ NoteText: noteText.trim(), IsEdited: true, EditedAt: sql`localtimestamp` })
      .where('NoteID', '=', noteId)
      .execute();
  } catch (err) {
    log.error('Failed to update note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Toggle note read status
 */
export async function toggleNoteReadStatus(noteId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerNotes')
      .set((eb) => ({
        IsRead: sql<boolean>`case when ${eb.ref('IsRead')} = true then false else true end`,
      }))
      .where('NoteID', '=', noteId)
      .execute();
  } catch (err) {
    log.error('Failed to toggle note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: number): Promise<void> {
  try {
    await getKysely().deleteFrom('tblAlignerNotes').where('NoteID', '=', noteId).execute();
  } catch (err) {
    log.error('Failed to delete note', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get note read status
 */
export async function getNoteReadStatus(noteId: number): Promise<boolean | null> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerNotes')
      .select('IsRead')
      .where('NoteID', '=', noteId)
      .executeTakeFirst();

    return row ? row.IsRead : null;
  } catch (err) {
    log.error('Failed to get note read status', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER ACTIVITY FLAGS QUERIES
// ==============================

/**
 * Get unread activities for a set
 */
export async function getUnreadActivitiesBySetId(setId: number): Promise<AlignerActivity[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblAlignerActivityFlags')
      .where('AlignerSetID', '=', setId)
      .where('IsRead', '=', false)
      .select((eb) => [
        'ActivityID',
        'AlignerSetID',
        'ActivityType',
        'ActivityDescription',
        eb.ref('CreatedAt').$castTo<Date>().as('CreatedAt'),
        'IsRead',
        eb.ref('ReadAt').$castTo<Date | null>().as('ReadAt'),
        'RelatedRecordID',
      ])
      .orderBy('CreatedAt', 'desc')
      .execute();

    return rows.map((r) => ({
      ActivityID: r.ActivityID,
      AlignerSetID: r.AlignerSetID,
      ActivityType: r.ActivityType,
      ActivityDescription: r.ActivityDescription,
      CreatedAt: r.CreatedAt,
      IsRead: !!r.IsRead,
      ReadAt: r.ReadAt,
      RelatedRecordID: r.RelatedRecordID,
    }));
  } catch (err) {
    log.error('Failed to get unread activities by set id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Mark an activity as read
 */
export async function markActivityAsRead(activityId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerActivityFlags')
      .set({ IsRead: true, ReadAt: sql`localtimestamp` })
      .where('ActivityID', '=', activityId)
      .execute();
  } catch (err) {
    log.error('Failed to mark activity as read', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Mark all activities for a set as read
 */
export async function markAllActivitiesAsRead(setId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerActivityFlags')
      .set({ IsRead: true, ReadAt: sql`localtimestamp` })
      .where('AlignerSetID', '=', setId)
      .where('IsRead', '=', false)
      .execute();
  } catch (err) {
    log.error('Failed to mark all activities as read', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ALIGNER PAYMENTS QUERIES
// ==============================

/**
 * Add payment for an aligner set
 *
 * FLAG (date-string): `tblInvoice.Dateofpayment` is a PG `date` column; the value is
 * bound as a 'YYYY-MM-DD' string (via toDateOnly) wrapped in `sql<Date>` so PG infers the
 * date type and the column isn't shifted by a UTC conversion (see CLAUDE.md date gotcha).
 * `Amountpaid`/`ActualAmount`/`Change`/`USDReceived`/`IQDReceived` are plain integer columns.
 */
export async function createAlignerPayment(
  paymentData: AlignerPaymentData
): Promise<number | null> {
  const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } =
    paymentData;

  // Determine USD vs IQD based on currency (default to USD for aligner payments)
  const currency = ActualCur || 'USD';
  const parsedAmount = typeof Amountpaid === 'string' ? parseFloat(Amountpaid) : Amountpaid;
  const amount = Math.round(parsedAmount); // Round to integer for USDReceived/IQDReceived columns
  const usdReceived = currency === 'USD' ? amount : 0;
  const iqdReceived = currency === 'IQD' ? amount : 0;

  log.info('Creating aligner payment', {
    workid,
    AlignerSetID,
    Amountpaid,
    currency,
    usdReceived,
    iqdReceived,
  });

  try {
    const dateStr = toDateOnly(new Date(Dateofpayment as string));
    const paidAmount =
      typeof Amountpaid === 'string' ? parseFloat(Amountpaid) : Amountpaid;

    const row = await getKysely()
      .insertInto('tblInvoice')
      .values({
        workid,
        Amountpaid: Math.round(paidAmount),
        Dateofpayment: sql<Date>`${dateStr}`,
        ActualAmount: ActualAmount ?? null,
        ActualCur: ActualCur || null,
        Change: Change ?? null,
        AlignerSetID: AlignerSetID || null,
        USDReceived: usdReceived,
        IQDReceived: iqdReceived,
      })
      .returning('invoiceID')
      .executeTakeFirstOrThrow();

    return row.invoiceID;
  } catch (err) {
    log.error('Failed to create aligner payment', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get aligner set balance information for validation.
 *
 * FLAG (inlined view): `vw_AlignerSetPayments` is absent from the PG schema (Phase 5);
 * its SetCost / TotalPaid / Balance logic is inlined as a single aggregate query.
 */
export async function getAlignerSetBalance(alignerSetId: number): Promise<AlignerSetBalance | null> {
  try {
    const row = await getKysely()
      .selectFrom('tblAlignerSets as s')
      .leftJoin('tblInvoice as i', 's.AlignerSetID', 'i.AlignerSetID')
      .where('s.AlignerSetID', '=', alignerSetId)
      .groupBy(['s.AlignerSetID', 's.SetCost'])
      .select((eb) => [
        's.AlignerSetID',
        eb.ref('s.SetCost').$castTo<number | null>().as('SetCost'),
        eb.fn.coalesce(eb.fn.sum('i.Amountpaid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
        sql<number | null>`${eb.ref('s.SetCost')} - coalesce(sum(i."Amountpaid"), 0)`.as('Balance'),
      ])
      .executeTakeFirst();

    if (!row) return null;
    return {
      AlignerSetID: row.AlignerSetID,
      SetCost: row.SetCost,
      TotalPaid: row.TotalPaid,
      Balance: row.Balance,
    };
  } catch (err) {
    log.error('Failed to get aligner set balance', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// LABEL GENERATION QUERIES
// ==============================

/**
 * Get a single batch by ID
 */
export async function getBatchById(batchId: number): Promise<AlignerBatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblAlignerBatches')
      .where('AlignerBatchID', '=', batchId)
      .select((eb) => [
        'AlignerBatchID',
        'AlignerSetID',
        'BatchSequence',
        'UpperAlignerCount',
        'LowerAlignerCount',
        'UpperAlignerStartSequence',
        'UpperAlignerEndSequence',
        'LowerAlignerStartSequence',
        'LowerAlignerEndSequence',
        eb.ref('CreationDate').$castTo<Date>().as('CreationDate'),
        eb.ref('ManufactureDate').$castTo<Date | null>().as('ManufactureDate'),
        eb.ref('DeliveredToPatientDate').$castTo<Date | null>().as('DeliveredToPatientDate'),
        'Days',
        'Notes',
        'IsActive',
        'IsLast',
        'HasUpperTemplate',
        'HasLowerTemplate',
      ])
      .execute();

    return rows.map((r) => ({
      AlignerBatchID: r.AlignerBatchID,
      AlignerSetID: r.AlignerSetID,
      BatchSequence: r.BatchSequence,
      UpperAlignerCount: r.UpperAlignerCount,
      LowerAlignerCount: r.LowerAlignerCount,
      UpperAlignerStartSequence: r.UpperAlignerStartSequence,
      UpperAlignerEndSequence: r.UpperAlignerEndSequence,
      LowerAlignerStartSequence: r.LowerAlignerStartSequence,
      LowerAlignerEndSequence: r.LowerAlignerEndSequence,
      CreationDate: r.CreationDate,
      ManufactureDate: r.ManufactureDate,
      DeliveredToPatientDate: r.DeliveredToPatientDate,
      Days: r.Days,
      ValidityPeriod: null,
      BatchExpiryDate: null,
      Notes: r.Notes,
      IsActive: !!r.IsActive,
      IsLast: r.IsLast,
      HasUpperTemplate: r.HasUpperTemplate,
      HasLowerTemplate: r.HasLowerTemplate,
    }));
  } catch (err) {
    log.error('Failed to get batch by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ==============================
// ARCHFORM MATCHING QUERIES
// ==============================

export interface AlignerSetForMatch {
  AlignerSetID: number;
  WorkID: number;
  PersonID: number;
  ArchformID: number | null;
  PatientName: string;
  SetSequence: number | null;
  DoctorName: string;
}

/**
 * Get all aligner sets with patient context for Archform matching
 */
export async function getSetsWithArchformIds(): Promise<AlignerSetForMatch[]> {
  try {
    const rows = await getKysely()
      .selectFrom('tblAlignerSets as s')
      .innerJoin('tblwork as w', 's.WorkID', 'w.workid')
      .innerJoin('tblpatients as p', 'w.PersonID', 'p.PersonID')
      .leftJoin('AlignerDoctors as ad', 's.AlignerDrID', 'ad.DrID')
      .select((eb) => [
        's.AlignerSetID',
        's.WorkID',
        'p.PersonID',
        's.ArchformID',
        'p.PatientName',
        'p.FirstName',
        'p.LastName',
        's.SetSequence',
        eb.fn.coalesce('ad.DoctorName', sql<string>`''`).as('DoctorName'),
      ])
      .orderBy('p.PatientName')
      .execute();

    return rows as unknown as AlignerSetForMatch[];
  } catch (err) {
    log.error('Failed to get sets with archform ids', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Update the ArchformID on an aligner set (set or clear)
 */
export async function updateArchformId(
  setId: number,
  archformId: number | null
): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerSets')
      .set({ ArchformID: archformId })
      .where('AlignerSetID', '=', setId)
      .execute();
  } catch (err) {
    log.error('Failed to update archform id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Clear ArchformID from all aligner sets that reference a given Archform patient.
 * Used before deleting an Archform patient to prevent orphaned references.
 */
export async function clearArchformIdByPatientId(archformPatientId: number): Promise<void> {
  try {
    await getKysely()
      .updateTable('tblAlignerSets')
      .set({ ArchformID: null })
      .where('ArchformID', '=', archformPatientId)
      .execute();
  } catch (err) {
    log.error('Failed to clear archform id by patient id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get a single doctor by ID
 */
export async function getDoctorById(drId: number): Promise<AlignerDoctor[]> {
  try {
    return (await getKysely()
      .selectFrom('AlignerDoctors')
      .select(['DrID', 'DoctorName', 'DoctorEmail', 'LogoPath'])
      .where('DrID', '=', drId)
      .execute()) as AlignerDoctor[];
  } catch (err) {
    log.error('Failed to get doctor by id', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
