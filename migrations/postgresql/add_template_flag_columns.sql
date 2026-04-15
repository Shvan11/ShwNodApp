-- =============================================
-- Add has_upper_template / has_lower_template to aligner_batches
-- =============================================
-- Mirrors the SQL Server schema change in
-- migrations/sqlserver/add_template_flag_columns.sql
-- so the reverse-sync JsonData can round-trip flag values.
-- =============================================

ALTER TABLE aligner_batches
    ADD COLUMN IF NOT EXISTS has_upper_template BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS has_lower_template BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN aligner_batches.has_upper_template IS
    'True when slot 0 of the batch is an upper template (not a real aligner)';
COMMENT ON COLUMN aligner_batches.has_lower_template IS
    'True when slot 0 of the batch is a lower template (not a real aligner)';
