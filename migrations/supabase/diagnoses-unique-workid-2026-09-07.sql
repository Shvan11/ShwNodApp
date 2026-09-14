-- Supabase mirror of migrations/pg/1788812600000_diagnoses-unique-workid.sql — applied via
-- SUPABASE_FAILOVER_DB_URL, AFTER the local migration. A UNIQUE is restrictive rather than
-- additive, so it follows the drop ordering in docs/db-migrations.md: constrain the source
-- first, the mirror second, so the mirror never rejects a row the source is still permitted to
-- produce. (Both sides held 665 rows / 665 distinct work_id when this was written, so either
-- order was in fact safe.)
--
-- Mirror parity rules (docs/sync-cdc.md): identical constraints + indexes to local. `diagnoses`
-- is reverse-captured here (trg_cdc_capture_remote), so this constraint is also what stops a
-- Supabase-side duplicate from replicating into the local DB as a second diagnosis for a work.
--
-- The dedupe below is normally a no-op: the local half's DELETEs are captured by trg_cdc_capture
-- and drained here by the failover sink first. It stays because this file must also be correct
-- when applied to a mirror that has drifted (e.g. rebuilt from an older reload).

-- 1. Dedupe — same rule as the local half (LWW by updated_at, tie to the later insert).
--    `app.cdc_origin = 'failover'` makes cdc_capture_remote / set_updated_at_remote no-ops, so
--    mirror-side maintenance does not echo back into the local DB through reverse sync.
SET app.cdc_origin = 'failover';

DO $dedupe$
DECLARE
  r      record;
  n_gone int := 0;
BEGIN
  FOR r IN
    SELECT d.*
      FROM (
        SELECT id,
               row_number() OVER (
                 PARTITION BY work_id
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
          FROM public.diagnoses
      ) ranked
      JOIN public.diagnoses d ON d.id = ranked.id
     WHERE ranked.rn > 1
  LOOP
    RAISE NOTICE 'diagnoses dedupe (mirror): deleting duplicate row %', to_jsonb(r);
    DELETE FROM public.diagnoses WHERE id = r.id;
    n_gone := n_gone + 1;
  END LOOP;

  RAISE NOTICE 'diagnoses dedupe (mirror): % duplicate row(s) removed', n_gone;
END;
$dedupe$;

RESET app.cdc_origin;

-- 2. The constraint (name matches local, so the two catalogs stay diffable).
ALTER TABLE public.diagnoses
  ADD CONSTRAINT diagnoses_work_id_key UNIQUE (work_id);

COMMENT ON CONSTRAINT diagnoses_work_id_key ON public.diagnoses IS
  'One diagnosis per work. Backs the ON CONFLICT (work_id) upsert in POST /api/diagnosis.';

-- 3. The two indexes it makes redundant — UNIQUE (id, work_id) where id is already the PK
--    (audit F11.3), and a plain btree on (work_id) that the new unique index subsumes.
DROP INDEX IF EXISTS public."diagnoses$compindex";
DROP INDEX IF EXISTS public."tblDiagnosis$tblworktblDiagnosis";
