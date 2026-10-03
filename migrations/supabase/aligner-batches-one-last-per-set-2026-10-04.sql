-- Supabase MIRROR half of migrations/pg/1789460700000_aligner-batches-one-last-per-set.sql (2026-10-04).
-- Apply with: scripts/psql.sh supa -f migrations/supabase/aligner-batches-one-last-per-set-2026-10-04.sql
--
-- At most ONE "last" batch per aligner set — the twin of `ix_tblalignerbatches_oneactiveperset`.
-- Full rationale in the local half. Apply AFTER the local half, once the build carrying the
-- createBatch change is live: with only the mirror guarded, a local set holding two "last" batches
-- would leave the second one retrying against this index forever.
--
-- It REPLACES the plain partial index on the same rows (`(aligner_set_id) WHERE is_last` answers
-- every lookup the old `(aligner_set_id, is_last) WHERE is_last` did).

BEGIN;

DROP INDEX IF EXISTS public.ix_tblalignerbatches_islast;

CREATE UNIQUE INDEX ix_tblalignerbatches_onelastperset
  ON public.aligner_batches USING btree (aligner_set_id)
  WHERE is_last;

COMMIT;
