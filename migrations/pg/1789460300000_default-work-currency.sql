-- Up Migration
--
-- The clinic's DEFAULT WORK CURRENCY as configuration (frontend audit FE-F7-3, owner's call
-- 2026-09-28). Read by the work form (its currency select's starting value) and by
-- WorkService.validateAndCreateWork (the currency of a work a doctor/assistant adds, whose form has
-- no currency input). Edited in Settings → General; the codebook is shared/work-currency.ts.
--
-- WHY. A new work started at a hardcoded 'USD' while 79 % of this clinic's works are IQD, and a
-- "switch to IQD above 10,000" keystroke heuristic papered over it — which silently turned a
-- $2,000 work into 2,000 IQD while its total was being edited. This is a multi-deployment product,
-- so the default must be per clinic, not a literal.
--
-- THE SEED IS DERIVED, NOT ASSUMED: the currency most of this database's existing works already
-- use (IQD here). A fresh deployment has no works, so it gets '' — "not set", which the form treats
-- as "choose on every work" — rather than this clinic's currency. The row is inserted even then so
-- it appears in Settings → General (whose generic list shows existing rows only).
--
-- No Supabase mirror half: this is row DATA, not DDL, so cdc_capture replicates the INSERT to the
-- mirror like any other options write (cf. 1789460200000_clinic-message-name.sql).

INSERT INTO public.options (option_name, option_value)
SELECT 'DEFAULT_WORK_CURRENCY',
       COALESCE(
         (SELECT upper(w.currency::text)
            FROM public.works w
           WHERE upper(w.currency::text) IN ('IQD', 'USD')
           GROUP BY upper(w.currency::text)
           ORDER BY count(*) DESC, upper(w.currency::text)
           LIMIT 1),
         ''
       )
ON CONFLICT (option_name) DO NOTHING;

-- Down Migration
DELETE FROM public.options WHERE option_name = 'DEFAULT_WORK_CURRENCY';
