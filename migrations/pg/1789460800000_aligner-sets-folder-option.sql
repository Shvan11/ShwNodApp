-- Up Migration
--
-- The aligner share root becomes configuration (frontend audit FE-F17-7).
--
-- WHY. PatientSets built every aligner folder path as `\\WORK_PC\Aligner_Sets\<dr>\<person>\<set>`
-- from literals — this clinic's work PC. On any other install "Open Folder", the PDF picker's
-- start folder and the copied path all pointed at a machine that does not exist. The root now
-- comes from the `AlignerSetsFolder` option (shared/clinic-options.ts), edited in Settings →
-- General like `PatientsFolder`; `npm run db:setup` creates it empty on a new install.
--
-- WHAT THIS DOES. Pins the root the code used to assume, so this clinic's buttons keep working
-- after the deploy. It writes the row only on the install whose Archform path is on that same
-- machine (`\\WORK_PC\…`, the one place this clinic's identity is already data) and only when no
-- `AlignerSetsFolder` row exists, so it is a no-op everywhere else and never overrides a value
-- set in Settings.
--
-- No Supabase mirror half: row DATA, not DDL. cdc_capture replicates the INSERT.

INSERT INTO public.options (option_name, option_value)
SELECT 'AlignerSetsFolder', E'\\\\WORK_PC\\Aligner_Sets'
 WHERE EXISTS (
         SELECT 1 FROM public.options
          WHERE option_name = 'ARCHFORM_DB_PATH'
            AND upper(option_value) LIKE E'\\\\\\\\WORK\\_PC\\\\%'
       )
ON CONFLICT (option_name) DO NOTHING;

-- Down Migration
--
-- Nothing to undo: the row is ordinary, editable configuration, and a later edit in Settings
-- must not be reverted by a rollback.
