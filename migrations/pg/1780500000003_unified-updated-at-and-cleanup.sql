-- Up Migration
--
-- Two changes, applied to the live DB during an offline maintenance window
-- (plan: scan-the-database... / "Unified per-row version + database cleanup").
--
--   A. Per-row version — give every mutable business table a uniform `updated_at`,
--      maintained by a DB trigger (sync infra, like cdc_capture; lives LOCAL ONLY —
--      the Supabase mirror has no triggers and receives the trigger-computed value
--      via the failover CDC sink, which copies all columns verbatim).
--   B. Cleanup — drop two dead tables and dissolve the trivial `genders` lookup.
--
-- Parity: the column/table DDL here (renames, ADD COLUMN, DROP TABLE, DROP FK) is
-- applied IDENTICALLY to the Supabase mirror in the same window. The trigger function
-- and triggers are NOT mirrored (mirror carries no triggers).

-- ── A1. Generic wall-clock `updated_at` trigger function ─────────────────────────────
-- timestamp columns are wall-clock (CLAUDE.md), so localtimestamp, not now().
-- BEFORE INSERT OR UPDATE → the column is populated on INSERT and bumped on every UPDATE,
-- and (being BEFORE) the new value is visible to the AFTER cdc_capture trigger, so it
-- replicates. No column DEFAULT is used anywhere: that keeps the mirror byte-identical
-- (existing rows stay NULL on both sides; new/changed rows replicate their value).
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := localtimestamp;
  RETURN NEW;
END;
$$;

-- ── A2. Unify existing update-tracking columns → `updated_at` (data preserved) ────────
ALTER TABLE document_templates RENAME COLUMN modified_date TO updated_at;
ALTER TABLE stand_items        RENAME COLUMN modified_date TO updated_at;
ALTER TABLE appointments       RENAME COLUMN last_updated  TO updated_at;
ALTER TABLE aligner_notes      RENAME COLUMN edited_at     TO updated_at;
-- patient_portal_auth.updated_at already exists (keeps its current default; the trigger
-- overrides it on write) — only the trigger is attached below.

-- ── A3. Add `updated_at` (nullable, NO default) to mutable business entities ──────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','works','aligner_sets','aligner_batches','aligner_activity_flags',
    'diagnoses','visits','work_items','implants','endo','screws','expenses',
    'employees','time_points','time_point_images','carried_wires','alerts',
    'stand_sales','options','addresses'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN updated_at timestamp;', t);
  END LOOP;
END $$;

-- ── Attach the trigger to every tracked table (4 renamed + 20 added + patient_portal_auth) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_templates','stand_items','appointments','aligner_notes','patient_portal_auth',
    'patients','works','aligner_sets','aligner_batches','aligner_activity_flags',
    'diagnoses','visits','work_items','implants','endo','screws','expenses',
    'employees','time_points','time_point_images','carried_wires','alerts',
    'stand_sales','options','addresses'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE INSERT OR UPDATE ON %I '
      || 'FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- ── B1. Drop dead tables (retired SyncQueue + post-migration leftover) ────────────────
-- No incoming FKs, no app code references; DROP TABLE cascades each table's CDC trigger.
-- dolphin_sync_map holds no rows referencing patients_dolphin. Backed up (schema+data) to
-- C:\pg18-migration\pre-updated-at-cleanup-20260607.sql before this migration.
DROP TABLE sync_queue;
DROP TABLE patients_dolphin;

-- ── B2. Dissolve the `genders` lookup (immutable Male/Female domain) ──────────────────
-- The equivalent CHECK already exists and stays:
--   ssma_cc$patients$gender$validation_rule = (gender IS NULL OR gender = 1 OR gender = 2)
-- so no new CHECK is added — patients.gender remains the int code, just without the FK/table.
ALTER TABLE patients DROP CONSTRAINT "patients$tblgendertblpatients";
DROP TABLE genders;


