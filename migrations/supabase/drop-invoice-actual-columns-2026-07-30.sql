-- Supabase mirror of migrations/pg/1783000000000_drop-invoice-actual-columns.sql —
-- applied via SUPABASE_FAILOVER_DB_URL, AFTER the local drop.
--
-- Ordering is the reverse of the usual additive case: an ADD goes on the mirror FIRST
-- so the forward upsert has somewhere to land, but a DROP goes on the mirror LAST. The
-- failover sink builds its column list from the local row, so once the columns are gone
-- locally nothing writes them here — dropping them on this side any earlier would be
-- harmless but pointless, and dropping them here FIRST while local still had them would
-- make the sink upsert a column the mirror no longer has.
--
-- Mirror parity rules (docs/sync-cdc.md): the mirror stays identical to local except
-- the documented sync-infra asymmetries, so these two retired columns must go here too.
-- Row DATA replicates; DDL never does.
--
-- The aligner portal (aligner-portal-external) reads this mirror under RLS and does not
-- reference either column.
--
-- No backup is taken on this side: the mirror's values are a replica of the local rows
-- already dumped to C:\DBBackup\invoices-actual-columns-2026-07-30.restore.sql.

ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS actual_amount,
  DROP COLUMN IF EXISTS actual_cur;
