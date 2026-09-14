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
 * Validate and create a payment
 *
 * Business Rules:
 * - workid, amount_paid, and date_of_payment are required
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
  if (paymentAmount <= 0) {
    throw new AlignerValidationError(
      'Payment amount must be greater than zero',
      'INVALID_AMOUNT'
    );
  }

  // Validate payment doesn't exceed set balance
  if (aligner_set_id) {
    const setBalance = await alignerPaymentQueries.getAlignerSetBalance(aligner_set_id);

    if (!setBalance) {
      throw new AlignerValidationError(
        'Aligner set not found',
        'SET_NOT_FOUND'
      );
    }

    if (setBalance.set_cost === null) {
      throw new AlignerValidationError(
        'Set cost must be defined before accepting payments',
        'SET_COST_NOT_DEFINED'
      );
    }

    // `Balance` is `set_cost - coalesce(sum(paid), 0)`, so it is NULL only when
    // set_cost is — already rejected above. The `?? 0` is the type-level narrowing
    // for that, not a real fallback (it would reject any payment, which is the safe
    // direction anyway). This used to be an `as SetBalanceInfo` cast that asserted
    // the column non-null instead of proving it.
    const balance = setBalance.Balance ?? 0;
    if (paymentAmount > balance) {
      throw new AlignerValidationError(
        `Payment amount (${paymentAmount}) exceeds remaining balance (${balance})`,
        'PAYMENT_EXCEEDS_BALANCE'
      );
    }
  }

  log.info(
    `Adding payment for work id: ${workid}, Set id: ${aligner_set_id || 'general'}, amount: ${amount_paid}`
  );

  try {
    const invoiceID = await alignerPaymentQueries.createAlignerPayment(paymentData);
    log.info(`Payment added successfully: Invoice ${invoiceID}`);
    return invoiceID;
  } catch (error) {
    log.error('Error adding payment:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
