/**
 * Private-photos queries
 *
 * Rows in tblPrivatePhotos mark photos that are HIDDEN from the patient
 * portal. Absence of a row = visible (public by default).
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `timepoint_code` /
 * `image_name` are `citext`, so the lookups/conflict key stay case-insensitive
 * (matches the old Arabic_CI_AS columns). The T-SQL MERGE upsert became an
 * `ON CONFLICT … DO NOTHING` against the (person_id, timepoint_code, image_name) PK.
 */
import { getKysely } from '../kysely.js';

export interface PrivatePhotoEntry {
  timepoint_code: string;
  image_name: string;
  marked_by: number | null;
  marked_at: Date;
}

export async function listPrivateForPatient(personId: number): Promise<PrivatePhotoEntry[]> {
  const db = getKysely();
  return db
    .selectFrom('private_photos')
    .where('person_id', '=', personId)
    .select(['timepoint_code', 'image_name', 'marked_by', 'marked_at'])
    .execute();
}

export async function listPrivateForTimepoint(
  personId: number,
  tp: string
): Promise<PrivatePhotoEntry[]> {
  const db = getKysely();
  return db
    .selectFrom('private_photos')
    .where('person_id', '=', personId)
    .where('timepoint_code', '=', tp)
    .select(['timepoint_code', 'image_name', 'marked_by', 'marked_at'])
    .execute();
}

export async function markPrivate(
  personId: number,
  tp: string,
  name: string,
  byUserId: number | null
): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('private_photos')
    .values({ person_id: personId, timepoint_code: tp, image_name: name, marked_by: byUserId })
    .onConflict((oc) => oc.columns(['person_id', 'timepoint_code', 'image_name']).doNothing())
    .execute();
}

export async function markPublic(personId: number, tp: string, name: string): Promise<void> {
  const db = getKysely();
  await db
    .deleteFrom('private_photos')
    .where('person_id', '=', personId)
    .where('timepoint_code', '=', tp)
    .where('image_name', '=', name)
    .execute();
}
