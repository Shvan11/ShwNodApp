/**
 * Staff user accounts (`users`) — the single owner of that table's SQL.
 *
 * Everything that reads or writes `users` goes through here: the admin CRUD
 * screen (`routes/api/user-management.routes.ts`), self-service password change
 * (`routes/auth.ts`) and credential verification (`middleware/auth.ts`). Before
 * this module those 12 statements were spread across the three files, which is
 * how the "last active admin" guard came to be enforced in the router rather
 * than next to the writes it protects.
 *
 * `role` is `citext`, so the admin comparison uses an explicit
 * `OPERATOR(public.=)` against a `public.citext` literal rather than relying on
 * the search_path.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import type { UserRole } from '../../../shared/auth/roles.js';

// `type` (not interface) — feeds a looseObject `sendData` response (users list).
export type UserListRow = {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
};

/** The credential row, password hash included — never leaves the auth layer. */
export type UserCredentials = {
  userId: number;
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
};

export type UserRoleStatus = { role: string; isActive: boolean };

/** All users, newest first. */
export async function listUsers(): Promise<UserListRow[]> {
  const { rows } = await sql<UserListRow>`
      SELECT "user_id" AS "userId", "username" AS "username", "full_name" AS "fullName",
             "role" AS "role", "is_active" AS "isActive", "last_login" AS "lastLogin",
             "created_at" AS "createdAt"
      FROM "users"
      ORDER BY "created_at" DESC`.execute(getKysely());
  return rows;
}

/** Credential row for a login/re-authentication attempt. */
export async function getUserCredentials(
  username: string
): Promise<UserCredentials | undefined> {
  const { rows } = await sql<UserCredentials>`
      SELECT "user_id" AS "userId", "username" AS "username", "password_hash" AS "passwordHash",
             "full_name" AS "fullName", "role" AS "role", "is_active" AS "isActive"
      FROM "users"
      WHERE "username" = ${username}
    `.execute(getKysely());
  return rows[0];
}

/** Stamp a successful sign-in. Not called for re-authentication. */
export async function stampLastLogin(userId: number): Promise<void> {
  await sql`UPDATE "users" SET "last_login" = LOCALTIMESTAMP WHERE "user_id" = ${userId}`.execute(
    getKysely()
  );
}

/** True when the username is already taken (citext — case-insensitive). */
export async function usernameExists(username: string): Promise<boolean> {
  const { rows } = await sql<{ userId: number }>`
        SELECT "user_id" AS "userId" FROM "users" WHERE "username" = ${username}`.execute(
    getKysely()
  );
  return rows.length > 0;
}

export async function createUser(data: {
  username: string;
  passwordHash: string;
  fullName: string;
  role: string;
  createdBy: string | undefined;
}): Promise<void> {
  await sql`
        INSERT INTO "users" ("username", "password_hash", "full_name", "role", "created_by")
        VALUES (${data.username}, ${data.passwordHash}, ${data.fullName}, ${data.role}, ${data.createdBy})`.execute(
    getKysely()
  );
}

export async function setUserPassword(userId: number, passwordHash: string): Promise<void> {
  await sql`UPDATE "users" SET "password_hash" = ${passwordHash} WHERE "user_id" = ${userId}`.execute(
    getKysely()
  );
}

export async function setUserRole(userId: number, role: string): Promise<void> {
  await sql`UPDATE "users" SET "role" = ${role} WHERE "user_id" = ${userId}`.execute(getKysely());
}

export async function toggleUserActive(userId: number): Promise<void> {
  await sql`UPDATE "users" SET "is_active" = NOT "is_active" WHERE "user_id" = ${userId}`.execute(
    getKysely()
  );
}

export async function deleteUser(userId: number): Promise<void> {
  await sql`DELETE FROM "users" WHERE "user_id" = ${userId}`.execute(getKysely());
}

/** Role + active flag for one user, or undefined when there is no such user. */
export async function getUserRoleStatus(userId: number): Promise<UserRoleStatus | undefined> {
  const { rows } = await sql<UserRoleStatus>`
    SELECT "role" AS "role", "is_active" AS "isActive" FROM "users" WHERE "user_id" = ${userId}
  `.execute(getKysely());
  return rows[0];
}

/**
 * Count active admins OTHER than `excludeUserId` (the target of a
 * demote/deactivate/delete) — the guard against removing the last admin and
 * locking everyone out.
 */
export async function countOtherActiveAdmins(excludeUserId: number): Promise<number> {
  const { rows } = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS "count" FROM "users"
    WHERE "role" OPERATOR(public.=) 'admin'::public.citext
      AND "is_active" = true
      AND "user_id" != ${excludeUserId}
  `.execute(getKysely());
  return rows[0]?.count ?? 0;
}
