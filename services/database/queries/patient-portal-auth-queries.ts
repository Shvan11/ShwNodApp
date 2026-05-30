/**
 * Patient portal authentication queries
 *
 * Manages the tblPatientPortalAuth table: PIN hash, enabled flag,
 * failed-attempt lockout, and last-login tracking.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The MERGE upsert
 * became `ON CONFLICT (PersonID) DO UPDATE` against the PK. Timestamp columns
 * (`LockedUntil`, `LastLoginAt`, `CreatedAt`, `UpdatedAt`) are PG `timestamp` →
 * parsed to local Date by kysely.ts. `SYSUTCDATETIME()` → `now() AT TIME ZONE 'UTC'`
 * to preserve the UTC wall-clock the columns were written with.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

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

const utcNow = sql<Date>`now() at time zone 'UTC'`;

export async function getAuthRow(personId: number): Promise<PortalAuthRow | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblPatientPortalAuth')
    .where('PersonID', '=', personId)
    .select([
      'PersonID',
      'PinHash',
      'Enabled',
      'FailedAttempts',
      'LockedUntil',
      'LastLoginAt',
      'CreatedAt',
      'UpdatedAt',
    ])
    .executeTakeFirst();

  return row ?? null;
}

export async function upsertPin(personId: number, pinHash: string): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('tblPatientPortalAuth')
    .values({ PersonID: personId, PinHash: pinHash })
    .onConflict((oc) =>
      oc.column('PersonID').doUpdateSet({
        PinHash: pinHash,
        Enabled: true,
        FailedAttempts: 0,
        LockedUntil: null,
        UpdatedAt: utcNow,
      })
    )
    .execute();
}

export async function recordSuccessfulLogin(personId: number): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('tblPatientPortalAuth')
    .set({
      FailedAttempts: 0,
      LockedUntil: null,
      LastLoginAt: utcNow,
      UpdatedAt: utcNow,
    })
    .where('PersonID', '=', personId)
    .execute();
}

/**
 * Increment failed attempt count. If the (new) count >= 5, set LockedUntil to
 * 30 minutes from now. Returns the new FailedAttempts and LockedUntil.
 */
export async function recordFailedAttempt(
  personId: number
): Promise<{ failedAttempts: number; lockedUntil: Date | null }> {
  const db = getKysely();
  const row = await db
    .updateTable('tblPatientPortalAuth')
    .set((eb) => ({
      FailedAttempts: eb('FailedAttempts', '+', 1),
      LockedUntil: sql<Date | null>`case
        when ${eb.ref('FailedAttempts')} + 1 >= 5 then (now() at time zone 'UTC') + interval '30 minutes'
        else ${eb.ref('LockedUntil')}
      end`,
      UpdatedAt: utcNow,
    }))
    .where('PersonID', '=', personId)
    .returning(['FailedAttempts', 'LockedUntil'])
    .executeTakeFirst();

  return {
    failedAttempts: row?.FailedAttempts ?? 0,
    lockedUntil: row?.LockedUntil ?? null,
  };
}

export async function setEnabled(personId: number, enabled: boolean): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('tblPatientPortalAuth')
    .set({ Enabled: enabled, UpdatedAt: utcNow })
    .where('PersonID', '=', personId)
    .execute();
}

export async function clearLockout(personId: number): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('tblPatientPortalAuth')
    .set({ FailedAttempts: 0, LockedUntil: null, UpdatedAt: utcNow })
    .where('PersonID', '=', personId)
    .execute();
}
