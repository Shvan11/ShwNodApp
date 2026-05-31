/**
 * On-demand record fetch for the forward sync (PostgreSQL → Supabase).
 *
 * The unified CDC PortalSink (services/sync/cdc/portal-sink.ts) calls fetchRecordFromPg(portalTable,
 * id) to read the current row when draining a change. These helpers return the exact snake_case
 * column subsets the portal Supabase schema expects, so the upsert payloads are unchanged.
 *
 * Reads via Kysely over the pg pool.
 */
import { getKysely } from '../database/kysely.js';

export interface WorkRecord {
  work_id: number;
  person_id: number;
  type_of_work: string;
  addition_date: Date | string | null;
}

export interface PatientRecord {
  person_id: number;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

export interface AlignerSetRecord {
  aligner_set_id: number;
  work_id: number;
  aligner_dr_id: number;
  set_sequence: number | null;
  type: string | null;
  upper_aligners_count: number | null;
  lower_aligners_count: number | null;
  remaining_upper_aligners: number | null;
  remaining_lower_aligners: number | null;
  creation_date: Date | string | null;
  days: number | null;
  is_active: boolean | null;
  notes: string | null;
  folder_path: string | null;
  set_url: string | null;
  set_pdf_url: string | null;
  set_cost: number | null;
  currency: string | null;
  pdf_uploaded_at: Date | string | null;
  pdf_uploaded_by: string | null;
  drive_file_id: string | null;
}

export interface AlignerBatchRecord {
  aligner_batch_id: number;
  aligner_set_id: number;
  batch_sequence: number;
  upper_aligner_count: number;
  lower_aligner_count: number;
  upper_aligner_start_sequence: number | null;
  upper_aligner_end_sequence: number | null;
  lower_aligner_start_sequence: number | null;
  lower_aligner_end_sequence: number | null;
  manufacture_date: Date | string | null;
  delivered_to_patient_date: Date | string | null;
  days: number | null;
  validity_period: number | null;
  batch_expiry_date: Date | string | null;
  notes: string | null;
  is_active: boolean | null;
  has_upper_template: boolean;
  has_lower_template: boolean;
}

export interface DoctorRecord {
  dr_id: number;
  doctor_name: string;
  doctor_email: string | null;
  logo_path: string | null;
}

export interface NoteRecord {
  note_id: number;
  aligner_set_id: number;
  note_type: string;
  note_text: string;
  created_at: Date | string | null;
  is_edited: boolean | null;
  edited_at: Date | string | null;
  is_read: boolean | null;
}

export type SyncRecord =
  | WorkRecord
  | PatientRecord
  | AlignerSetRecord
  | AlignerBatchRecord
  | DoctorRecord
  | NoteRecord;

export async function fetchWorkFromPg(workId: number): Promise<WorkRecord | null> {
  const row = await getKysely()
    .selectFrom('tblwork')
    .select(['workid', 'PersonID', 'Typeofwork', 'AdditionDate'])
    .where('workid', '=', workId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    work_id: row.workid,
    person_id: row.PersonID,
    type_of_work: row.Typeofwork as unknown as string,
    addition_date: row.AdditionDate as Date | string | null,
  };
}

export async function fetchPatientFromPg(personId: number): Promise<PatientRecord | null> {
  const row = await getKysely()
    .selectFrom('tblpatients')
    .select(['PersonID', 'PatientName', 'FirstName', 'LastName', 'Phone'])
    .where('PersonID', '=', personId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    person_id: row.PersonID,
    patient_name: row.PatientName,
    first_name: row.FirstName,
    last_name: row.LastName,
    phone: row.Phone,
  };
}

export async function fetchAlignerSetFromPg(alignerSetId: number): Promise<AlignerSetRecord | null> {
  const row = await getKysely()
    .selectFrom('tblAlignerSets')
    .select([
      'AlignerSetID',
      'WorkID',
      'AlignerDrID',
      'SetSequence',
      'Type',
      'UpperAlignersCount',
      'LowerAlignersCount',
      'RemainingUpperAligners',
      'RemainingLowerAligners',
      'CreationDate',
      'Days',
      'IsActive',
      'Notes',
      'FolderPath',
      'SetUrl',
      'SetPdfUrl',
      'SetCost',
      'Currency',
      'PdfUploadedAt',
      'PdfUploadedBy',
      'DriveFileId',
    ])
    .where('AlignerSetID', '=', alignerSetId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    aligner_set_id: row.AlignerSetID,
    work_id: row.WorkID,
    aligner_dr_id: row.AlignerDrID,
    set_sequence: row.SetSequence,
    type: row.Type,
    upper_aligners_count: row.UpperAlignersCount,
    lower_aligners_count: row.LowerAlignersCount,
    remaining_upper_aligners: row.RemainingUpperAligners,
    remaining_lower_aligners: row.RemainingLowerAligners,
    creation_date: row.CreationDate as Date | string | null,
    days: row.Days,
    is_active: row.IsActive,
    notes: row.Notes,
    folder_path: row.FolderPath,
    set_url: row.SetUrl,
    set_pdf_url: row.SetPdfUrl,
    set_cost: row.SetCost as number | null,
    currency: row.Currency,
    pdf_uploaded_at: row.PdfUploadedAt as Date | string | null,
    pdf_uploaded_by: row.PdfUploadedBy,
    drive_file_id: row.DriveFileId,
  };
}

export async function fetchAlignerBatchFromPg(batchId: number): Promise<AlignerBatchRecord | null> {
  const row = await getKysely()
    .selectFrom('tblAlignerBatches')
    .select([
      'AlignerBatchID',
      'AlignerSetID',
      'BatchSequence',
      'UpperAlignerCount',
      'LowerAlignerCount',
      'UpperAlignerStartSequence',
      'UpperAlignerEndSequence',
      'LowerAlignerStartSequence',
      'LowerAlignerEndSequence',
      'ManufactureDate',
      'DeliveredToPatientDate',
      'Days',
      'ValidityPeriod',
      'BatchExpiryDate',
      'Notes',
      'IsActive',
      'HasUpperTemplate',
      'HasLowerTemplate',
    ])
    .where('AlignerBatchID', '=', batchId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    aligner_batch_id: row.AlignerBatchID,
    aligner_set_id: row.AlignerSetID,
    batch_sequence: row.BatchSequence,
    upper_aligner_count: row.UpperAlignerCount,
    lower_aligner_count: row.LowerAlignerCount,
    upper_aligner_start_sequence: row.UpperAlignerStartSequence,
    upper_aligner_end_sequence: row.UpperAlignerEndSequence,
    lower_aligner_start_sequence: row.LowerAlignerStartSequence,
    lower_aligner_end_sequence: row.LowerAlignerEndSequence,
    manufacture_date: row.ManufactureDate as Date | string | null,
    delivered_to_patient_date: row.DeliveredToPatientDate as Date | string | null,
    days: row.Days,
    validity_period: row.ValidityPeriod,
    batch_expiry_date: row.BatchExpiryDate as Date | string | null,
    notes: row.Notes,
    is_active: row.IsActive,
    has_upper_template: row.HasUpperTemplate,
    has_lower_template: row.HasLowerTemplate,
  };
}

export async function fetchDoctorFromPg(drId: number): Promise<DoctorRecord | null> {
  const row = await getKysely()
    .selectFrom('AlignerDoctors')
    .select(['DrID', 'DoctorName', 'DoctorEmail', 'LogoPath'])
    .where('DrID', '=', drId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    dr_id: row.DrID,
    doctor_name: row.DoctorName,
    doctor_email: row.DoctorEmail,
    logo_path: row.LogoPath,
  };
}

export async function fetchNoteFromPg(noteId: number): Promise<NoteRecord | null> {
  const row = await getKysely()
    .selectFrom('tblAlignerNotes')
    .select(['NoteID', 'AlignerSetID', 'NoteType', 'NoteText', 'CreatedAt', 'IsEdited', 'EditedAt', 'IsRead'])
    .where('NoteID', '=', noteId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    note_id: row.NoteID,
    aligner_set_id: row.AlignerSetID,
    note_type: row.NoteType,
    note_text: row.NoteText,
    created_at: row.CreatedAt as Date | string | null,
    is_edited: row.IsEdited,
    edited_at: row.EditedAt as Date | string | null,
    is_read: row.IsRead,
  };
}

/**
 * Fetch the current state of one synced record by its SyncQueue (table, recordId).
 * Returns null if the row no longer exists (deleted before the queue drained).
 */
export async function fetchRecordFromPg(
  tableName: string,
  recordId: number
): Promise<SyncRecord | null> {
  switch (tableName) {
    case 'aligner_batches':
      return fetchAlignerBatchFromPg(recordId);
    case 'aligner_sets':
      return fetchAlignerSetFromPg(recordId);
    case 'aligner_doctors':
      return fetchDoctorFromPg(recordId);
    case 'aligner_notes':
      return fetchNoteFromPg(recordId);
    case 'work':
      return fetchWorkFromPg(recordId);
    case 'patients':
      return fetchPatientFromPg(recordId);
    default:
      throw new Error(`Unknown sync table type: ${tableName}`);
  }
}
