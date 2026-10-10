-- Up Migration
--
-- A clinic's own name for each of Dolphin's photo slots.
--
-- WHY. Dolphin files every photo under a 2-digit slot code (`{personId}{tp:02}.I{code}`). Only
-- the 8 grid views and the X-ray slots say what is in them; a clinic put whatever it liked in the
-- others. This clinic keeps smile close-ups in `02`, which Dolphin calls "Ceph Front", so the app
-- names those slots just "Image" (shared/photo-views.ts). Now the clinic names them itself, in
-- Settings → Lookups → Photo Slot Names, and another clinic's `02` keeps its own meaning.
--
-- `description` stays Dolphin's own name: the record of what Dolphin meant by each code, which
-- the table is kept for once Dolphin is retired. `label` is the clinic's, NULL until it sets one,
-- when the app shows its built-in name. The 8 grid views are not renamed here (the server refuses
-- them): the grid and the photo editor depend on what they mean.
--
-- CDC. `image_types` is captured forward-only (`cdc_capture('image_type_code', 'failover')`, no
-- `updated_at`), so a rename replicates like any lookup edit. Mirror half:
-- migrations/supabase/image-type-labels-2026-10-09.sql — apply it FIRST, so the forward upsert
-- has a column to land `label` in.

ALTER TABLE public.image_types
  ADD COLUMN IF NOT EXISTS label public.citext;

COMMENT ON COLUMN public.image_types.label IS
  'The clinic''s name for this slot (Settings → Lookups → Photo Slot Names); NULL = the app''s '
  'built-in name. description stays Dolphin''s own name.';

-- Down Migration

ALTER TABLE public.image_types
  DROP COLUMN IF EXISTS label;
