-- Supabase mirror of migrations/pg/1781800400000_patient-type-name-ar.sql.
-- Apply BEFORE the local DDL: patient_types is failover-captured (local→Supabase),
-- so the mirror must have the column or the upsert silently drops the field.
-- Metadata-only ADD COLUMN. Controlled-vocab AR seeds: seed-patient-types-ar.sql.

ALTER TABLE public.patient_types ADD COLUMN IF NOT EXISTS patient_type_name_ar citext;
