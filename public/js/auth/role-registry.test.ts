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
import { ALL_ROLES, ASSIGNABLE_ROLES, ROLE_LABELS, normalizeRole } from '@shared/auth/roles';
import { createUser, updateRole } from '@shared/contracts/user-management.contract';

const sorted = (xs: readonly string[]) => [...xs].sort();
const LEGACY = ['secretary', 'doctor', 'user', 'nonsense', ''] as const;

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
        createUser.body.safeParse({ username: 'u', password: 'secret6', role }).success
      ).toBe(true);
    }
  });

  it('the role contract enum rejects legacy / unknown roles', () => {
    for (const role of LEGACY) {
      expect(updateRole.body.safeParse({ role }).success).toBe(false);
      expect(
        createUser.body.safeParse({ username: 'u', password: 'secret6', role }).success
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
