-- Supabase mirror of migrations/pg/1781800500000_employee-commission-pct.sql.
-- Apply BEFORE the local DDL: employees is failover-captured (local→Supabase) AND
-- reverse-synced (two-way, it has updated_at), so the mirror must have the column or
-- the CDC upsert silently drops the field. Metadata-only ADD COLUMN. Idempotent.

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS commission_percentage smallint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_employees_commission_pct') THEN
    ALTER TABLE public.employees ADD CONSTRAINT chk_employees_commission_pct
      CHECK (commission_percentage IS NULL OR commission_percentage BETWEEN 1 AND 100);
  END IF;
END $$;

-- Keep the mirror's index set symmetric with local (CLAUDE.md: mirrors stay identical).
CREATE INDEX IF NOT EXISTS ix_works_dr_id ON public.works (dr_id);
