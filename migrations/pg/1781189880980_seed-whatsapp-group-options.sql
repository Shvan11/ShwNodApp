-- Up Migration
--
-- Seed the two settings rows that back the "post the daily appointments PDF to a
-- WhatsApp group" feature on the /send page. These live in the key/value `options`
-- table (the single source of truth, edited at runtime from the UI) so there is NO
-- hardcoded default in application code — the default value lives HERE, in the DB:
--
--   whatsapp_send_to_group = 'true'                (feature on by default)
--   whatsapp_group_name    = 'Shwan Orthodontics'  (default target group)
--
-- ON CONFLICT DO NOTHING makes this idempotent and non-destructive: if an operator
-- already set either value (e.g. on a DB seeded before this migration), it is left
-- untouched.
--
-- SYNC PARITY: unlike a DDL change, this is row DATA into an already-mirrored,
-- CDC-captured table (`cdc_capture('option_name','failover')`). The INSERTs are
-- captured by the failover trigger and replicate to the Supabase mirror through the
-- normal failover sink — so NO manual Supabase apply and NO kill-switch are needed.
-- `options` keeps its `updated_at` column, so the rows stay in the reverse-sync LWW
-- set; being brand-new keys, they have no remote counterpart to conflict with.

INSERT INTO options (option_name, option_value) VALUES
  ('whatsapp_send_to_group', 'true'),
  ('whatsapp_group_name', 'Shwan Orthodontics')
ON CONFLICT (option_name) DO NOTHING;


-- Down Migration

DELETE FROM options
WHERE option_name IN ('whatsapp_send_to_group', 'whatsapp_group_name');
