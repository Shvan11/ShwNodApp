/**
 * Private-photos queries
 *
 * Rows in tblPrivatePhotos mark photos that are HIDDEN from the patient
 * portal. Absence of a row = visible (public by default).
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `TimepointCode` /
 * `ImageName` are `citext`, so the lookups/conflict key stay case-insensitive
 * (matches the old Arabic_CI_AS columns). The T-SQL MERGE upsert became an
 * `ON CONFLICT … DO NOTHING` against the (PersonID, TimepointCode, ImageName) PK.
 */
import { getKysely } from '../kysely.js';

export interface PrivatePhotoEntry {
  TimepointCode: string;
  ImageName: string;
  MarkedBy: number | null;
  MarkedAt: Date;
}

export async function listPrivateForPatient(personId: number): Promise<PrivatePhotoEntry[]> {
  const db = getKysely();
  return db
    .selectFrom('tblPrivatePhotos')
    .where('PersonID', '=', personId)
    .select(['TimepointCode', 'ImageName', 'MarkedBy', 'MarkedAt'])
    .execute();
}

export async function listPrivateForTimepoint(
  personId: number,
  tp: string
): Promise<PrivatePhotoEntry[]> {
  const db = getKysely();
  return db
    .selectFrom('tblPrivatePhotos')
    .where('PersonID', '=', personId)
    .where('TimepointCode', '=', tp)
    .select(['TimepointCode', 'ImageName', 'MarkedBy', 'MarkedAt'])
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
    .insertInto('tblPrivatePhotos')
    .values({ PersonID: personId, TimepointCode: tp, ImageName: name, MarkedBy: byUserId })
    .onConflict((oc) => oc.columns(['PersonID', 'TimepointCode', 'ImageName']).doNothing())
    .execute();
}

export async function markPublic(personId: number, tp: string, name: string): Promise<void> {
  const db = getKysely();
  await db
    .deleteFrom('tblPrivatePhotos')
    .where('PersonID', '=', personId)
    .where('TimepointCode', '=', tp)
    .where('ImageName', '=', name)
    .execute();
}
