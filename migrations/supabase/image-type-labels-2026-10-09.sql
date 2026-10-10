-- Supabase mirror of migrations/pg/1791571291910_image-type-labels.sql — a clinic's own name
-- for each of Dolphin's photo slots. Small additive DDL: apply via SUPABASE_FAILOVER_DB_URL
-- BEFORE the local migration, so the forward (failover) upsert of a renamed slot has a column
-- to land `label` in.
--
--   scripts/psql.sh supa -f migrations/supabase/image-type-labels-2026-10-09.sql
--
-- Mirror parity (docs/sync-cdc.md): the same column, type and comment as local.

ALTER TABLE public.image_types
  ADD COLUMN IF NOT EXISTS label public.citext;

COMMENT ON COLUMN public.image_types.label IS
  'The clinic''s name for this slot (Settings → Lookups → Photo Slot Names); NULL = the app''s '
  'built-in name. description stays Dolphin''s own name.';
