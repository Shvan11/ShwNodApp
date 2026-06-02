-- Up Migration
--
-- Retire the 'portal' CDC sink. The curated snake_case portal projection + reverse-sync path were
-- removed in favour of ONE unified database = the raw 1:1 mirror (sink 'failover'), which is now the
-- aligner portal's future serving source. See CLAUDE.md › "Sync (unified CDC)".
--
-- The 6 portal tables previously fanned out to BOTH 'failover' and 'portal' (see
-- 1780179165605_failover-cdc-fanout.sql). Recreate their triggers to feed 'failover' only, then drop
-- the now-dead 'portal' control row + any pending 'portal' backlog so change_log stops accruing a
-- slice nothing drains.
--
-- NOTE: the cdc_capture() function itself is intentionally LEFT UNTOUCHED — its
-- `app.cdc_origin = 'reverse'` skip stays in place so reverse sync (Doctor notes + aligner days) can
-- be reintroduced later loop-free.

DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblpatients";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblwork";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "AlignerDoctors";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerSets";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerBatches";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerNotes";

CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblpatients"       FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('PersonID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblwork"           FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('workid', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "AlignerDoctors"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('DrID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerSets"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerSetID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerBatches" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerBatchID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerNotes"   FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('NoteID', 'failover');

DELETE FROM "change_log" WHERE "sink" = 'portal';
DELETE FROM "cdc_sink_control" WHERE "sink" = 'portal';

-- Down Migration
--
-- Restore the dual ('failover','portal') fanout on the 6 portal tables + the 'portal' control row.

INSERT INTO "cdc_sink_control" ("sink") VALUES ('portal') ON CONFLICT ("sink") DO NOTHING;

DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblpatients";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblwork";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "AlignerDoctors";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerSets";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerBatches";
DROP TRIGGER IF EXISTS "trg_cdc_capture" ON "tblAlignerNotes";

CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblpatients"       FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('PersonID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblwork"           FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('workid', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "AlignerDoctors"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('DrID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerSets"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerSetID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerBatches" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerBatchID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerNotes"   FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('NoteID', 'failover', 'portal');
