-- Up Migration
--
-- CDC triggers. Attach the generic cdc_capture() trigger (from 1780178394399) to every captured
-- table. TG_ARGV = (pk_column, sink, sink, ...). The 6 PORTAL tables feed both 'failover' and
-- 'portal'; the rest feed 'failover' only. The portal sink re-applies the business filters
-- (only-aligner patients/work, Lab-only notes) at drain time — see services/sync/cdc/portal-sink.ts.
--
-- Not captured (no trigger): sessions (staff_sessions, portal_sessions), sync/migration infra
-- (change_log, cdc_sink_control, pgmigrations, SyncQueue), and composite-PK tblPrivatePhotos.

-- Portal + failover (6).
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblpatients"       FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('PersonID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblwork"           FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('workid', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "AlignerDoctors"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('DrID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerSets"    FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerSetID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerBatches" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlignerBatchID', 'failover', 'portal');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerNotes"   FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('NoteID', 'failover', 'portal');

-- Failover only (59).
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblappointments" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('appointmentID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblvisits" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblInvoice" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('invoiceID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "DocumentTemplates" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('template_id', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "DocumentTypes" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('type_id', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "Patients" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('patID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tbCities" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAddress" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlertTypes" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlertTypeID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlerts" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AlertID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblAlignerActivityFlags" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ActivityID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblCalender" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('AppDate', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblCarriedWires" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Id', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblDetail" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblDiagnosis" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblElastics" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Elastic_ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblEmployees" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblEndo" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblEstimatedCostPresets" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('PresetID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblExpenseCategories" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('CategoryID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblExpenseSubcategories" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('SubcategoryID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblExpenses" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblGender" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Gender_ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblImageTypes" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ImageTypeCode', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblImplant" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblImplantManufacturer" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblKeyWord" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblMessageStatusHistory" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('StatusHistoryID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblOldOPG" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblPatientPortalAuth" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('PersonID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblPatientType" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblPositions" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblReferrals" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblStandCategories" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('CategoryID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblStandItems" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ItemID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblStandSaleItems" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('SaleItemID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblStandSales" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('SaleID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblStandStockMovements" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('MovementID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTagOptions" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePointImages" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointImageID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblTimePoints" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimePointID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblToothNumber" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblUsers" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('UserID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblVidCat" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('VidCatID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWaitReason" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWaiting" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWires" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Wire_ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWorkItemTeeth" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWorkItems" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWorkStatus" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('StatusID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblWorkType" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblbends" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Bend_ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblholidays" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Holidaydate', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblnumbers" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('Mynumber', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tbloptions" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('OptionName', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblscrews" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblsms" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('id', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tbltimes" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('TimeID', 'failover');
CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON "tblvideos" FOR EACH ROW EXECUTE FUNCTION "cdc_capture"('ID', 'failover');

-- Down Migration
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_trigger tg
      JOIN pg_class c     ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE tg.tgname = 'trg_cdc_capture'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS "trg_cdc_capture" ON %I;', r.relname);
  END LOOP;
END $$;
