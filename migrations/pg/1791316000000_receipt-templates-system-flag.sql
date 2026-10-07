-- Up Migration
--
-- The receipt layouts the code finds BY NAME are system templates.
--
-- WHY. `receipt-service` resolves two layouts by `template_name`: the discount variant and
-- the no-work receipt (services/templates/template-files.ts: DISCOUNT_RECEIPT_TEMPLATE_NAME,
-- NO_WORK_RECEIPT_TEMPLATE_NAME). `is_system` is what hides the Delete button on the Templates
-- screen and makes the server refuse the delete. The no-work row is seeded with the flag
-- (1789460500000); the discount row is not seeded at all (a new install prints the discount
-- layout from the shipped file), and on the original clinic it was loaded WITHOUT the flag. So
-- there it showed a Delete button, and deleting it sent every discounted receipt back to the
-- shipped layout, dropping whatever had been designed into the row.
--
-- WHAT THIS DOES. Sets the flag on any row carrying one of those two names. A no-op on an
-- install that has neither row or already flags them. The server no longer depends on it
-- (`templateDeleteBlock` refuses these rows by name), so this is what removes the button;
-- `services/database/fresh-install.test.ts` fails the gate if a name the code looks up is
-- missing from this statement. `template_name` is citext, so the match ignores case.
--
-- No Supabase mirror half: row DATA, not DDL. cdc_capture replicates the UPDATE.

UPDATE public.document_templates
   SET is_system = true
 WHERE template_name IN (
         'Shwan Orthodontics Default Receipt (With Discount)',
         'No-Work Appointment Receipt'
       )
   AND is_system IS DISTINCT FROM true;

-- Down Migration
--
-- Nothing to undo: which of these rows lacked the flag is not recorded, and clearing it
-- would only bring the Delete button back.
