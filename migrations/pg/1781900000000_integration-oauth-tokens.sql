-- OAuth token store for external service integrations (3Shape Unite first).
--
-- One row per provider holding the live access/refresh tokens + expiry. Written
-- only by the server's OAuth flow (services/threeshape/oauth.ts); never read by
-- the client.
--
-- LOCAL-ONLY BY DESIGN — this table carries NO `cdc_capture` trigger, so it is
-- deliberately NOT replicated to the Supabase mirror. OAuth tokens are on-prem
-- secrets and must not leave the clinic server. (Contrast the `options` table,
-- which IS captured — that is exactly why the Telegram session lives there but
-- these tokens do not.) There is therefore intentionally NO Supabase mirror DDL
-- for this table (the usual "mirror every local DDL" rule applies only to
-- captured tables).
--
-- expires_at / updated_at are `timestamp` WITHOUT time zone per CLAUDE.md (the
-- single-clinic wall-clock convention; the process TZ is pinned to Asia/Baghdad
-- so now() <-> new Date() round-trips). The handoff doc's sample used timestamptz
-- — we deliberately diverge.
--
-- Apply (squashed-baseline state — `node-pg-migrate up` would replay the baseline;
-- `psql -f` would also run the Down below). Run the Up statement directly, LOCAL only:
--   scripts/psql.sh local -c "CREATE TABLE IF NOT EXISTS public.integration_oauth_tokens (...);"
-- Then regenerate types:  npm run db:codegen
-- This file is the node-pg-migrate record.

-- Up Migration
CREATE TABLE IF NOT EXISTS public.integration_oauth_tokens (
  provider      text PRIMARY KEY,
  access_token  text NOT NULL,
  refresh_token text,
  token_type    text NOT NULL DEFAULT 'Bearer',
  scope         text,
  expires_at    timestamp NOT NULL,
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS public.integration_oauth_tokens;
