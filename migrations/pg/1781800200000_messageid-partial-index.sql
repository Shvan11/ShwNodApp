-- Slim ix_tblappointments_messageid to a PARTIAL index (WHERE wa_message_id IS NOT NULL).
--
-- Applied directly via psql on 2026-06-16 (LOCAL + Supabase mirror), CONCURRENTLY
-- (no transaction — see the alerts/dr-id index migrations for the squash-baseline
-- reason). `wa_message_id` is NULL for most appointments (only ones with a sent
-- WhatsApp message carry one); the inbound delivery/read-status webhook only ever
-- looks up a specific NON-NULL id, and `wa_message_id = $1` implies the partial
-- predicate, so the partial index serves 100% of real lookups at a fraction of the
-- size and per-write cost.
--
-- Zero-downtime swap: build the partial CONCURRENTLY, drop the full one, then
-- rename back to the original name — a usable index exists at every instant and no
-- write lock is taken. (App code never references the index by name.)

-- Up Migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tblappointments_messageid_partial
  ON appointments USING btree (wa_message_id) WHERE wa_message_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS ix_tblappointments_messageid;
ALTER INDEX ix_tblappointments_messageid_partial RENAME TO ix_tblappointments_messageid;

-- Down Migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tblappointments_messageid_full
  ON appointments USING btree (wa_message_id);
DROP INDEX CONCURRENTLY IF EXISTS ix_tblappointments_messageid;
ALTER INDEX ix_tblappointments_messageid_full RENAME TO ix_tblappointments_messageid;
