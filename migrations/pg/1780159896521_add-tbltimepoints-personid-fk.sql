-- Up Migration
--
-- Add the foreign key tblTimePoints.PersonID -> tblpatients.PersonID that was missing
-- from the Dolphin clone (clone_dolphin_timepoints.sql created tblTimePoints with a bare
-- `PersonID int NOT NULL` + a unique (PersonID, tpCode) index, but no FK) and was carried
-- forward into the PG baseline. Without it a timepoint could point at a non-existent
-- patient, and deletePatient (services/database/queries/patient-queries.ts) — which deletes
-- tblwork/tblCarriedWires/tblWaiting/tblappointments/tblscrews then tblpatients, but NOT
-- tblTimePoints — silently ORPHANED a patient's photo sessions (and, via the existing
-- FK_tblTPImages_TP cascade, their image rows would have been unreachable).
--
-- ON DELETE CASCADE (matching tblappointments/tblscrews and the tblTimePointImages ->
-- tblTimePoints cascade) makes a patient delete remove their timepoints + images in one
-- chain, so deletePatient keeps working without touching tblTimePoints. PersonID is an
-- identity PK on tblpatients so ON UPDATE CASCADE is moot but kept for symmetry with the
-- other patient-child FKs. tblTimePoints.PersonID is already indexed
-- (IX_tblTimePoints_Person), so the FK needs no new index.
--
-- shwan_test has 0 orphan timepoints at authoring (3461 rows, all with a real patient), so
-- the constraint is added VALID (no NOT VALID + later VALIDATE dance needed). For the
-- production cutover, re-run the orphan scan first (Phase 10, docs/postgres-migration-plan.md).

ALTER TABLE "tblTimePoints"
  ADD CONSTRAINT "FK_tblTimePoints_tblpatients"
  FOREIGN KEY ("PersonID") REFERENCES "tblpatients" ("PersonID")
  ON UPDATE CASCADE ON DELETE CASCADE;

-- Down Migration

ALTER TABLE "tblTimePoints" DROP CONSTRAINT IF EXISTS "FK_tblTimePoints_tblpatients";
