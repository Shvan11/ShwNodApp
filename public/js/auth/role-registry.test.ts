/**
 * Drift guard (gate-time) — the role allowed-set is authored once in
 * `shared/auth/roles.ts` (`ALL_ROLES`) but consumed in three places that can
 * silently diverge: the DB CHECK `chk_users_role`, the user-management contract
 * enum, and the JS-side gates. This test pins registry ↔ contract so a narrowed
 * or stale enum (the original `['admin','secretary']` bug) fails CI; the live
 * DB CHECK is verified separately at boot by
 * `services/database/role-constraint-check.ts`.
 *
 * Lives under public/js/** because vitest's glob is scoped there
 * (`vitest.config.ts`); the shared modules import via the `@shared` alias.
 */
import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  ALL_ROLES,
  ASSIGNABLE_ROLES,
  FINANCE_ROLES,
  ROLE_LABELS,
  normalizeRole,
  roleCaps,
} from '@shared/auth/roles';
import { createUser, updateRole } from '@shared/contracts/user-management.contract';
import { MIN_PASSWORD_LENGTH } from '@shared/validation';

const sorted = (xs: readonly string[]) => [...xs].sort();
const LEGACY = ['secretary', 'doctor', 'user', 'nonsense', ''] as const;

// Long enough for the shared MIN_PASSWORD_LENGTH floor — this suite is about
// ROLES, so the password must never be the reason a case fails.
const VALID_PASSWORD = 'x'.repeat(MIN_PASSWORD_LENGTH);

describe('role registry ↔ contract drift guard', () => {
  it('ROLE_LABELS covers exactly ALL_ROLES (no missing, no extras)', () => {
    expect(sorted(Object.keys(ROLE_LABELS))).toEqual(sorted(ALL_ROLES));
  });

  it('ASSIGNABLE_ROLES equals ALL_ROLES', () => {
    expect(sorted(ASSIGNABLE_ROLES)).toEqual(sorted(ALL_ROLES));
  });

  it('the role contract enum accepts exactly ALL_ROLES', () => {
    for (const role of ALL_ROLES) {
      expect(updateRole.body.safeParse({ role }).success).toBe(true);
      expect(
        createUser.body.safeParse({ username: 'u', password: VALID_PASSWORD, role }).success
      ).toBe(true);
    }
  });

  it('the role contract enum rejects legacy / unknown roles', () => {
    for (const role of LEGACY) {
      expect(updateRole.body.safeParse({ role }).success).toBe(false);
      expect(
        createUser.body.safeParse({ username: 'u', password: VALID_PASSWORD, role }).success
      ).toBe(false);
    }
  });

  it('normalizeRole accepts every role case-insensitively and rejects legacy', () => {
    for (const role of ALL_ROLES) {
      expect(normalizeRole(role.toUpperCase())).toBe(role);
    }
    for (const role of LEGACY) {
      expect(normalizeRole(role)).toBeUndefined();
    }
    expect(normalizeRole(undefined)).toBeUndefined();
    expect(normalizeRole(null)).toBeUndefined();
  });
});

/**
 * The UI's capability flags must say exactly what the SERVER's role sets allow, or a
 * screen offers a write that 403s at Save (FE-F6-6 / FE-F7-7) — or hides one a role
 * may make. Each flag is pinned to the role set its routes are gated on in
 * `app/__snapshots__/route-table.txt`.
 */
describe('roleCaps ↔ server role sets drift guard', () => {
  const inSet = (set: readonly string[], role: string) => set.includes(role);

  it('writeFinance / viewFinance / editRecords / manageLookups are exactly FINANCE_ROLES', () => {
    for (const role of ALL_ROLES) {
      const caps = roleCaps(role);
      expect(caps.writeFinance, role).toBe(inSet(FINANCE_ROLES, role));
      expect(caps.viewFinance, role).toBe(inSet(FINANCE_ROLES, role));
      expect(caps.editRecords, role).toBe(inSet(FINANCE_ROLES, role));
      expect(caps.manageLookups, role).toBe(inSet(FINANCE_ROLES, role));
    }
  });

  it('adminWrites / manageUsers are exactly ADMIN_ROLES', () => {
    for (const role of ALL_ROLES) {
      const caps = roleCaps(role);
      expect(caps.adminWrites, role).toBe(inSet(ADMIN_ROLES, role));
      expect(caps.manageUsers, role).toBe(inSet(ADMIN_ROLES, role));
    }
  });

  it('an unknown / missing role gets no capability at all (fail-closed)', () => {
    expect(Object.values(roleCaps(undefined)).every((v) => v === false)).toBe(true);
  });
});
