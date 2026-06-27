-- Supabase mirror of migrations/pg/1782400000000_rename-bridge-to-crown-bridge.sql.
-- Data-only rename; idempotent. Applied for immediate parity (the local UPDATE also
-- replicates here through the work_types failover capture trigger).
UPDATE public.work_types SET work_type = 'Crown/Bridge' WHERE work_type = 'Bridge';
