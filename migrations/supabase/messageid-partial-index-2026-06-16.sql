-- SUPABASE MIRROR half of migrations/pg/1781800200000_messageid-partial-index.sql
-- (DDL parity — CDC replicates row data only, so index DDL must be applied on both sides).
--
-- Apply (user-run, NO -1 — CONCURRENTLY cannot run inside a transaction; -f runs
-- each statement in its own autocommit, which is what we want):
--   ./scripts/psql.sh supa -f migrations/supabase/messageid-partial-index-2026-06-16.sql
--
-- Slim ix_tblappointments_messageid to a PARTIAL index. wa_message_id is NULL for
-- most rows; the inbound WhatsApp status webhook only looks up specific non-null
-- ids, so the partial serves 100% of lookups at a fraction of the size/write cost.
-- Zero-downtime swap: build partial CONCURRENTLY -> drop full -> rename.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tblappointments_messageid_partial
  ON appointments USING btree (wa_message_id) WHERE wa_message_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS ix_tblappointments_messageid;
ALTER INDEX ix_tblappointments_messageid_partial RENAME TO ix_tblappointments_messageid;
