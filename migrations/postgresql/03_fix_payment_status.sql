-- Fix payment status to allow all values from SQL Server
-- Drop the old constraint and add a new one with correct values

ALTER TABLE aligner_set_payments
DROP CONSTRAINT IF EXISTS aligner_set_payments_payment_status_check;

ALTER TABLE aligner_set_payments
ADD CONSTRAINT aligner_set_payments_payment_status_check
CHECK (payment_status IN ('Paid', 'Partial', 'Unpaid', 'No Cost Set'));