-- Down Migration
--
-- Reverses the schema changes. NOTE: row data for the three dropped tables is NOT restored
-- here (genders is recreated with its known 2 rows; sync_queue/patients_dolphin are recreated
-- empty — their data was dead/leftover and is preserved in the pre-migration backup).

-- Detach triggers + drop the function.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_templates','stand_items','appointments','aligner_notes','patient_portal_auth',
    'patients','works','aligner_sets','aligner_batches','aligner_activity_flags',
    'diagnoses','visits','work_items','implants','endo','screws','expenses',
    'employees','time_points','time_point_images','carried_wires','alerts',
    'stand_sales','options','addresses'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS set_updated_at();

-- Revert the renames.
ALTER TABLE document_templates RENAME COLUMN updated_at TO modified_date;
ALTER TABLE stand_items        RENAME COLUMN updated_at TO modified_date;
ALTER TABLE appointments       RENAME COLUMN updated_at TO last_updated;
ALTER TABLE aligner_notes      RENAME COLUMN updated_at TO edited_at;

-- Drop the added columns.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','works','aligner_sets','aligner_batches','aligner_activity_flags',
    'diagnoses','visits','work_items','implants','endo','screws','expenses',
    'employees','time_points','time_point_images','carried_wires','alerts',
    'stand_sales','options','addresses'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS updated_at;', t);
  END LOOP;
END $$;

-- Recreate genders (+ index, known data, FK, CDC trigger).
CREATE TABLE genders (
  gender_id integer NOT NULL,
  gender    citext  NOT NULL,
  CONSTRAINT "genders$primarykey1" PRIMARY KEY (gender_id)
);
CREATE INDEX "genders$tblgendergender" ON genders USING btree (gender);
INSERT INTO genders (gender_id, gender) VALUES (1, 'Male'), (2, 'Female');
ALTER TABLE patients ADD CONSTRAINT "patients$tblgendertblpatients"
  FOREIGN KEY (gender) REFERENCES genders (gender_id);
CREATE TRIGGER trg_cdc_capture AFTER INSERT OR UPDATE OR DELETE ON genders
  FOR EACH ROW EXECUTE FUNCTION cdc_capture('gender_id', 'failover');

-- Recreate sync_queue (structure + CDC trigger; data in backup).
CREATE TABLE sync_queue (
  queue_id     integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  table_name   citext NOT NULL,
  record_id    integer NOT NULL,
  operation    citext NOT NULL,
  json_data    citext,
  created_at   timestamp DEFAULT localtimestamp,
  attempts     integer DEFAULT 0,
  last_attempt timestamp,
  last_error   citext,
  status       citext DEFAULT 'Pending'::citext,
  CONSTRAINT sync_queue_operation_check CHECK (operation = ANY (ARRAY['DELETE'::citext, 'UPDATE'::citext, 'INSERT'::citext])),
  CONSTRAINT sync_queue_status_check    CHECK (status    = ANY (ARRAY['Failed'::citext, 'Synced'::citext, 'Pending'::citext]))
);
CREATE INDEX idx_sync_status ON sync_queue USING btree (status, created_at);
CREATE INDEX idx_sync_table  ON sync_queue USING btree (table_name, record_id);
CREATE TRIGGER trg_cdc_capture AFTER INSERT OR UPDATE OR DELETE ON sync_queue
  FOR EACH ROW EXECUTE FUNCTION cdc_capture('queue_id', 'failover');

-- Recreate patients_dolphin (structure + CDC trigger; data in backup).
CREATE TABLE patients_dolphin (
  pat_id         uuid NOT NULL PRIMARY KEY,
  pat_name       citext,
  pat_first_name citext,
  pat_last_name  citext,
  pat_phone1     citext,
  pat_gender     citext,
  pat_birthdate  timestamp,
  pat_other_id   citext
);
CREATE TRIGGER trg_cdc_capture AFTER INSERT OR UPDATE OR DELETE ON patients_dolphin
  FOR EACH ROW EXECUTE FUNCTION cdc_capture('pat_id', 'failover');
