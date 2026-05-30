/**
 * Type guards for node-postgres (pg) error shapes.
 *
 * pg surfaces database errors as objects carrying a **string** `.code` (the
 * SQLSTATE, e.g. '23505'), plus `.constraint`, `.table`, `.column`, `.detail`.
 * The retired mssql driver instead used a numeric `.number` (e.g. 2601 for a
 * unique violation, 547 for FK/CHECK). Any handler still comparing `.number` is
 * dead under pg — use these predicates so call sites key off the SQLSTATE and the
 * constraint/index name pg actually reports, not the old mssql error numbers.
 *
 * See CLAUDE.md (Database → Gotchas): FK violations are SQLSTATE 23503.
 */

/** SQLSTATE codes the app branches on. */
export const PG_SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

/** The subset of a pg `DatabaseError` the app inspects when classifying failures. */
export interface PgDatabaseError extends Error {
  /** SQLSTATE string, e.g. '23505'. */
  code?: string;
  /** Constraint / index name pg reports for the violation. */
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

/** Narrow an unknown caught value to the inspectable pg-error shape. */
export function asPgError(error: unknown): PgDatabaseError {
  return (error ?? {}) as PgDatabaseError;
}

/**
 * True for a pg unique-violation (SQLSTATE 23505). When `constraint` is given,
 * also require the violated index/constraint to match: pg sets `.constraint` for
 * unique indexes, and (as a fallback for drivers/versions that don't) embeds the
 * name in the message text.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const err = asPgError(error);
  if (err.code !== PG_SQLSTATE.UNIQUE_VIOLATION) return false;
  if (!constraint) return true;
  return err.constraint === constraint || (err.message ?? '').includes(constraint);
}

/** True for a pg foreign-key violation (SQLSTATE 23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return asPgError(error).code === PG_SQLSTATE.FOREIGN_KEY_VIOLATION;
}

/** True for a pg NOT NULL violation (SQLSTATE 23502); optionally match the column. */
export function isNotNullViolation(error: unknown, column?: string): boolean {
  const err = asPgError(error);
  if (err.code !== PG_SQLSTATE.NOT_NULL_VIOLATION) return false;
  return !column || err.column === column;
}

/** True for a pg CHECK violation (SQLSTATE 23514); optionally match the constraint. */
export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const err = asPgError(error);
  if (err.code !== PG_SQLSTATE.CHECK_VIOLATION) return false;
  return !constraint || err.constraint === constraint;
}
