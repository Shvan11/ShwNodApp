-- ============================================================================================
-- Reverse CDC v2 — Supabase mirror read-only enforcement (prepping a full web version of the app).
-- Idempotent; RE-RUN whenever a table is promoted into the reverse set (gains updated_at).
--
-- Decision: plain TABLE PRIVILEGES on a dedicated LOGIN role — not RLS (a password/owner connection
-- bypasses it) and not a trigger. This makes "writable on Supabase ⟺ in the reverse set" hold even
-- for a raw password/psql connection, so the rule the reverse sync relies on is enforced by the DB.
--
--   • The web app / manual password access connects as  mirror_rw  (read-everything, write only the
--     reverse set).
--   • The forward sync + any reload keep using the OWNER role from SUPABASE_FAILOVER_DB_URL
--     (full access, unaffected).
--
-- ⚠️ Role creation + password is USER-RUN / SECRET (never committed). Create it FIRST:
--     CREATE ROLE mirror_rw LOGIN BYPASSRLS;
--     ALTER ROLE mirror_rw PASSWORD '…';
--   BYPASSRLS so the existing server-side RLS lock doesn't block its reads — table GRANTs (below),
--   not RLS, are the authority here. (If the Supabase tier won't grant BYPASSRLS, fallback: a blanket
--   SELECT RLS policy for mirror_rw; the GRANTs still govern writes.)
--
-- ⚠️ Inherent caveat (by design): the guarantee is bound to the ROLE — connecting as postgres/owner
--   still bypasses it, so normal/web writes MUST use the mirror_rw password. (Owner-proofing would
--   need a trigger, which was opted out of.)
-- ============================================================================================

-- Guard: fail loud with the fix if the secret role wasn't created yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mirror_rw') THEN
    RAISE EXCEPTION 'Role mirror_rw does not exist. Create it first (user-run/secret): '
      'CREATE ROLE mirror_rw LOGIN BYPASSRLS; ALTER ROLE mirror_rw PASSWORD ''…'';';
  END IF;
END $$;

-- Read everything (incl. sync infra — harmless; writes are governed below).
GRANT USAGE ON SCHEMA public TO mirror_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mirror_rw;
-- Future tables auto-readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mirror_rw;

-- Write ONLY the reverse set (tables with updated_at, excluding infra) + USAGE on each table's
-- identity sequence so even-PK inserts work. NO write grants on unsynced tables → writes fail
-- `permission denied`, which is exactly the "writable ⟺ reverse-set" invariant.
DO $$
DECLARE
  r   record;
  pk  text;
  seq text;
BEGIN
  FOR r IN
    SELECT col.table_name AS tbl
      FROM information_schema.columns col
      JOIN information_schema.tables t
        ON t.table_schema = col.table_schema AND t.table_name = col.table_name AND t.table_type = 'BASE TABLE'
     WHERE col.table_schema = 'public'
       AND col.column_name = 'updated_at'
       AND col.table_name NOT IN
           ('change_log', 'cdc_sink_control', 'pgmigrations', 'staff_sessions', 'portal_sessions', 'dolphin_sync_map')
  LOOP
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I TO mirror_rw', r.tbl);
    SELECT a.attname INTO pk
      FROM pg_index i
      JOIN pg_class c     ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
     WHERE c.relname = r.tbl AND i.indisprimary AND array_length(i.indkey::int[], 1) = 1;
    IF pk IS NOT NULL THEN
      seq := pg_get_serial_sequence('public.' || quote_ident(r.tbl), pk);
      IF seq IS NOT NULL THEN
        EXECUTE format('GRANT USAGE ON SEQUENCE %s TO mirror_rw', seq);
      END IF;
    END IF;
    RAISE NOTICE 'mirror-grants: write+seq granted on %', r.tbl;
  END LOOP;
END $$;
