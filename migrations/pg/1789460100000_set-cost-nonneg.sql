-- Up Migration
--
-- `aligner_sets.set_cost >= 0` (audit finding F6).
--
-- WHY. Every money column in this schema is guarded against negatives at the contract boundary by
-- `moneyInt`, which states the rule for the whole schema: no money field legitimately takes a
-- negative. The two genuinely-`numeric` columns are exempt from `moneyInt` because they take
-- DECIMALS — and that exemption silently dropped the sign rule with it, leaving `set_cost` the one
-- money field with no guard anywhere: not in the contract (now fixed), and not here.
--
-- A negative set cost is not just a wrong figure. `PaymentStatus` reads **'Paid'** at zero paid
-- (`0 >= -500`), `Balance` goes negative, and `AlignerPaymentService` then rejects EVERY payment as
-- exceeding the balance — so the set can never be paid at all, and the only exit is editing the
-- cost back. The contract change stops new bad values; this stops every other writer (a script, the
-- reverse sync, a manual UPDATE), which is the layer the contract cannot reach.
--
-- NULL is allowed and meaningful: "cost not set yet" (120 of 137 live sets). The payment path
-- already rejects a payment against a NULL-cost set with its own message.
--
-- Mirror half: migrations/supabase/set-cost-nonneg-2026-09-15.sql (DDL never replicates).

ALTER TABLE public.aligner_sets
  ADD CONSTRAINT aligner_sets_set_cost_nonneg
  CHECK (set_cost IS NULL OR set_cost >= 0);

-- Down Migration
ALTER TABLE public.aligner_sets
  DROP CONSTRAINT IF EXISTS aligner_sets_set_cost_nonneg;
