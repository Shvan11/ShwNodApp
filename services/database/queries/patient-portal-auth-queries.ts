/**
 * Patient portal authentication queries
 *
 * Manages the tblPatientPortalAuth table: PIN hash, enabled flag,
 * failed-attempt lockout, and last-login tracking.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The MERGE upsert
 * became `ON CONFLICT (person_id) DO UPDATE` against the PK. timestamp columns
 * (`locked_until`, `last_login_at`, `created_at`, `updated_at`) are PG `timestamp` →
 * parsed to local Date by kysely.ts. `SYSUTCDATETIME()` → `now() AT TIME ZONE 'UTC'`
 * to preserve the UTC wall-clock the columns were written with.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

export interface PortalAuthRow {
  person_id: number;
  pin_hash: string;
  enabled: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const utcNow = sql<Date>`now() at time zone 'UTC'`;

export async function getAuthRow(personId: number): Promise<PortalAuthRow | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('patient_portal_auth')
    .where('person_id', '=', personId)
    .select([
      'person_id',
      'pin_hash',
      'enabled',
      'failed_attempts',
      'locked_until',
      'last_login_at',
      'created_at',
      'updated_at',
    ])
    .executeTakeFirst();

  return row ?? null;
}

export async function upsertPin(personId: number, pinHash: string): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('patient_portal_auth')
    .values({ person_id: personId, pin_hash: pinHash })
    .onConflict((oc) =>
      oc.column('person_id').doUpdateSet({
        pin_hash: pinHash,
        enabled: true,
        failed_attempts: 0,
        locked_until: null,
        updated_at: utcNow,
      })
    )
    .execute();
}

export async function recordSuccessfulLogin(personId: number): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('patient_portal_auth')
    .set({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: utcNow,
      updated_at: utcNow,
    })
    .where('person_id', '=', personId)
    .execute();
}

/**
 * Increment failed attempt count. If the (new) count >= 5, set locked_until to
 * 30 minutes from now. Returns the new failed_attempts and locked_until.
 */
export async function recordFailedAttempt(
  personId: number
): Promise<{ failedAttempts: number; lockedUntil: Date | null }> {
  const db = getKysely();
  const row = await db
    .updateTable('patient_portal_auth')
    .set((eb) => ({
      failed_attempts: eb('failed_attempts', '+', 1),
      locked_until: sql<Date | null>`case
        when ${eb.ref('failed_attempts')} + 1 >= 5 then (now() at time zone 'UTC') + interval '30 minutes'
        else ${eb.ref('locked_until')}
      end`,
      updated_at: utcNow,
    }))
    .where('person_id', '=', personId)
    .returning(['failed_attempts', 'locked_until'])
    .executeTakeFirst();

  return {
    failedAttempts: row?.failed_attempts ?? 0,
    lockedUntil: row?.locked_until ?? null,
  };
}

export async function setEnabled(personId: number, enabled: boolean): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('patient_portal_auth')
    .set({ enabled: enabled, updated_at: utcNow })
    .where('person_id', '=', personId)
    .execute();
}

export async function clearLockout(personId: number): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('patient_portal_auth')
    .set({ failed_attempts: 0, locked_until: null, updated_at: utcNow })
    .where('person_id', '=', personId)
    .execute();
}
