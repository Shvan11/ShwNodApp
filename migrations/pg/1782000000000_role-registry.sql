-- Role registry: rename `secretary` -> `front_desk`, retire the unused `doctor`/
-- `user` values, and constrain `users.role` to exactly the three roles in the
-- `shared/auth/roles.ts` SSoT (`admin` | `front_desk` | `clinical`).
--
-- `users` IS in the failover capture set (trg_cdc_capture, baseline-schema.sql),
-- so the row rename below must run LOCAL ONLY (under the origin guard, so CDC
-- carries it to the Supabase mirror) — never hand-run the same UPDATE on
-- Supabase. The DDL (DEFAULT + CHECK) never replicates, so it runs on BOTH DBs.
--
-- Apply (squashed-baseline state — `node-pg-migrate up` would replay the
-- baseline; run directly instead). This file is the node-pg-migrate record.
--
--   Census first (both DBs): scripts/psql.sh local -c "SELECT role, count(*) FROM users GROUP BY role;"
--                            scripts/psql.sh supa  -c "SELECT role, count(*) FROM users GROUP BY role;"
--
--   1. Row rename — LOCAL ONLY:
--   scripts/psql.sh local -c "SET app.cdc_origin='failover'; UPDATE users SET role='front_desk' WHERE role='secretary';"
--
--   2. DDL — BOTH DBs:
--   scripts/psql.sh local -f migrations/pg/1782000000000_role-registry.sql
--   scripts/psql.sh supa  -f migrations/pg/1782000000000_role-registry.sql
--
-- Then regenerate types: npm run db:codegen (role stays `string` — no type change needed)

-- Up Migration
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'front_desk'::public.citext;
ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (
  role OPERATOR(public.=) ANY (ARRAY['admin'::public.citext, 'front_desk'::public.citext, 'clinical'::public.citext])
);

-- Down Migration
-- ALTER TABLE users DROP CONSTRAINT chk_users_role;
-- ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'::public.citext;
-- (then, LOCAL only, under the same origin guard: UPDATE users SET role='secretary' WHERE role='front_desk';)
