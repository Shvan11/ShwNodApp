-- Up Migration
--
-- The patient typeahead's "name starts with" index.
--
-- WHY. Every patient search box (Patient Management, the Transfer dialog, the till, the message
-- pickers, the task form) now asks the server for its suggestions on each pause in typing
-- (`GET /api/patients/lookup`, services/database/queries/patient-lookup-queries.ts) instead of
-- downloading the whole patient list and filtering it in the browser. The suggestions are the names
-- that START with the text, in name order, then the names that contain it.
--
-- The trigram index answers "starts with" too, but not in order: it returns every match, which then
-- has to be fetched and sorted before the first eight can be shown. At 150,000 patients that is
-- 6,000 rows for the two letters that begin the commonest name (20 ms on Linux, about 50 ms on the
-- Windows server, whose lower() is slower). This index is the same set as a range, already in order:
-- the scan reads eight entries and stops (0.4 ms, whatever the name).
--
-- `text_pattern_ops` is what lets `LIKE 'abc%'` become an index range in a database whose collation
-- is not C (this clinic's is English_World.1256). `lower(...)` makes it case-insensitive the way the
-- citext column itself is. The query must use this exact expression, and order by it `USING ~<~`.
--
-- The code does not depend on it: without the index the same statement reads the table (7 ms at
-- this clinic's 6,859 patients), so build and migrate in either order. The build takes a brief
-- write lock on `patients` (well under a second at any size this product reaches).
--
-- Mirror half: migrations/supabase/patients-name-prefix-index-2026-10-06.sql (DDL never replicates).

CREATE INDEX ix_patients_name_prefix
  ON public.patients USING btree (lower((patient_name)::text) text_pattern_ops);

-- Down Migration
DROP INDEX IF EXISTS public.ix_patients_name_prefix;
