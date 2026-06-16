-- Partial composite index for per-doctor calendar views (date range × one doctor).
--
-- Applied directly via psql on 2026-06-16 (LOCAL + Supabase mirror), NOT via
-- `node-pg-migrate up` (squashed-baseline state — see the alerts-active-index
-- migration). CONCURRENTLY so the build never blocks writes on the hot
-- `appointments` table; therefore it MUST run OUTSIDE a transaction (no `-1`).
--
-- Why (COMMERCIAL multi-center product — see CLAUDE.md "Product direction"):
-- the largest realistic center is ~20 doctors × ~20 appts/day × ~247 working
-- days × ~20 years ≈ ~2M appointments, every row with a dr_id, and each doctor
-- mostly views their OWN calendar. getWeeklyCalendarSlots(…, doctorId) over a
-- month then touches ~8,300 in-range rows (all doctors) to surface one doctor's
-- ~415 — a ~20× waste. `(dr_id, app_date)` lets the planner seek dr_id = X then
-- range-scan app_date, reading only that doctor's slice.
--
-- PARTIAL on `dr_id IS NOT NULL` makes it self-sizing: at centers that rarely
-- assign a doctor (this clinic ≈ 94% NULL) it stays tiny and cheap; at
-- doctor-heavy centers it covers ~the whole table and serves the per-doctor view.
-- `WHERE dr_id = X` satisfies the partial predicate, so it stays usable. At THIS
-- clinic's tiny scale the planner may still prefer the plain app_date index — the
-- index earns its keep at larger/doctor-heavy deployments.
--
-- Deliberately NOT indexing the daily-by-doctor path: a single day is bounded by
-- daily chair capacity at ANY center size (≤ a few hundred rows), so ix_appday +
-- a dr filter scales fine without a dedicated index.

-- Up Migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_appointments_drid_appdate
  ON appointments USING btree (dr_id, app_date)
  WHERE dr_id IS NOT NULL;

-- Down Migration
DROP INDEX CONCURRENTLY IF EXISTS ix_appointments_drid_appdate;
