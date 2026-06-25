/**
 * Boot-time drift guard — assert the DB CHECK constraint `chk_users_role`
 * allows EXACTLY the roles in `ALL_ROLES` (the shared registry SSoT).
 *
 * `users.role` is free-form `citext` with no FK to a roles table, so the only
 * thing pinning a stored value to the three known roles is this CHECK
 * constraint, and the only thing pinning the JS-side gates to the same set is
 * `shared/auth/roles.ts`. Nothing links the two — a migration that changes the
 * allowed-set without touching the registry (or vice-versa) drifts silently.
 * This reads the live constraint definition at boot and compares its allowed
 * set to `ALL_ROLES`, logging loudly on any mismatch.
 *
 * Non-fatal by design: a transient read failure or a not-yet-applied migration
 * must never block boot, matching the rest of the boot sequence's tolerance for
 * DB hiccups (connection failure → background retry, not crash). The companion
 * `public/js/auth/role-registry.test.ts` guards registry ↔ contract at gate time.
 */
import { sql } from 'kysely';
import { getKysely } from './kysely.js';
import { ALL_ROLES } from '../../shared/auth/roles.js';
import { log } from '../../utils/logger.js';

const CONSTRAINT_NAME = 'chk_users_role';

export async function assertRoleConstraintMatchesRegistry(): Promise<void> {
  try {
    const res = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.conname = ${CONSTRAINT_NAME}
        AND t.relname = 'users'
        AND n.nspname = 'public'
    `.execute(getKysely());

    const def = res.rows[0]?.def;
    if (!def) {
      log.error(
        `Role drift guard: CHECK constraint "${CONSTRAINT_NAME}" is absent on public.users — ` +
          `the role allowed-set is unenforced at the DB. Apply migrations/pg/*-role-registry.sql.`,
        { expected: [...ALL_ROLES].sort() }
      );
      return;
    }

    // pg_get_constraintdef renders e.g.
    //   CHECK ((role OPERATOR(public.=) ANY (ARRAY['admin'::citext, 'front_desk'::citext, 'clinical'::citext])))
    // Every single-quoted literal is an allowed role name.
    const dbRoles = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const dbSet = new Set(dbRoles);
    const registrySet = new Set<string>(ALL_ROLES);

    const matches =
      dbSet.size === registrySet.size && [...registrySet].every((r) => dbSet.has(r));
    if (!matches) {
      log.error(
        `Role drift guard: DB CHECK "${CONSTRAINT_NAME}" allowed-set does not match ALL_ROLES — ` +
          `SQL ↔ registry have drifted. Reconcile the migration with shared/auth/roles.ts.`,
        { db: [...dbSet].sort(), registry: [...registrySet].sort() }
      );
      return;
    }

    log.info(
      `✅ Role drift guard: DB CHECK "${CONSTRAINT_NAME}" matches ALL_ROLES (${[...registrySet]
        .sort()
        .join(', ')}).`
    );
  } catch (err) {
    // A guard must never block boot — surface and continue.
    log.error('Role drift guard: failed to verify chk_users_role against the registry', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
