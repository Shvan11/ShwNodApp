-- Up Migration
--
-- Doctor calendar colours become data only (frontend audit FE-F10-11, owner's call 2026-09-29).
--
-- WHY. public/js/components/react/doctorColors.ts coloured two employees by id — 1 amber and
-- 7 blue — whenever they had no `appointment_color`. Those ids are this clinic's two original
-- doctors. On every other install id 1 is the seeded `Clinic` pseudo-doctor (see
-- 1789460500000_seed-product-constants.sql), so a new center's neutral "Clinic" bucket showed up
-- amber, and whoever happened to be employee 7 turned blue. The literals are gone from the code;
-- a doctor without a colour now renders neutral everywhere.
--
-- WHAT THIS DOES. Writes the two picker hexes the code used to fall back to into the two rows
-- they described, so this clinic's calendar looks the same after the deploy. It touches a row only
-- when the id AND the name both match AND no colour has been picked yet, so it is a no-op on any
-- other install and never overrides a choice made in Settings → Employees.
--
-- No Supabase mirror half: row DATA, not DDL. cdc_capture replicates the two UPDATEs like any
-- Employee Settings save.

UPDATE public.employees
   SET appointment_color = '#d8a64b'
 WHERE id = 1
   AND employee_name = 'Shwan Elias'
   AND (appointment_color IS NULL OR appointment_color = '');

UPDATE public.employees
   SET appointment_color = '#4f8de0'
 WHERE id = 7
   AND employee_name = 'Rojena'
   AND (appointment_color IS NULL OR appointment_color = '');

-- Down Migration
--
-- Nothing to undo: the colours are ordinary, editable data, and a later edit in Settings must not
-- be reverted by a rollback.
