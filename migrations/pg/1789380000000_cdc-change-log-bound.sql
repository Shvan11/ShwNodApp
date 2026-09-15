-- Up Migration
--
-- Keep `change_log` physically small, and pin down what `cdc_sink_control.enabled` means.
--
-- WHY (audit finding F1, the storage half): `change_log` is a QUEUE table — the trigger inserts,
-- the drain deletes, and the coalescing `ON CONFLICT (sink,tbl,pk) DO UPDATE` rewrites rows in
-- place. Its physical size therefore tracks CHURN, not row count, and the live table proves it:
--
--     7 live rows  →  760 kB total  =  8 kB heap + 712 kB of index
--
-- The heap is fine (autovacuum had run 42 times). The indexes are ~100x their content, because a
-- btree never returns emptied pages to the OS on its own. Two causes, both addressed here:
--
--  1. Autovacuum's trigger is PROPORTIONAL by default (`scale_factor 0.2`), so the dead-tuple
--     budget grows with the live row count exactly when the table is under pressure: at a 100k
--     backlog PostgreSQL would tolerate ~20,000 dead tuples before vacuuming. For a queue table
--     that is backwards — we want a small FIXED trigger, so vacuum runs often and keeps the free
--     space map fresh enough for btree pages to be recycled instead of accumulated.
--  2. The existing bloat is already committed to disk and only a rebuild reclaims it, hence the
--     one-time REINDEX below.
--
-- Note the coalescing UPDATE cannot be HOT (it writes `changed_at`, which idx_change_log_drain
-- indexes), so every coalesced change churns all three indexes. That is inherent to the current
-- drain ordering (`ORDER BY changed_at, id`) and is left alone; aggressive vacuum is the answer,
-- not an index change.
--
-- `cost_delay = 0` lets the autovacuum worker run this one table at full speed. It is a few pages
-- in the normal case, so there is no I/O storm to throttle.

ALTER TABLE public.change_log SET (
  autovacuum_vacuum_scale_factor  = 0.0,
  autovacuum_vacuum_threshold     = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold    = 200,
  autovacuum_vacuum_cost_delay    = 0
);

-- One-time reclaim of the index bloat that is already on disk. Plain REINDEX (not CONCURRENTLY):
-- it takes ACCESS EXCLUSIVE, but this table holds single-digit rows in the normal case so the lock
-- is measured in milliseconds, and CONCURRENTLY cannot run inside node-pg-migrate's transaction.
-- Periodic re-runs are an operator task — see docs/sync-cdc.md §Storage hygiene.
REINDEX TABLE public.change_log;

-- Pin down the flag's meaning. `enabled` is the CAPTURE gate — the only thing `cdc_capture()`
-- reads — and it is deliberately NOT the same question as "is a drainer running here". Conflating
-- the two is what caused the 2026-09-08 capture blackout: a second process booting without
-- FAILOVER_SYNC_ENABLED wrote this shared row and switched capture off for the live service, and
-- rows written during that window are absent from `change_log` entirely and unrecoverable. The env
-- flag now gates only whether THIS process runs a drainer; it never writes this column.
COMMENT ON COLUMN public.cdc_sink_control.enabled IS
  'CAPTURE gate — the sole flag cdc_capture() reads. Set true by a successful engine start, false ONLY by the circuit breaker (backlog > maxBacklog) or a deliberate operator kill switch. NEVER written from a per-process env flag: the row is shared by every process pointing at this database.';

COMMENT ON COLUMN public.cdc_sink_control.stale IS
  'Capture stopped with changes unrecorded — a FULL RELOAD is required to reconverge. Cleared only by an operator, never by a restart.';

-- Down Migration

ALTER TABLE public.change_log RESET (
  autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold,
  autovacuum_analyze_scale_factor,
  autovacuum_analyze_threshold,
  autovacuum_vacuum_cost_delay
);

COMMENT ON COLUMN public.cdc_sink_control.enabled IS NULL;
COMMENT ON COLUMN public.cdc_sink_control.stale IS NULL;
