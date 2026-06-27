-- Rename the 'Bridge' work type to 'Crown/Bridge'.
--
-- Why: crowns and bridges are the same lab workflow (material + shade + lab + teeth) and
-- the app has no separate Crown work type, so the single prosthetic type is relabelled
-- to cover both. Data-only rename of one controlled-vocabulary row (work_types id 17,
-- WORK_TYPE_IDS.BRIDGE) — the work-type dropdown + works list read the label straight
-- from the DB, so this updates the displayed name everywhere. The frontend panel title
-- (workTypeConfig.ts `name`) is updated in the same change.
--
-- Targeted by NAME (not id) so it is portable across deployments (the commercial product
-- ships to many clinics — see CLAUDE.md "Product direction"); idempotent.
--
-- CDC: work_types carries `cdc_capture('id','failover')` (forward-only) — this UPDATE
-- on local replicates to the Supabase mirror, but the mirror file is applied too for
-- immediate parity.
--
-- Apply (squashed-baseline state — run directly, not via node-pg-migrate). Mirror first,
-- then local:
--   scripts/psql.sh supa  -f migrations/supabase/rename-bridge-to-crown-bridge-2026-06-27.sql
--   scripts/psql.sh local -f migrations/pg/1782400000000_rename-bridge-to-crown-bridge.sql

-- Up Migration
UPDATE public.work_types SET work_type = 'Crown/Bridge' WHERE work_type = 'Bridge';

-- Down Migration
-- UPDATE public.work_types SET work_type = 'Bridge' WHERE work_type = 'Crown/Bridge';
