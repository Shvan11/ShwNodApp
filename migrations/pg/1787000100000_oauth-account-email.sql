-- Up Migration
--
-- Record WHICH external account each OAuth grant belongs to.
--
-- The Google Contacts integration is multi-account (shared/google-contacts-accounts.ts: `shw` =
-- Dr. Shwan Phone, `cli` = Clinic Phone), with one token row per account keyed
-- `provider='google_contacts:<id>'`. Which account a grant is FOR was decided purely by the
-- session at callback time — the consent URL itself was identical for both, so connecting "Clinic
-- Phone" while the browser happened to be signed into the Dr. Shwan Google account stored that
-- grant under `cli` with no error anywhere. The only symptom was the wrong names appearing in a
-- recipient dropdown.
--
-- `account_email` closes that: the callback now reads the connected account's own address back from
-- the People API, stores it here, refuses a grant whose address is already held by a DIFFERENT
-- registered slot, and shows it on the Settings → Integrations card so a mismatch is visible rather
-- than silent. It also gives a re-connect a `login_hint`, so Google preselects the right account.
--
-- Nullable on purpose: existing rows (and the single-account Drive / 3Shape providers, which have
-- no such ambiguity) legitimately have no value, and a grant imported from the retired on-disk
-- `tokens/*.json` files can't know its address until its first refresh.
--
-- `integration_oauth_tokens` is LOCAL-ONLY — it carries no cdc_capture trigger precisely so the
-- clinic's OAuth secrets never replicate — so there is deliberately NO Supabase mirror half to this
-- migration. The table itself is created by the 2026-07-30 baseline
-- (1783100000000_baseline-2026-07-30.sql), which squashed the original
-- 1781900000000_integration-oauth-tokens.sql.

ALTER TABLE integration_oauth_tokens
  ADD COLUMN IF NOT EXISTS account_email citext;

COMMENT ON COLUMN integration_oauth_tokens.account_email IS
  'External account this grant belongs to (Google address for google_contacts:*). NULL when unknown / not applicable.';

-- Down Migration
--
-- Dropping the column only loses the recorded identity; the grants themselves keep working. The
-- callback re-populates it on the next connect.

ALTER TABLE integration_oauth_tokens
  DROP COLUMN IF EXISTS account_email;
