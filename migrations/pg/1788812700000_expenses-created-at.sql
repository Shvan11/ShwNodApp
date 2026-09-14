-- Up Migration
--
-- Give `expenses` a real insert timestamp, so the record-age authorization guard stops reading a
-- user-typed date.
--
-- WHY (the expenses half of audit finding F2.1): `requireRecordAge` lets a non-admin edit or
-- delete only a record "created today"; anything older goes to the approval queue. For expenses
-- the guard's only input was `expenses.expense_date` — the date the staff member types into the
-- expense form. So the check was self-certifying in both directions: type today's date onto a
-- month-old expense and it became freely deletable, while an expense genuinely entered today but
-- back-dated to last week could not be corrected by the person who had just entered it.
--
-- `invoices` was fixed by pointing the guard at `sys_start_time`, which that table already had.
-- `expenses` had no such column at all, so nothing but this migration could close it.
--
-- Naming/type follow the schema's dominant convention for a creation stamp (`created_at
-- timestamp WITHOUT time zone DEFAULT LOCALTIMESTAMP`, as on alerts / announcements /
-- lab_cases / message_log …) rather than the `invoices.sys_start_time` spelling, whose
-- `now() AT TIME ZONE 'UTC'` default stores UTC wall-clock and is the one creation stamp in the
-- schema that does NOT read as local time.
--
-- BACKFILL — deliberately `expense_date`, not `updated_at`:
--   * `updated_at` is bumped by trg_set_updated_at on every edit, so using it would hand any old
--     expense that was edited today a "created today" stamp — i.e. reopen the exact hole this
--     closes. It is also NULL on 3,999 of the 4,290 existing rows (the trigger postdates them).
--   * `expense_date::timestamp` (midnight of the typed day) reproduces today's guard verdict
--     EXACTLY for every existing row, so no historical expense changes permission class in
--     either direction. Only rows inserted from here on carry a true insert time.
--
-- The backfill runs under `app.cdc_origin = 'reverse'`, which makes both local triggers no-ops
-- (cdc_capture returns early; set_updated_at preserves the stored value). That is deliberate:
--   * without it, 4,290 rows would be captured and re-upserted to the mirror, and — worse —
--     trg_set_updated_at would stamp `updated_at = now()` on all of them, destroying the real
--     modification times and making every expense look edited today;
--   * the mirror does not need the replication: its own half
--     (migrations/supabase/expenses-created-at-2026-09-07.sql) computes the identical value from
--     the identical `expense_date`, so both sides converge deterministically.
--
-- ORDERING (docs/db-migrations.md): additive DDL goes on the MIRROR FIRST, so the forward sink —
-- which builds its column list from the local row — always has somewhere to land `created_at`.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS created_at timestamp without time zone;

-- (plain SET, not SET LOCAL: node-pg-migrate wraps this in a transaction, but the file must
-- behave identically when applied by hand through psql, where SET LOCAL would warn and no-op.)
SET app.cdc_origin = 'reverse';
UPDATE expenses SET created_at = expense_date::timestamp WHERE created_at IS NULL;
RESET app.cdc_origin;

ALTER TABLE expenses
  ALTER COLUMN created_at SET DEFAULT LOCALTIMESTAMP,
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN expenses.created_at IS
  'Row insert time (wall clock). The record-age authorization guard reads THIS, never the '
  'user-entered expense_date. Backfilled to expense_date::timestamp for rows predating it.';

-- Down Migration
--
-- Dropping the column sends getExpenseCreationDate back to `expense_date` (revert
-- middleware/time-based-auth.ts alongside it, or the guard's query 500s on a missing column and
-- requireRecordAge answers 500 "Authorization check failed" for every non-admin expense edit).

ALTER TABLE expenses
  DROP COLUMN IF EXISTS created_at;
