/**
 * Private-photos queries
 *
 * Rows in dbo.tblPrivatePhotos mark photos that are HIDDEN from the patient
 * portal. Absence of a row = visible (public by default).
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES } from '../index.js';

export interface PrivatePhotoEntry {
  TimepointCode: string;
  ImageName: string;
  MarkedBy: number | null;
  MarkedAt: Date;
}

const mapEntry = (columns: ColumnValue[]): PrivatePhotoEntry => {
  const r = {} as Record<string, unknown>;
  for (const c of columns) r[c.metadata.colName] = c.value;
  return {
    TimepointCode: r.TimepointCode as string,
    ImageName: r.ImageName as string,
    MarkedBy: (r.MarkedBy as number) ?? null,
    MarkedAt: r.MarkedAt as Date,
  };
};

export async function listPrivateForPatient(personId: number): Promise<PrivatePhotoEntry[]> {
  return executeQuery<PrivatePhotoEntry>(
    `SELECT TimepointCode, ImageName, MarkedBy, MarkedAt
     FROM dbo.tblPrivatePhotos WHERE PersonID = @PID`,
    [['PID', TYPES.Int, personId]],
    mapEntry
  );
}

export async function listPrivateForTimepoint(
  personId: number,
  tp: string
): Promise<PrivatePhotoEntry[]> {
  return executeQuery<PrivatePhotoEntry>(
    `SELECT TimepointCode, ImageName, MarkedBy, MarkedAt
     FROM dbo.tblPrivatePhotos WHERE PersonID = @PID AND TimepointCode = @TP`,
    [
      ['PID', TYPES.Int, personId],
      ['TP', TYPES.NVarChar, tp],
    ],
    mapEntry
  );
}

export async function markPrivate(
  personId: number,
  tp: string,
  name: string,
  byUserId: number | null
): Promise<void> {
  await executeQuery(
    `MERGE dbo.tblPrivatePhotos AS target
     USING (SELECT @PID AS PersonID, @TP AS TimepointCode, @Name AS ImageName) AS src
       ON target.PersonID = src.PersonID
      AND target.TimepointCode = src.TimepointCode
      AND target.ImageName = src.ImageName
     WHEN NOT MATCHED THEN
       INSERT (PersonID, TimepointCode, ImageName, MarkedBy)
       VALUES (@PID, @TP, @Name, @By);`,
    [
      ['PID', TYPES.Int, personId],
      ['TP', TYPES.NVarChar, tp],
      ['Name', TYPES.NVarChar, name],
      ['By', TYPES.Int, byUserId],
    ]
  );
}

export async function markPublic(personId: number, tp: string, name: string): Promise<void> {
  await executeQuery(
    `DELETE FROM dbo.tblPrivatePhotos
     WHERE PersonID = @PID AND TimepointCode = @TP AND ImageName = @Name`,
    [
      ['PID', TYPES.Int, personId],
      ['TP', TYPES.NVarChar, tp],
      ['Name', TYPES.NVarChar, name],
    ]
  );
}
