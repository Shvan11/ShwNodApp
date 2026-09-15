-- Up Migration
--
-- Make the clinic's name inside PATIENT MESSAGES configurable (audit finding F7).
--
-- WHY. This is a multi-deployment product, but ten outbound message bodies had this clinic's name
-- compiled into them with no override (`messaging-queries.ts` x6 EN+AR, `whatsapp-batch-plan.ts`
-- x4). A second center would text its own patients "your appointment with Dr. Shwan orthodontic
-- clinic".
--
-- WHY NOT REUSE `CLINIC_NAME`. That row is the HEADER display name and currently reads
-- "Shwan Orthodontics", while the messages say "Dr. Shwan orthodontic clinic". Pointing the
-- builders at it would have silently reworded every reminder this clinic sends, which is the exact
-- failure `whatsapp-batch-plan.ts`'s header warns about. So: its own pair of rows, seeded here with
-- the wording that is live today. This migration is therefore a NO-OP for existing patients — the
-- text does not change until somebody edits it in Settings → General.
--
-- No Supabase mirror half: this is row DATA, not DDL, so cdc_capture replicates both INSERTs to the
-- mirror like any other write.

INSERT INTO public.options (option_name, option_value)
VALUES
  ('CLINIC_MESSAGE_NAME',    'Dr. Shwan orthodontic clinic'),
  ('CLINIC_MESSAGE_NAME_AR', 'عيادة د.شوان لتقويم الاسنان')
ON CONFLICT (option_name) DO NOTHING;

-- Down Migration
DELETE FROM public.options WHERE option_name IN ('CLINIC_MESSAGE_NAME', 'CLINIC_MESSAGE_NAME_AR');
