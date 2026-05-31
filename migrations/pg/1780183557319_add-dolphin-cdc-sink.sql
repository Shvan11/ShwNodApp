-- Up Migration
--
-- Dolphin sync (TEMPORARY) — a THIRD CDC sink on the unified change feed. Replicates the app's
-- native timepoint/image rows (tblTimePoints / tblTimePointImages, written by the photo editor)
-- into the legacy Dolphin Imaging SQL Server DB (DolphinPlatform.dbo.TimePoints / TimePointImages /
-- Patients) so Dolphin "sees" app-cropped photos until the native pipeline is trusted. DB rows
-- ONLY — the physical JPEGs already land in the shared working/ dir under Dolphin's exact naming.
-- See CLAUDE.md › "Dolphin sync (temporary)" and services/sync/cdc/dolphin-sink.ts.
--
-- Like failover/portal, INERT until DOLPHIN_SYNC_ENABLED flips capture on at boot.

-- 1. Register the sink (capture off until the engine enables it at start).
INSERT INTO "cdc_sink_control" ("sink") VALUES ('dolphin');

-- 2. Re-arm the two timepoint triggers to ALSO fan out to 'dolphin'. A trigger's TG_ARGV is fixed
--    at creation, so the only way to add a sink is to drop + re-create with the extra arg. The 2
--    captured timepoint tables previously fed 'failover' only (see *_failover-cdc-fanout.sql).
DROP TRIGGER "trg_cdc_capture" ON "tblTimePoints";
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePoints"
  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointID', 'failover', 'dolphin');

DROP TRIGGER "trg_cdc_capture" ON "tblTimePointImages";
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePointImages"
  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointImageID', 'failover', 'dolphin');

-- 3. Sink-owned mapping: local (table, pk) → the Dolphin GUID it created/adopted. Deliberately
--    UN-triggered (no cdc_capture) for two reasons:
--      (a) no capture feedback loop — so unlike portal, the dolphin sink needs no cdc_origin guard;
--      (b) the GUID survives the source row's deletion — change_log carries only (sink, tbl, pk)
--          with no payload, so on a delete the Dolphin GUID would otherwise be unrecoverable.
--    We intentionally do NOT write the reserved tblTimePoints.DolphinTpID / DolphinPatID /
--    tblTimePointImages.DolphinTpiID columns, because those tables ARE captured and writing them
--    would re-trigger the sink.
CREATE TABLE "dolphin_sync_map" (
  "local_table" text      NOT NULL,
  "local_pk"    text      NOT NULL,
  "dolphin_id"  uuid      NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("local_table", "local_pk")
);

-- Down Migration

DROP TABLE IF EXISTS "dolphin_sync_map";

-- Restore the failover-only triggers.
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblTimePointImages";
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePointImages"
  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointImageID', 'failover');

DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblTimePoints";
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePoints"
  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointID', 'failover');

-- Drop any pending dolphin changes, then the sink row.
DELETE FROM "change_log" WHERE "sink" = 'dolphin';
DELETE FROM "cdc_sink_control" WHERE "sink" = 'dolphin';
