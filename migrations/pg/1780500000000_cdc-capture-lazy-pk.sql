-- Up Migration
--
-- Optimize cdc_capture(): extract the PK lazily, only when a listed sink is actually capturing.
--
-- Before, the function built to_jsonb(NEW/OLD) to read one PK column BEFORE checking whether any
-- sink was enabled. So a write with no capturing sink — e.g. a bulk load / reload run with the
-- kill switch off (UPDATE cdc_sink_control SET enabled=false …) — still paid a full-row JSONB
-- serialization per row for nothing. Now the row is serialized at most once, and only inside the
-- enabled-sink branch. Steady state (failover always on) does the identical work; the win is the
-- disabled/bulk-load path, which drops to a single cached cdc_sink_control lookup per row.
--
-- NOTE: dynamic single-column extraction (EXECUTE 'SELECT ($1).<col>') was measured ~70% SLOWER
-- than to_jsonb on a wide row (EXECUTE re-plans every call), so to_jsonb stays — it is the right
-- generic choice. The only change here is WHEN it runs, not HOW. Behavior (coalescing, op codes,
-- reverse-origin skip, NULL-PK skip) is unchanged.

CREATE OR REPLACE FUNCTION "cdc_capture"() RETURNS trigger AS $$
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
      INSERT INTO change_log ("sink", "tbl", "pk", "op", "changed_at")
      VALUES (s, TG_TABLE_NAME, pk_val, v_op, now())
      ON CONFLICT ("sink", "tbl", "pk")
      DO UPDATE SET "op" = EXCLUDED."op", "changed_at" = EXCLUDED."changed_at";
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
-- Restore the original eager-extraction body (from 1780178394399_add-failover-cdc.sql).

CREATE OR REPLACE FUNCTION "cdc_capture"() RETURNS trigger AS $$
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

  IF TG_OP = 'DELETE' THEN
    v_op := 'D'; pk_val := (to_jsonb(OLD) ->> pk_col);
  ELSIF TG_OP = 'UPDATE' THEN
    v_op := 'U'; pk_val := (to_jsonb(NEW) ->> pk_col);
  ELSE
    v_op := 'I'; pk_val := (to_jsonb(NEW) ->> pk_col);
  END IF;
  IF pk_val IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fan out to each sink named on the trigger, if that sink's capture is enabled.
  FOR i IN 1 .. (TG_NARGS - 1) LOOP
    s := TG_ARGV[i];
    IF EXISTS (SELECT 1 FROM cdc_sink_control c WHERE c.sink = s AND c.enabled) THEN
      INSERT INTO change_log ("sink", "tbl", "pk", "op", "changed_at")
      VALUES (s, TG_TABLE_NAME, pk_val, v_op, now())
      ON CONFLICT ("sink", "tbl", "pk")
      DO UPDATE SET "op" = EXCLUDED."op", "changed_at" = EXCLUDED."changed_at";
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
