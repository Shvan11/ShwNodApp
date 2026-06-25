/**
 * Role registry — single source of truth for staff roles, imported by BOTH the
 * Express routes (relative `.js`) and the React app (`@shared` alias). The DB
 * `users.role` column is a free-form `citext` (no FK to a roles table), so this
 * module — not the generated `types/db.d.ts` — is the authority on what roles
 * exist, their labels, and which role groups gate which routes. Keep the DB
 * CHECK constraint (`chk_users_role`, `migrations/pg/*-role-registry.sql`) in
 * sync with `ALL_ROLES` by hand — there is no FK to enforce it automatically.
 *
 * Exactly three roles. `doctor` and the unused `'user'` default are retired —
 * doctors and assistants both use `clinical`.
 */

export const ROLES = {
  ADMIN: 'admin',
  FRONT_DESK: 'front_desk',
  CLINICAL: 'clinical',
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

// Kept as literal tuples (not widened to `UserRole[]`) so `z.enum(...)` can infer
// from them directly — see `shared/contracts/user-management.contract.ts`.
export const ALL_ROLES = [ROLES.ADMIN, ROLES.FRONT_DESK, ROLES.CLINICAL] as const;

/** Every role is user-assignable from the admin create/edit-user UI. */
export const ASSIGNABLE_ROLES = ALL_ROLES;

export const ROLE_LABELS: Record<UserRole, string> = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.FRONT_DESK]: 'Front Desk',
  [ROLES.CLINICAL]: 'Doctor / Assistant',
};

/** Clinic-wide settings & other admin-only reads/writes. */
export const ADMIN_ROLES = [ROLES.ADMIN] as const;

/** Money writes / front-desk operations (the renamed `secretary` tier). */
export const FINANCE_ROLES = [ROLES.ADMIN, ROLES.FRONT_DESK] as const;

/** Appointments, visits, diagnosis, photos, add-work, patient alerts & tasks. */
export const CLINICAL_ROLES = [ROLES.ADMIN, ROLES.FRONT_DESK, ROLES.CLINICAL] as const;

export interface RoleCapabilities {
  viewFinance: boolean;
  writeFinance: boolean;
  manageUsers: boolean;
}

/** Client-side show/hide capability flags derived from role — never re-derive ad hoc `isAdmin` booleans. */
export function roleCaps(role: UserRole | undefined): RoleCapabilities {
  const isAdmin = role === ROLES.ADMIN;
  const isFrontDesk = role === ROLES.FRONT_DESK;
  return {
    viewFinance: true,
    writeFinance: isAdmin || isFrontDesk,
    manageUsers: isAdmin,
  };
}

/**
 * Lower-cases and matches against `ALL_ROLES` — the `role` column is `citext`
 * (case-insensitive storage), but every JS-side role gate is case-sensitive, so
 * the session value must be normalized once at the write boundary (login).
 */
export function normalizeRole(s: string | undefined | null): UserRole | undefined {
  if (!s) return undefined;
  const lower = s.toLowerCase();
  return (ALL_ROLES as readonly string[]).includes(lower) ? (lower as UserRole) : undefined;
}
