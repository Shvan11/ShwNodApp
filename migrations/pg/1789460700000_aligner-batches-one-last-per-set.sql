-- Up Migration
--
-- At most ONE "last" batch per aligner set — the twin of `ix_tblalignerbatches_oneactiveperset`.
--
-- WHY. `aligner_batches.is_last` drives the "final" flag and the "Final" next-batch status on the
-- all-sets list. Until 2026-10-04 only an EDIT that set the flag cleared it on the set's other
-- batches; creating a batch did not, so a set could carry two "last" batches (sets 232 and 315), and
-- a batch marked last stayed last after a later batch was added (219, 307) — which showed a patient
-- with 6 aligners still to make as "Final", hiding that batch 2 needed manufacturing. createBatch now
-- clears the flag too; this index holds the rule for every other writer (the reverse sync, a script,
-- a manual UPDATE). The four stale flags were cleared by hand before this ran.
--
-- It REPLACES the plain partial index on the same rows: `(aligner_set_id) WHERE is_last` answers
-- every lookup `(aligner_set_id, is_last) WHERE is_last` did — `is_last` is constant inside it.
--
-- Sync. Both sinks apply rows one at a time and retry a failed row on the next cycle, so a "set
-- last" that reaches the mirror ahead of the matching "clear" is deferred one cycle, the same way a
-- child row waits for its FK parent. The one-active index already lives under the same sinks.
-- The one shape that can stick: a doctor changes `days` on a batch in the portal while the
-- clinic's change to that set's last flag has not reached the mirror yet (seconds normally, longer
-- in an internet outage) — whole-row LWW then carries the mirror's stale `is_last` home, and the
-- two rows retry against each other ("deferred" warnings) until either batch is re-saved at the
-- clinic. Without this index the same shape silently brings the stale "last" back instead.
--
-- Deploy AFTER the build carrying the createBatch change is live: the older build creates a batch
-- marked last without clearing the earlier one, which this index refuses (23505 → "Failed to save").
--
-- Mirror half: migrations/supabase/aligner-batches-one-last-per-set-2026-10-04.sql (DDL never replicates).

DROP INDEX IF EXISTS public.ix_tblalignerbatches_islast;

CREATE UNIQUE INDEX ix_tblalignerbatches_onelastperset
  ON public.aligner_batches USING btree (aligner_set_id)
  WHERE is_last;

-- Down Migration
DROP INDEX IF EXISTS public.ix_tblalignerbatches_onelastperset;

CREATE INDEX ix_tblalignerbatches_islast
  ON public.aligner_batches USING btree (aligner_set_id, is_last)
  WHERE is_last;
