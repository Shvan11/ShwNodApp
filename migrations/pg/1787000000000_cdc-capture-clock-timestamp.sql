-- Up Migration
--
-- CDC change_log: stamp `changed_at` with clock_timestamp() instead of now().
--
-- `changed_at` is the version token in the engine's guarded delete — after applying a change the
-- drainer clears the entry only `WHERE changed_at = <the value it read>`, so a row re-touched
-- mid-cycle survives and is reprocessed (at-least-once; every sink.upsert is idempotent).
--
-- In PostgreSQL `now()` is transaction_timestamp(): every statement in one transaction gets the
-- SAME value, and — more to the point — two DIFFERENT transactions that began in the same
-- microsecond also get the same value. That is the one shape in which the guard fails open: txn A
-- writes row X and commits (change_log gets stamp T), the engine reads (X, T) and starts applying,
-- then txn B — which happened to begin at the identical microsecond — writes X again and commits,
-- the ON CONFLICT clause re-stamps changed_at to T, and the engine's delete matches. B's change is
-- silently dropped from the feed and never reaches the mirror.
--
-- clock_timestamp() reads the wall clock at the moment the trigger fires, so the collision window
-- shrinks from "two transactions starting in the same microsecond" to "two trigger invocations
-- executing in the same microsecond" on the same row — unreachable in practice, since they would
-- have to be serialized by the row lock anyway.
--
-- The opposite ordering was already safe and stays safe: a long-running transaction that BEGAN
-- before the engine's read but writes the row afterwards stamps an EARLIER value, the delete finds
-- no match, and the entry is correctly reprocessed. The guard has only ever erred toward
-- reprocessing; this closes the one case where it could err toward dropping.
--
-- Nothing else about the feed changes: `changed_at` keeps the same type and the same ORDER BY role
-- (clock_timestamp is monotonic within a transaction, so ordering only gets more accurate).
--
-- ⚠️ MIRROR: apply migrations/supabase/cdc-capture-clock-timestamp-2026-08-31.sql to the Supabase
--    mirror in the same change — it carries the identical fix for cdc_capture_remote(), which
--    stamps the Supabase-side change_log the reverse engine drains with the same guard.

CREATE OR REPLACE FUNCTION public.cdc_capture() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  pk_col text := TG_ARGV[0];
  pk_val text;
  v_op   char(1);
  i      int;
  s      text;
BEGIN
  IF current_setting('app.cdc_origin', true) = 'reverse' THEN
    RETURN NULL;                                  -- reverse-sync write: do not re-capture
  END IF;

  IF    TG_OP = 'DELETE' THEN v_op := 'D';
  ELSIF TG_OP = 'UPDATE' THEN v_op := 'U';
  ELSE                        v_op := 'I';
  END IF;

  -- Fan out to each sink named on the trigger, if that sink's capture is enabled. The row's PK is
  -- extracted lazily on the first enabled sink (at most once), so a write with NO capturing sink
  -- skips the per-row to_jsonb() entirely.
  FOR i IN 1 .. (TG_NARGS - 1) LOOP
    s := TG_ARGV[i];
    IF EXISTS (SELECT 1 FROM cdc_sink_control c WHERE c.sink = s AND c.enabled) THEN
      IF pk_val IS NULL THEN
        pk_val := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> pk_col);
        IF pk_val IS NULL THEN
          RETURN NULL;                            -- no PK value: nothing to capture
        END IF;
      END IF;
      -- clock_timestamp(), NOT now(): the value is the drainer's version token, so it must advance
      -- per trigger invocation rather than per transaction. See the migration header.
      INSERT INTO change_log ("sink", "tbl", "pk", "op", "changed_at")
      VALUES (s, TG_TABLE_NAME, pk_val, v_op, clock_timestamp())
      ON CONFLICT ("sink", "tbl", "pk")
      DO UPDATE SET "op" = EXCLUDED."op", "changed_at" = EXCLUDED."changed_at";
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Down Migration
--
-- Restores the now() stamp verbatim. Safe at any time — the engine reads whatever value the trigger
-- wrote and compares it back, so the two forms interoperate row-by-row with no migration of data.

CREATE OR REPLACE FUNCTION public.cdc_capture() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  pk_col text := TG_ARGV[0];
  pk_val text;
  v_op   char(1);
  i      int;
  s      text;
BEGIN
  IF current_setting('app.cdc_origin', true) = 'reverse' THEN
    RETURN NULL;
  END IF;

  IF    TG_OP = 'DELETE' THEN v_op := 'D';
  ELSIF TG_OP = 'UPDATE' THEN v_op := 'U';
  ELSE                        v_op := 'I';
  END IF;

  FOR i IN 1 .. (TG_NARGS - 1) LOOP
    s := TG_ARGV[i];
    IF EXISTS (SELECT 1 FROM cdc_sink_control c WHERE c.sink = s AND c.enabled) THEN
      IF pk_val IS NULL THEN
        pk_val := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> pk_col);
        IF pk_val IS NULL THEN
          RETURN NULL;
        END IF;
      END IF;
      INSERT INTO change_log ("sink", "tbl", "pk", "op", "changed_at")
      VALUES (s, TG_TABLE_NAME, pk_val, v_op, now())
      ON CONFLICT ("sink", "tbl", "pk")
      DO UPDATE SET "op" = EXCLUDED."op", "changed_at" = EXCLUDED."changed_at";
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
