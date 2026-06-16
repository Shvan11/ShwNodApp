-- Partial index on the ACTIVE working set of alerts/tasks.
--
-- Applied directly via psql on 2026-06-16 (LOCAL + Supabase mirror), NOT via
-- `node-pg-migrate up` — the current squashed baseline (1781200000000) is not
-- recorded in pgmigrations, so `up` would attempt to replay it. Kept here as the
-- canonical record for the next baseline regeneration. Uses IF NOT EXISTS so it
-- is idempotent if a future `up` ever does run it.
--
-- Why: `alerts` backs both the per-patient Alerts and the app-wide header Tasks.
-- The two hot reads BOTH filter `status = 'active'`:
--   • getDailyAppointments hasActiveAlert (alert-queries.ts): WHERE person_id = ?
--     AND status = 'active' AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
--   • header Tasks feed: WHERE status = 'active' AND <date visibility predicates>
-- A PARTIAL index on the active rows stays tiny even as the table accrues
-- done/dismissed history unbounded over the years, so it only ever taxes writes
-- that touch an active row. Forward-looking: today the table is ~109 rows / 2
-- pages and Postgres correctly seq-scans it (the index won't be chosen until the
-- table grows), so this buys correctness of access path as the data accumulates,
-- not a measurable win today. Negligible write cost (clinic creates few tasks/day).
--
-- Deliberately NO appointments(app_day, dr_id) or appointments(dr_id, …) index for
-- the new "filter by doctor" feature: a daily query already narrows to one day
-- (<=58 rows ever) via ix_appday so the dr filter is free, and dr_id is
-- low-cardinality + 94% NULL (5 doctors over 67.8k rows) — indexing it would tax
-- every appointment write for ~zero read benefit. See the analysis in chat.

-- Up Migration
CREATE INDEX IF NOT EXISTS ix_alerts_active_person
  ON alerts USING btree (person_id)
  WHERE status = 'active';

-- Down Migration
DROP INDEX IF EXISTS ix_alerts_active_person;
