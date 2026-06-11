-- Up Migration
--
-- Dual-surface the `alerts` table so it backs BOTH the existing patient-context
-- "Alerts" (flags shown when a patient is in view / on appointment cards) AND a
-- new app-wide "Tasks" feature surfaced in the universal header. One table, two
-- surfacing rules (see services/.../task.routes.ts + the header `surface_mode`
-- query). The table keeps its `alerts` name — renaming would churn the CDC
-- trigger, the Supabase mirror and codegen for zero user value.
--
-- New axis is `surface_mode`:
--   'context' — patient-only flag (current behavior; requires a person_id)
--   'push'    — shows in the header until acted on (person_id optional → a
--               clinic-wide task like "order brackets" has none)
--
-- Lifecycle moves from the boolean `is_active` to a 3-state `status`
-- (active | done | dismissed). The old soft-delete (is_active=false) maps to
-- 'dismissed'; 'done' is the new "task completed" state.
--
-- SYNC PARITY: the identical DDL+DML is applied to the Supabase mirror in the
-- same maintenance window — see migrations/supabase/alerts-to-tasks-2026-06-11.sql.
-- CDC replicates row DATA only, never DDL, so a missing mirror column would
-- silently drop the field on upsert (and a post-migration local row draining
-- into an un-migrated mirror would wedge the failover sink). Both sinks
-- (failover on local, reverse on Supabase) are kill-switched off for the window;
-- because the migration is applied directly to both sides they converge without
-- relying on replication. `alerts` stays in the reverse-sync LWW set (it already
-- carries `updated_at`); enrollment is unchanged.

ALTER TABLE alerts
  ALTER COLUMN person_id     DROP NOT NULL,   -- NULL = clinic-wide task (push only)
  ALTER COLUMN alert_type_id DROP NOT NULL,   -- tasks need no category
  ADD COLUMN surface_mode text NOT NULL DEFAULT 'context'
    CONSTRAINT chk_alerts_surface_mode CHECK (surface_mode IN ('context', 'push')),
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CONSTRAINT chk_alerts_status CHECK (status IN ('active', 'done', 'dismissed')),
  ADD COLUMN snoozed_until date,    -- header "dead time": hidden in the header until this day
  ADD COLUMN expires_at    date,    -- auto-hidden everywhere after this day
  ADD COLUMN escalate_at   date,    -- a context alert ALSO surfaces in the header from this day
  ADD COLUMN completed_at  timestamp,
  ADD COLUMN completed_by  text,    -- session username at completion (audit only, no FK)
  ADD CONSTRAINT chk_alerts_context_has_person
    CHECK (surface_mode = 'push' OR person_id IS NOT NULL);

-- Carry the existing soft-deletes across to the new status axis, then retire the
-- boolean. All other rows keep the 'active' default.
UPDATE alerts SET status = 'dismissed' WHERE is_active = false;
ALTER TABLE alerts DROP COLUMN is_active;


-- Down Migration
--
-- Best-effort reversal. New-feature rows that cannot fit the old schema (a
-- clinic-wide task with no patient, or a category-less task) are DELETED before
-- the NOT NULLs are restored — rolling back necessarily loses task-only data.

ALTER TABLE alerts ADD COLUMN is_active boolean NOT NULL DEFAULT true;
UPDATE alerts SET is_active = false WHERE status <> 'active';

ALTER TABLE alerts DROP CONSTRAINT chk_alerts_context_has_person;
ALTER TABLE alerts
  DROP COLUMN surface_mode,
  DROP COLUMN status,
  DROP COLUMN snoozed_until,
  DROP COLUMN expires_at,
  DROP COLUMN escalate_at,
  DROP COLUMN completed_at,
  DROP COLUMN completed_by;

DELETE FROM alerts WHERE person_id IS NULL OR alert_type_id IS NULL;
ALTER TABLE alerts
  ALTER COLUMN person_id     SET NOT NULL,
  ALTER COLUMN alert_type_id SET NOT NULL;
