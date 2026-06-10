-- Up Migration
--
-- Index audit 2026-06-10 (live-stats + EXPLAIN driven; stats window = 12 days since cutover).
-- Two halves: (1) add indexes for EXPLAIN-confirmed seq-scan hot paths, (2) drop dead/redundant
-- indexes that tax every write on the hottest tables for zero (or duplicated) reads.
--
-- ⚠️ DDL parity: CDC replicates row DATA only — this exact DDL must also be applied to the
-- Supabase mirror (via SUPABASE_FAILOVER_DB_URL / scripts/psql.sh supa) in the same change.
-- All dropped indexes verified as plain indexes (no pg_constraint rows), so bare DROP INDEX is safe.
-- No column/type change → `npm run db:codegen` output is unchanged.

-- ── 1. Missing indexes on hot paths ────────────────────────────────────────────────────────────────

-- works: 3,153 seq scans / 22.4M tuples in 12 days. getWorksByPatient (patient Works tab,
-- work-queries.ts) and the patient-search work-type/keyword EXISTS subqueries
-- (patient.routes.ts) filter by person_id with NO status restriction, which the partial
-- unq_tblwork_active (person_id) WHERE status = 1 cannot serve.
CREATE INDEX ix_works_personid ON works USING btree (person_id);

-- visits: per-work visit history (visit-queries.ts asc/desc lists, latest-wires; work-queries.ts
-- visit counts) filters work_id and sorts by visit_date. The existing "visits$workid"
-- (visit_date, work_id) only supports that as a full-index filter scan (cost ~678 vs ~10 seek);
-- it is KEPT because it serves the daily-appointments EXISTS (visit_date = $date AND work_id = …).
CREATE INDEX ix_visits_workid_visitdate ON visits USING btree (work_id, visit_date);

-- message_status_history: unindexed FK to appointments with ON DELETE CASCADE — every appointment
-- delete and resetMessagingForDate's DELETE … WHERE appointment_id IN (…) (messaging-queries.ts)
-- seq-scans this append-only table (~30k rows/month).
CREATE INDEX ix_message_status_history_appointmentid
  ON message_status_history USING btree (appointment_id);

-- expenses: list filter + ORDER BY expense_date DESC, id DESC (expense-queries.ts) and date-range
-- report aggregations currently seq-scan + sort; the DESC,DESC key also eliminates the sort node.
CREATE INDEX ix_expenses_expensedate ON expenses USING btree (expense_date DESC, id DESC);

-- ── 2. Consolidate the two (app_date) covering indexes on appointments ─────────────────────────────

-- ix_tblappointments_appdate_optimized (773k scans) and ix_appdate_pid (455 scans, 3.6 MB) share the
-- same key; the only INCLUDE column the optimized one lacked was app_cost. Fold app_cost in, then
-- drop the duplicate.
DROP INDEX ix_tblappointments_appdate_optimized;
CREATE INDEX ix_tblappointments_appdate_optimized ON appointments USING btree (app_date)
  INCLUDE (appointment_id, app_detail, dr_id, person_id, present, seated, dismissed, app_cost);
DROP INDEX ix_appdate_pid;

-- ── 3. Dead / redundant index drops ────────────────────────────────────────────────────────────────

-- invoices: duplicate uniqueness of ind_uniquedate (same column pair, reversed order); access path
-- covered by ix_wid_date_sum. 944 kB, 0 scans.
DROP INDEX ix_statistics;

-- appointments: messaging day-queries all use ix_appday. 2.2 MB, 0 scans.
DROP INDEX ix_tblappointments_deliverystatus;

-- visits: migration-era whole-row dedupe guard — 16-column UNIQUE NULLS NOT DISTINCT incl. the PK
-- column id, so it enforces nothing meaningful; 2.7 MB taxing every visit write. 4 scans.
DROP INDEX "visits$uniquevisit";

-- works: UNIQUE (currency, work_id) — contains the PK column, so every pair is trivially unique;
-- SQL-Server indexed-view artifact. 0 scans.
DROP INDEX ix_currency;

-- works: status lookups go through unq_tblwork_active (413k scans); this one had 0.
DROP INDEX ix_tblwork_status;

-- aligner_batches: leading-prefix duplicate of uq_batchsequence_alignersetid (constraint, 91k scans)
-- and ix_tblalignerbatches_setid_mfgdate_batchid. 0 scans.
DROP INDEX ix_tblalignerbatches_alignersetid;

-- time_points: partial unique on dolphin_tp_id, a reserved column the Dolphin sink deliberately
-- never writes (it uses dolphin_sync_map instead — see CLAUDE.md Dolphin sync). 0 scans; was slated
-- to die with the sink anyway.
DROP INDEX ux_tbltimepoints_dolphintpid;

-- Down Migration

DROP INDEX ix_works_personid;
DROP INDEX ix_visits_workid_visitdate;
DROP INDEX ix_message_status_history_appointmentid;
DROP INDEX ix_expenses_expensedate;

-- Restore the pre-consolidation pair (exact pre-migration definitions).
DROP INDEX ix_tblappointments_appdate_optimized;
CREATE INDEX ix_tblappointments_appdate_optimized ON appointments USING btree (app_date)
  INCLUDE (appointment_id, app_detail, dr_id, person_id, present, seated, dismissed);
CREATE INDEX ix_appdate_pid ON appointments USING btree (app_date)
  INCLUDE (person_id, appointment_id, app_detail, app_cost);

-- Restore dropped indexes (exact pre-migration definitions).
CREATE UNIQUE INDEX ix_statistics ON invoices USING btree (work_id, date_of_payment)
  INCLUDE (amount_paid);
CREATE INDEX ix_tblappointments_deliverystatus ON appointments
  USING btree (app_day, sent_wa, delivered_wa);
CREATE UNIQUE INDEX "visits$uniquevisit" ON visits USING btree
  (id, bracket_change, wire_bending, opg, others, next_visit, elastics, upper_wire_id,
   lower_wire_id, p_photo, i_photo, f_photo, appliance_removed, operator_id, work_id, visit_date)
  NULLS NOT DISTINCT;
CREATE UNIQUE INDEX ix_currency ON works USING btree (currency, work_id) NULLS NOT DISTINCT;
CREATE INDEX ix_tblwork_status ON works USING btree (status);
CREATE INDEX ix_tblalignerbatches_alignersetid ON aligner_batches USING btree (aligner_set_id)
  INCLUDE (upper_aligner_count, lower_aligner_count, manufacture_date, aligner_batch_id);
CREATE UNIQUE INDEX ux_tbltimepoints_dolphintpid ON time_points USING btree (dolphin_tp_id)
  WHERE (dolphin_tp_id IS NOT NULL);
