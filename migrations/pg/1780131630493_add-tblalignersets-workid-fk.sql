-- Up Migration
--
-- Add the foreign key tblAlignerSets.WorkID -> tblwork.workid that was missing from
-- both the SQL Server source (init_script.sql only ever had FK_tblAlignerSets_AlignerDoctors)
-- and the hand-authored PG baseline. Without it, deleting a tblwork row silently ORPHANED
-- its aligner sets (WorkID left pointing at a deleted work) instead of being blocked or
-- cascaded. ON DELETE CASCADE matches the other primary work-child tables (tblvisits,
-- tblInvoice, tblDiagnosis, tblImplant) and keeps deletePatient's work-cascade working;
-- the app-level guard in work-queries.deleteWork is the friendly first line of defence.
--
-- Added NOT VALID: the constraint is enforced for ALL future INSERT/UPDATE/DELETE (including
-- the ON DELETE CASCADE action), but the initial full-table validation scan is skipped so
-- the migration does not fail on pre-existing orphans. As of authoring, shwan_test has 3
-- such orphaned aligner sets (AlignerSetID 191/205/216, WorkID 10918/11009/11051) — real
-- clinical records whose parent work was deleted by the old unguarded path.
--
-- RESOLVED in shwan_test (2026-05-30): after confirming the 3 had no recoverable patient
-- link (parent work + invoices + PersonID all gone, unreachable in-app), they were deleted
-- (cascading 6 batches) and the constraint promoted with
--   ALTER TABLE "tblAlignerSets" VALIDATE CONSTRAINT "FK_tblAlignerSets_tblwork";
-- This cleanup is intentionally NOT in this migration (it must not auto-delete data on a
-- fresh DB). For the production cutover, the same scan + decision is tracked under Phase 10
-- in docs/postgres-migration-plan.md.

ALTER TABLE "tblAlignerSets"
  ADD CONSTRAINT "FK_tblAlignerSets_tblwork"
  FOREIGN KEY ("WorkID") REFERENCES "tblwork" ("workid")
  ON UPDATE CASCADE ON DELETE CASCADE
  NOT VALID;

-- Down Migration

ALTER TABLE "tblAlignerSets" DROP CONSTRAINT IF EXISTS "FK_tblAlignerSets_tblwork";
