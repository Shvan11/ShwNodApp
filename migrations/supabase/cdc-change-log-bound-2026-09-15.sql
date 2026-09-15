-- Supabase mirror half of migrations/pg/1789380000000_cdc-change-log-bound.sql —
-- applied via scripts/psql.sh supa (storage parameters + comments only; no schema change, no data
-- touched). Safe to re-run.
--
-- Supabase carries its OWN change_log / cdc_sink_control pair — the 'reverse' feed that the reverse
-- engine drains (one of the documented sync-infra asymmetries). It runs the same queue workload as
-- the local half (cdc_capture_remote inserts + coalesces, the engine deletes), so it accumulates
-- index bloat the same way and needs the same fixed-threshold autovacuum. See the local migration's
-- header for the full reasoning and the measured numbers.
--
-- REINDEX is deliberately OMITTED here: the local half runs it inside node-pg-migrate's transaction
-- where the table is known to be tiny, whereas this file is applied by hand against a pooled remote
-- connection. Reclaiming existing bloat on the mirror is an operator task — see
-- docs/sync-cdc.md §Storage hygiene.

BEGIN;

ALTER TABLE public.change_log SET (
  autovacuum_vacuum_scale_factor  = 0.0,
  autovacuum_vacuum_threshold     = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold    = 200,
  autovacuum_vacuum_cost_delay    = 0
);

COMMENT ON COLUMN public.cdc_sink_control.enabled IS
  'CAPTURE gate — the sole flag cdc_capture_remote() reads. Set true by a successful engine start, false ONLY by the circuit breaker (backlog > maxBacklog) or a deliberate operator kill switch. NEVER written from a per-process env flag: the row is shared by every process pointing at this database.';

COMMENT ON COLUMN public.cdc_sink_control.stale IS
  'Capture stopped with changes unrecorded — a FULL RELOAD is required to reconverge. Cleared only by an operator, never by a restart.';

COMMIT;
