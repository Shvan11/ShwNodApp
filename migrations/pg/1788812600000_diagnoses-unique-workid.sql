-- Up Migration
--
-- Give `diagnoses` the `UNIQUE (work_id)` it has always semantically had, and drop the two
-- indexes that become redundant once it exists.
--
-- WHY (the durable half of audit finding F7.3): a work has at most one diagnosis. Every
-- consumer already assumes it — `GET /api/diagnosis/:workId` returns `rows[0]`, `DELETE
-- /api/diagnosis/:workId` deletes by `work_id`, and `POST /api/diagnosis` is an upsert. But
-- the table carried no constraint saying so (only `PRIMARY KEY (id)` and the redundant
-- `UNIQUE (id, work_id)`), so the upsert had to be written as UPDATE-then-INSERT-if-zero-rows,
-- which two concurrent saves for a not-yet-diagnosed work both fell through into: both saw 0
-- rows updated, both INSERTed. The result was a work with two diagnoses, of which the GET
-- returned an arbitrary one.
--
-- A per-work `pg_advisory_xact_lock` was added first as a code-only stopgap. This is the real
-- fix: with `UNIQUE (work_id)` the route becomes one atomic `INSERT … ON CONFLICT (work_id) DO
-- UPDATE`, the lock and the transaction wrapper go away, and the invariant holds against every
-- writer — including the CDC failover/reverse sinks and any future one — instead of only
-- against the one code path that remembered to take the lock.
--
-- ORDERING (docs/db-migrations.md): a UNIQUE is restrictive, not additive, so it follows the
-- drop ordering — LOCAL first, the Supabase mirror second
-- (migrations/supabase/diagnoses-unique-workid-2026-09-07.sql), so the mirror never rejects a
-- row the source is still permitted to produce.
--
-- Local state when written: 665 rows / 665 distinct `work_id` — no duplicates on either DB, so
-- the dedupe below is a no-op here. It exists for other deployments, where it is the only thing
-- standing between an existing duplicate and a failed migration.

-- 1. Dedupe. Whole-row last-write-wins by `updated_at` (the same rule the CDC sinks use),
--    tie-broken toward the later INSERT. Losing rows are almost always byte-identical copies:
--    every later UPDATE hit *all* rows for the work, so the pair only diverges if nothing was
--    saved after the duplicating race. Nothing references `diagnoses.id` (zero inbound FKs), so
--    dropping a row breaks no link. Each removed row is RAISEd in full before it goes, so the
--    migration output / server log holds the content if a clinic ever needs it back.
DO $dedupe$
DECLARE
  r        record;
  n_gone   int := 0;
BEGIN
  FOR r IN
    SELECT d.*
      FROM (
        SELECT id,
               row_number() OVER (
                 PARTITION BY work_id
                 ORDER BY updated_at DESC NULLS LAST, id DESC
               ) AS rn
          FROM diagnoses
      ) ranked
      JOIN diagnoses d ON d.id = ranked.id
     WHERE ranked.rn > 1
  LOOP
    RAISE NOTICE 'diagnoses dedupe: deleting duplicate row %', to_jsonb(r);
    DELETE FROM diagnoses WHERE id = r.id;
    n_gone := n_gone + 1;
  END LOOP;

  RAISE NOTICE 'diagnoses dedupe: % duplicate row(s) removed', n_gone;
END;
$dedupe$;

-- 2. The constraint itself. Deletes above are captured by trg_cdc_capture as normal, so the
--    mirror converges on them before its own half runs.
ALTER TABLE diagnoses
  ADD CONSTRAINT diagnoses_work_id_key UNIQUE (work_id);

COMMENT ON CONSTRAINT diagnoses_work_id_key ON diagnoses IS
  'One diagnosis per work. Backs the ON CONFLICT (work_id) upsert in POST /api/diagnosis.';

-- 3. The two indexes the new constraint makes redundant.
--
--    `diagnoses$compindex` — UNIQUE (id, work_id) where `id` is already the PK, so it can never
--    constrain anything the primary key does not (audit finding F11.3). A SQL-Server-era
--    artefact; it was never the constraint F7.3 needed.
--
--    `tblDiagnosis$tblworktblDiagnosis` — a plain btree on (work_id), exactly the leading column
--    set of the new unique index, which serves every lookup and the FK's ON DELETE CASCADE just
--    as well.
DROP INDEX IF EXISTS "diagnoses$compindex";
DROP INDEX IF EXISTS "tblDiagnosis$tblworktblDiagnosis";

-- Down Migration
--
-- Restores the pre-migration index set. The dedupe is NOT reversible — the duplicate rows are
-- gone (their content is in this migration's NOTICE output). Reverting the constraint without
-- also reverting routes/api/work.routes.ts leaves `POST /api/diagnosis`'s `ON CONFLICT
-- (work_id)` with nothing to infer, which fails loudly (SQLSTATE 42P10) rather than silently.

CREATE UNIQUE INDEX IF NOT EXISTS "diagnoses$compindex" ON diagnoses USING btree (id, work_id);
CREATE INDEX IF NOT EXISTS "tblDiagnosis$tblworktblDiagnosis" ON diagnoses USING btree (work_id);

ALTER TABLE diagnoses
  DROP CONSTRAINT IF EXISTS diagnoses_work_id_key;
