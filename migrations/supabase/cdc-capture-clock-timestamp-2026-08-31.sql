-- Supabase mirror half of migrations/pg/1787000000000_cdc-capture-clock-timestamp.sql —
-- applied via scripts/psql.sh supa (function replacement only, no table DDL, no data touched).
--
-- Same reasoning as the local half: `change_log.changed_at` is the version token the drain engine
-- compares back in its guarded delete, so it must advance per trigger invocation, not per
-- transaction. `now()` is transaction_timestamp(), which two transactions beginning in the same
-- microsecond share — the one shape in which the guard fails open and silently drops the second
-- change. clock_timestamp() shrinks that to two trigger invocations on the same row in the same
-- microsecond, which the row lock already serializes.
--
-- This function stamps the SUPABASE-side change_log(sink='reverse') that the reverse engine drains,
-- so leaving it on now() while local moved would put the two halves of the two-way path on
-- different guarantees. Apply either order; they are independent.
--
-- Nothing else changes: the origin-guard branch (skip under app.cdc_origin='failover', which breaks
-- the echo loop AND preserves updated_at verbatim), SECURITY DEFINER, and the search_path pin are
-- all reproduced verbatim from migrations/supabase/reverse-cdc.sql § 3. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION cdc_capture_remote() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pk_col text := TG_ARGV[0];
  pk_val text;
  v_op   char(1);
BEGIN
  IF current_setting('app.cdc_origin', true) = 'failover' THEN
    RETURN NULL;                                  -- forward mirror write: do not echo back to local
  END IF;

  IF    TG_OP = 'DELETE' THEN v_op := 'D';
  ELSIF TG_OP = 'UPDATE' THEN v_op := 'U';
  ELSE                        v_op := 'I';
  END IF;

  IF EXISTS (SELECT 1 FROM cdc_sink_control c WHERE c.sink = 'reverse' AND c.enabled) THEN
    pk_val := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> pk_col);
    IF pk_val IS NULL THEN
      RETURN NULL;
    END IF;
    -- clock_timestamp(), NOT now() — see the header.
    INSERT INTO change_log ("sink", "tbl", "pk", "op", "changed_at")
    VALUES ('reverse', TG_TABLE_NAME, pk_val, v_op, clock_timestamp())
    ON CONFLICT ("sink", "tbl", "pk")
    DO UPDATE SET "op" = EXCLUDED."op", "changed_at" = EXCLUDED."changed_at";
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;
