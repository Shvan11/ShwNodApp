/**
 * Patient portal authentication queries
 *
 * Manages the `patient_portal_auth` table: PIN hash, enabled flag,
 * failed-attempt lockout, and last-login tracking.
 *
 * The upsert is `ON CONFLICT (person_id) DO UPDATE` against the PK. `locked_until`,
 * `last_login_at` and `created_at` are written with `now() AT TIME ZONE 'UTC'`, so
 * they hold a UTC wall clock, by design on both sides of the mirror
 * (migrations/supabase/mirror-timezone-2026-09-27.sql). (`updated_at` is LOCAL: the
 * `set_updated_at` trigger overwrites whatever is written.)
 *
 * So they must be READ as UTC. kysely.ts parses every `timestamp` as a LOCAL wall
 * clock, which put each of them 3 h in the past on a Baghdad server: `verifyPin`'s
 * `locked_until > now` was never true, so five wrong PINs printed "Account locked
 * for 30 minutes" and the right PIN still signed in on the next try, and the staff
 * card showed last-login times 3 h early (audit FE-F23-14). `asUtcInstant` converts
 * them in SQL to `timestamptz`, which pg parses as the real instant.
 */
import { sql, type RawBuilder } from 'kysely';
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

/** A UTC-wall-clock `timestamp` column as the instant it names (see the header). */
function asUtcInstant<C extends 'locked_until' | 'last_login_at' | 'created_at'>(
  column: C
): RawBuilder<C extends 'created_at' ? Date : Date | null> {
  return sql`${sql.ref(column)} at time zone 'UTC'`;
}

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
      asUtcInstant('locked_until').as('locked_until'),
      asUtcInstant('last_login_at').as('last_login_at'),
      asUtcInstant('created_at').as('created_at'),
      'updated_at',
    ])
    .executeTakeFirst();

  return row ?? null;
}

/**
 * Sign a patient out of the portal everywhere: delete their rows from the portal
 * session store.
 *
 * `authenticatePatient` trusts the session's `patientId` and never re-reads this
 * table, and the portal cookie is `rolling`, so without this, disabling a patient's
 * access or changing their PIN — the clinic's answer to "someone else has my PIN" —
 * changed nothing for a phone that was already signed in (audit FE-F23-3; FE-F22-1
 * is the staff twin). Returns the number of sessions ended.
 */
export async function endPortalSessions(personId: number): Promise<number> {
  const result = await sql`
    DELETE FROM "portal_sessions" WHERE "sess"->>'patientId' = ${String(personId)}
  `.execute(getKysely());
  return Number(result.numAffectedRows ?? 0n);
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
    .returning(['failed_attempts', asUtcInstant('locked_until').as('locked_until')])
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
