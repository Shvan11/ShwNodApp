/**
 * Aligner PAYMENT business logic — validation around an invoice raised against an
 * aligner set.
 *
 * Split out of AlignerService.ts (S2/C4).
 */

import { log } from '../../utils/logger.js';
import * as alignerPaymentQueries from '../database/queries/aligner-payment-queries.js';
import { AlignerValidationError } from './AlignerErrors.js';

/**
 * Payment creation data
 */
export interface PaymentCreateData {
  workid: number;
  aligner_set_id: number;
  amount_paid: number | string;
  date_of_payment: string;
  change?: number;
  notes?: string;
}

// ==============================
// ALIGNER PAYMENTS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a payment against an aligner set.
 *
 * Shape note: the balance rules are NOT enforced here. They live in
 * `aligner-payment-queries.createAlignerPayment`, inside one transaction with `works` and
 * `aligner_sets` locked — a check made here would be a read-then-write that two concurrent payments
 * both pass (audit finding F2). This layer validates what can be validated without touching the
 * database, calls the guarded write, and turns its outcome into the error the route already maps
 * onto a 400.
 *
 * @param paymentData - Payment data
 * @returns New invoice id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreatePayment(
  paymentData: PaymentCreateData
): Promise<number> {
  const { workid, aligner_set_id, amount_paid, date_of_payment } = paymentData;

  if (!workid || !amount_paid || !date_of_payment) {
    throw new AlignerValidationError(
      'workid, amount_paid, and date_of_payment are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  const paymentAmount = parseFloat(String(amount_paid));
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new AlignerValidationError(
      'Payment amount must be greater than zero',
      'INVALID_AMOUNT'
    );
  }

  log.info(
    `Adding payment for work id: ${workid}, Set id: ${aligner_set_id || 'general'}, amount: ${amount_paid}`
  );

  const result = await alignerPaymentQueries.createAlignerPayment(paymentData);

  switch (result.outcome) {
    case 'created':
      log.info(`Payment added successfully: Invoice ${result.invoice_id}`);
      return result.invoice_id;

    case 'work_not_found':
      throw new AlignerValidationError('Treatment not found', 'SET_NOT_FOUND', { workId: workid });

    case 'set_not_found':
      throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', { setId: aligner_set_id });

    case 'set_cost_not_defined':
      throw new AlignerValidationError(
        'Set cost must be defined before accepting payments',
        'SET_COST_NOT_DEFINED',
        { setId: aligner_set_id }
      );

    case 'invalid_amount':
      throw new AlignerValidationError('Payment amount must be greater than zero', 'INVALID_AMOUNT');

    case 'exceeds_set_balance':
      throw new AlignerValidationError(
        `Payment amount (${paymentAmount}) exceeds the set's remaining balance (${result.setBalance})`,
        'PAYMENT_EXCEEDS_BALANCE',
        { setId: aligner_set_id, amount: paymentAmount, balance: result.setBalance }
      );

    // The work-level rule the set path used to skip entirely. Worth a message that names the cause:
    // the commonest way to hit it is a set priced on a treatment whose own total is still 0, and
    // "exceeds the remaining balance (0)" on its own reads as a bug rather than as missing data.
    case 'exceeds_work_balance':
      throw new AlignerValidationError(
        result.totalRequired === 0
          ? `This treatment has no total cost set yet, so it cannot take a payment of ${paymentAmount}. ` +
            `Set the treatment's total cost first.`
          : `Payment amount (${paymentAmount}) exceeds the treatment's remaining balance (${result.remaining})`,
        'PAYMENT_EXCEEDS_BALANCE',
        { workId: workid, amount: paymentAmount, balance: result.remaining }
      );
  }
}
