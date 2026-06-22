-- Drop four structurally redundant indexes.
--
-- Each is a NON-UNIQUE btree whose key columns are an exact leading prefix of an
-- existing UNIQUE btree, with identical opclass / collation / sort-options / predicate.
-- The planner can therefore satisfy every lookup, join, and FK check from the unique
-- index's prefix, so the narrower index is pure duplicate write + storage overhead:
--
--   ix_tbltpimages_tp (time_point_id)           ⊂ uq_time_point_images_tp_type (time_point_id, image_type)
--   ix_tbltimepoints_person (person_id)         ⊂ ux_time_points_person_tpcode (person_id, tp_code)
--   ix_workitemteeth_workitemid (work_item_id)  ⊂ uq_workitemteeth (work_item_id, tooth_id)
--   ix_privatephotos_patient_tp (person_id, timepoint_code)
--                                               ⊂ uq_privatephotos_natural (person_id, timepoint_code, image_name)
--
-- This is NOT tuning to this clinic's data — the redundancy is structural and holds at
-- any scale / any center. Three of the four are actively used here (ix_tbltimepoints_person
-- ~5,500 scans), so dropping them shifts those plans onto the unique index. Verified before
-- dropping (PG18): (1) leading-column opclass + collation + sort-options + predicate match on
-- all four pairs; (2) with all four dropped inside a rolled-back transaction, EXPLAIN showed
-- the planner cleanly substituting the unique index (Bitmap/Index Scan — no seq-scan
-- regression) for the three with scans. private_photos seq-scans only because it is near-empty
-- (that index had 0 scans); at scale it uses uq_privatephotos_natural's prefix.
--
-- Applied directly via psql (LOCAL + Supabase mirror), NOT via `node-pg-migrate up`
-- (squashed-baseline state — see 1781800100000_appointments-drid-appdate-index). DROP
-- CONCURRENTLY so it never blocks the live tables; therefore each statement runs OUTSIDE
-- a transaction. (CONCURRENTLY is permitted here only because none of the four backs a
-- constraint.)

-- Up Migration
DROP INDEX CONCURRENTLY IF EXISTS ix_tbltpimages_tp;
DROP INDEX CONCURRENTLY IF EXISTS ix_tbltimepoints_person;
DROP INDEX CONCURRENTLY IF EXISTS ix_workitemteeth_workitemid;
DROP INDEX CONCURRENTLY IF EXISTS ix_privatephotos_patient_tp;

-- Down Migration
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tbltpimages_tp
  ON public.time_point_images USING btree (time_point_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tbltimepoints_person
  ON public.time_points USING btree (person_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_workitemteeth_workitemid
  ON public.work_item_teeth USING btree (work_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_privatephotos_patient_tp
  ON public.private_photos USING btree (person_id, timepoint_code);
