-- Per-doctor commission rate: nullable 1–100 percentage on the employees lookup.
--
-- Applied 2026-06-18 by running the FORWARD-ONLY mirror file
-- (migrations/supabase/employee-commission-pct-2026-06-18.sql) via psql against BOTH
-- Supabase (first) and LOCAL — NOT this file (`psql -f` would also run the Down
-- section below and undo it) and NOT `node-pg-migrate up` (squashed-baseline state;
-- see the patient-type-name-ar migration). This file is the node-pg-migrate record.
-- Plain `ADD COLUMN ... NULL` is metadata-only (instant, no rewrite).
--
-- Why: the clinic pays certain doctors a commission = a fixed % of the money actually
-- collected on their works. The existing `employees.percentage` boolean only flags THAT
-- a doctor is on percentage-based compensation; it stores no rate. This adds the rate.
-- The flag stays the on/off toggle; the rate is required when the flag is on and NULL
-- when off — that flag↔rate coupling is enforced in TypeScript (contract refine +
-- handler), keeping app logic out of the DB per CLAUDE.md; the DB only range-guards.
-- smallint (1–100 fits) → kysely-codegen maps it to `number | null`.
--
-- CDC: employees carries a `cdc_capture('id', 'failover')` trigger AND has `updated_at`
-- (→ reverse-sync enrolled, two-way). CDC replicates row DATA only, never DDL, so the
-- Supabase mirror MUST have the same column or the upsert silently drops the field —
-- applied there first (migrations/supabase/employee-commission-pct-2026-06-18.sql).
-- No trigger change needed: a captured table picks up new columns automatically.
--
-- Behavior change shipped alongside (code, not DDL): quitting an employee no longer
-- auto-clears the commission flag/rate (only email + appointment flags clear), so a
-- doctor who has left still appears in the Statistics commission report for periods
-- they were working.
--
-- Index: the commission report drives employees(percentage)→works(dr_id)→invoices.
-- works.dr_id is NOT NULL + a real FK to employees(id) (no 0 sentinel here — every
-- work has a real doctor), yet it was UNINDEXED. The invoices leg is already covered
-- by ix_wid_date_sum (work_id) INCLUDE (amount_paid, date_of_payment), so adding a
-- plain btree on works.dr_id makes the whole report index-driven. Per CLAUDE.md's
-- "index the per-doctor access paths a busy multi-doctor center hits" (the works
-- analog of the appointments (dr_id, app_date) index) — design for the hundreds-of-
-- thousands-of-works ceiling, not this clinic's ~7k rows.

-- Up Migration
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS commission_percentage smallint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_employees_commission_pct') THEN
    ALTER TABLE public.employees ADD CONSTRAINT chk_employees_commission_pct
      CHECK (commission_percentage IS NULL OR commission_percentage BETWEEN 1 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_works_dr_id ON public.works (dr_id);

-- Down Migration
DROP INDEX IF EXISTS ix_works_dr_id;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS chk_employees_commission_pct;
ALTER TABLE public.employees DROP COLUMN IF EXISTS commission_percentage;
