-- Up Migration
--
-- Index invoices.aligner_set_id. The aligner-sets list query
-- (aligner-queries.getAlignerSetsByWorkId) correlates invoices by aligner_set_id
-- once per set to derive TotalPaid / Balance / PaymentStatus, and a second join
-- site (getAlignerSetPayments) does the same. invoices has ~30k rows but no index
-- on this column — every such lookup is a full seq-scan. The column is also a FK
-- target candidate (aligner_sets.aligner_set_id), so equality lookups are the only
-- access pattern. INCLUDE amount_paid so the sum(amount_paid) aggregations are
-- index-only (no heap fetch).
--
-- Plain (non-CONCURRENTLY) CREATE INDEX: node-pg-migrate wraps each SQL migration
-- in a transaction, and the brief ACCESS EXCLUSIVE lock on a 30k-row table is
-- negligible for a single-clinic deployment.

CREATE INDEX IF NOT EXISTS "ix_invoices_alignersetid"
  ON "invoices" ("aligner_set_id")
  INCLUDE ("amount_paid");

-- Down Migration

DROP INDEX IF EXISTS "ix_invoices_alignersetid";
