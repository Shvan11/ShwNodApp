/**
 * Patient portal authentication queries
 *
 * Manages the dbo.tblPatientPortalAuth table: PIN hash, enabled flag,
 * failed-attempt lockout, and last-login tracking.
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES } from '../index.js';

export interface PortalAuthRow {
  PersonID: number;
  PinHash: string;
  Enabled: boolean;
  FailedAttempts: number;
  LockedUntil: Date | null;
  LastLoginAt: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date;
}

const mapAuthRow = (columns: ColumnValue[]): PortalAuthRow => {
  const row = {} as Record<string, unknown>;
  for (const c of columns) row[c.metadata.colName] = c.value;
  return {
    PersonID: row.PersonID as number,
    PinHash: row.PinHash as string,
    Enabled: Boolean(row.Enabled),
    FailedAttempts: row.FailedAttempts as number,
    LockedUntil: (row.LockedUntil as Date) ?? null,
    LastLoginAt: (row.LastLoginAt as Date) ?? null,
    CreatedAt: row.CreatedAt as Date,
    UpdatedAt: row.UpdatedAt as Date,
  };
};

export async function getAuthRow(personId: number): Promise<PortalAuthRow | null> {
  const rows = await executeQuery<PortalAuthRow>(
    `SELECT PersonID, PinHash, Enabled, FailedAttempts, LockedUntil, LastLoginAt, CreatedAt, UpdatedAt
     FROM dbo.tblPatientPortalAuth WHERE PersonID = @PID`,
    [['PID', TYPES.Int, personId]],
    mapAuthRow
  );
  return rows[0] ?? null;
}

export async function upsertPin(personId: number, pinHash: string): Promise<void> {
  await executeQuery(
    `MERGE dbo.tblPatientPortalAuth AS target
     USING (SELECT @PID AS PersonID) AS src
       ON target.PersonID = src.PersonID
     WHEN MATCHED THEN
       UPDATE SET PinHash = @Hash,
                  Enabled = 1,
                  FailedAttempts = 0,
                  LockedUntil = NULL,
                  UpdatedAt = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN
       INSERT (PersonID, PinHash) VALUES (@PID, @Hash);`,
    [
      ['PID', TYPES.Int, personId],
      ['Hash', TYPES.NVarChar, pinHash],
    ]
  );
}

export async function recordSuccessfulLogin(personId: number): Promise<void> {
  await executeQuery(
    `UPDATE dbo.tblPatientPortalAuth
     SET FailedAttempts = 0,
         LockedUntil = NULL,
         LastLoginAt = SYSUTCDATETIME(),
         UpdatedAt = SYSUTCDATETIME()
     WHERE PersonID = @PID`,
    [['PID', TYPES.Int, personId]]
  );
}

/**
 * Increment failed attempt count. If the (new) count >= 5, set LockedUntil to
 * 30 minutes from now. Returns the new FailedAttempts and LockedUntil.
 */
export async function recordFailedAttempt(
  personId: number
): Promise<{ failedAttempts: number; lockedUntil: Date | null }> {
  const rows = await executeQuery<{ FailedAttempts: number; LockedUntil: Date | null }>(
    `UPDATE dbo.tblPatientPortalAuth
     SET FailedAttempts = FailedAttempts + 1,
         LockedUntil = CASE
           WHEN FailedAttempts + 1 >= 5 THEN DATEADD(MINUTE, 30, SYSUTCDATETIME())
           ELSE LockedUntil
         END,
         UpdatedAt = SYSUTCDATETIME()
     OUTPUT INSERTED.FailedAttempts, INSERTED.LockedUntil
     WHERE PersonID = @PID`,
    [['PID', TYPES.Int, personId]],
    (columns) => {
      const r = {} as Record<string, unknown>;
      for (const c of columns) r[c.metadata.colName] = c.value;
      return {
        FailedAttempts: r.FailedAttempts as number,
        LockedUntil: (r.LockedUntil as Date) ?? null,
      };
    }
  );
  const row = rows[0];
  return {
    failedAttempts: row?.FailedAttempts ?? 0,
    lockedUntil: row?.LockedUntil ?? null,
  };
}

export async function setEnabled(personId: number, enabled: boolean): Promise<void> {
  await executeQuery(
    `UPDATE dbo.tblPatientPortalAuth
     SET Enabled = @En, UpdatedAt = SYSUTCDATETIME()
     WHERE PersonID = @PID`,
    [
      ['PID', TYPES.Int, personId],
      ['En', TYPES.Bit, enabled ? 1 : 0],
    ]
  );
}

export async function clearLockout(personId: number): Promise<void> {
  await executeQuery(
    `UPDATE dbo.tblPatientPortalAuth
     SET FailedAttempts = 0, LockedUntil = NULL, UpdatedAt = SYSUTCDATETIME()
     WHERE PersonID = @PID`,
    [['PID', TYPES.Int, personId]]
  );
}
