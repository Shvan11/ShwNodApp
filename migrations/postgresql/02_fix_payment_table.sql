-- Fix payment table to support upsert
-- Add unique constraint on aligner_set_id

ALTER TABLE aligner_set_payments
ADD CONSTRAINT unique_aligner_set_payment UNIQUE (aligner_set_id);

-- Also add an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_set_id ON aligner_set_payments(aligner_set_id);
