-- Up Migration
--
-- Move express-session storage from SQLite (connect-sqlite3 → ./data/sessions.db,
-- ./data/portal-sessions.db) into PostgreSQL via connect-pg-simple, so the whole app
-- has a single durable backing store (matches the Phase 9 "pg-only" goal and the planned
-- OS-agnostic / Linux-server move — SQLite session files are local-disk-bound and don't
-- travel with a DB backup).
--
-- Two tables mirror the two prior SQLite files and the two independent session middlewares
-- in index.ts (staff cookie "shwan.sid" vs patient-portal cookie "shwan.portal", separate
-- secrets). connect-pg-simple is configured with createTableIfMissing: false so node-pg-migrate
-- remains the sole schema owner (per CLAUDE.md) — the store never issues DDL at runtime.
--
-- Schema matches connect-pg-simple's expected columns (sid / sess / expire). We do NOT copy the
-- library's bundled table.sql verbatim: it uses `WITH (OIDS=FALSE)`, which is a hard error on
-- PostgreSQL 14+ (this DB is PG 17). `sess` is json (the column the store reads/writes); expire
-- is `timestamp(6) WITHOUT TIME ZONE`, consistent with the app's wall-clock date policy. The
-- store manages expiry server-side via to_timestamp(), so the kysely.ts timestamp type parser
-- is not involved. Identifiers are lowercase (unquoted-safe) so kysely-codegen / queries stay simple.

CREATE TABLE "staff_sessions" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "IDX_staff_sessions_expire" ON "staff_sessions" ("expire");

CREATE TABLE "portal_sessions" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "IDX_portal_sessions_expire" ON "portal_sessions" ("expire");

-- Down Migration

DROP TABLE IF EXISTS "portal_sessions";
DROP TABLE IF EXISTS "staff_sessions";
