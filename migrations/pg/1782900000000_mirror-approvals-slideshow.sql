-- Promote `approval_requests` + `slideshow_configs` from LOCAL-ONLY to the mirrored
-- (failover) set. SUPERSEDES the "LOCAL-ONLY BY DESIGN" headers of
-- migrations/pg/1782100000000_approval-requests.sql and
-- migrations/pg/1782600000000_slideshow-configs.sql.
--
-- FORWARD-ONLY (local -> Supabase), by construction rather than by denylist: neither
-- table has an `updated_at` column, so neither is picked up by
-- services/sync/cdc/cdc-schema.ts#loadUpdatedAtTables — they stay out of the reverse
-- (two-way) set and their forward upsert is a blind upsert, not an LWW one. Their
-- identity sequences therefore keep the plain default increment; the ODD/EVEN
-- local/Supabase split exists only for the two-way reverse set.
--
-- Both PKs are single-column (`request_id` / `id`), which the failover sink requires —
-- it auto-discovers table -> PK from pg_trigger (cdc-schema.ts#loadPks), so this needs
-- NO app code. No restart either: failover-sink.ts refreshes its PK/generated-column
-- caches once when it first sees a table it doesn't know.
--
-- ORDER OF OPERATIONS (docs/sync-cdc.md — "Add a captured table"):
--   1. Supabase DDL FIRST, so the first forward upsert has a target table:
--        scripts/psql.sh supa -f migrations/supabase/mirror-approvals-slideshow-2026-07-21.sql
--   2. This file, LOCAL only:
--        scripts/psql.sh local -f migrations/pg/1782900000000_mirror-approvals-slideshow.sql
--   3. The one-time row load of the pre-existing rows (they predate the trigger, so CDC
--      never saw them). Small enough to replay through the normal pipeline instead of a
--      bulk push — a no-op self-UPDATE stamps every row into change_log and the running
--      failover sink drains it:
--        UPDATE public.approval_requests SET request_id = request_id;
--        UPDATE public.slideshow_configs SET id = id;
--      (Safe here precisely BECAUSE these tables have no `updated_at`: there is no
--      set_updated_at trigger to re-stamp and no LWW guard to fool, so the reload does
--      not need the `app.cdc_origin='failover'` flag that a reverse-set reload does.)
--
-- No `npm run db:codegen` needed — no local schema change, only triggers.
-- This file is the node-pg-migrate record.

-- Up Migration
CREATE TRIGGER trg_cdc_capture AFTER INSERT OR DELETE OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.cdc_capture('request_id', 'failover');

CREATE TRIGGER trg_cdc_capture AFTER INSERT OR DELETE OR UPDATE ON public.slideshow_configs
  FOR EACH ROW EXECUTE FUNCTION public.cdc_capture('id', 'failover');

-- Down Migration
-- DROP TRIGGER IF EXISTS trg_cdc_capture ON public.approval_requests;
-- DROP TRIGGER IF EXISTS trg_cdc_capture ON public.slideshow_configs;
