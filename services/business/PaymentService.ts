/**
 * Payment Service - Business Logic Layer
 *
 * This service handles all payment and invoice business logic including:
 * - Invoice validation and creation
 * - currency validation and conversion
 * - change calculation and validation
 * - Payment amount validation
 * - Exchange rate handling
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import {
  addInvoiceWithBalanceGuard,
  getExchangeRateAsOf,
} from '../database/queries/payment-queries.js';
import { getWorkDetails } from '../database/queries/work-queries.js';

/**
 * The invoice record returned to callers after creation. This is a freshly
 * constructed response object (not a DB row read-back): `date_of_payment` is a
 * real JS `Date` built from the request, and `InvoiceID` is the id returned by
 * the insert. Co-located here because it's a service-layer DTO.
 */
// `type` (not `interface`) so it carries an implicit string index signature and
// is assignable to the `z.looseObject` addInvoice response contract that
// `sendData` validates against (see shared-contract-progress.md, Phase 1 finding).
type CreatedInvoice = {
  InvoiceID: number | undefined;
  workid: number;
  amount_paid: number;
  date_of_payment: Date;
  usd_received: number | null;
  iqd_received: number | null;
  change: number | null;
};

/**
 * Payment error codes
 */
export type PaymentErrorCode =
  | 'NO_CASH_RECEIVED'
  | 'NEGATIVE_AMOUNT'
  | 'NEGATIVE_CHANGE'
  | 'CHANGE_EXCEEDS_IQD_RECEIVED'
  | 'CHANGE_EXCEEDS_TOTAL_VALUE'
  | 'WORK_NOT_FOUND'
  | 'PAYMENT_EXCEEDS_REMAINING';

/**
 * currency type
 */
export type CurrencyType = 'USD' | 'IQD';

/**
 * Error details for payment validation
 */
export interface PaymentErrorDetails {
  usdReceived?: number;
  iqdReceived?: number;
  exchangeRate?: number;
  totalIQDValue?: number;
  changeRequested?: number;
  workId?: number;
  amountPaid?: number;
  totalRequired?: number;
  discount?: number;
  totalPaid?: number;
  remaining?: number;
}

/**
 * Validation error class for payment business logic
 */
export class PaymentValidationError extends Error {
  public readonly code: PaymentErrorCode;
  public readonly details: PaymentErrorDetails;

  constructor(
    message: string,
    code: PaymentErrorCode,
    details: PaymentErrorDetails = {}
  ) {
    super(message);
    this.name = 'PaymentValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Invoice creation data
 */
export interface InvoiceCreateData {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived: number | string;
  iqdReceived: number | string;
  change: number | string;
}

/**
 * change calculation parameters
 */
interface ChangeCalculationParams {
  accountCurrency: CurrencyType | string;
  usd: number;
  iqd: number;
  change: number | string;
  paymentDate: string;
}

/**
 * Validate currency amounts
 * @param usd - USD amount
 * @param iqd - IQD amount
 * @throws PaymentValidationError If validation fails
 */
function validateCurrencyAmounts(usd: number, iqd: number): void {
  // Validation 1: Must receive cash in at least one currency
  if (usd === 0 && iqd === 0) {
    throw new PaymentValidationError(
      'At least one currency amount (USD or IQD) must be greater than zero',
      'NO_CASH_RECEIVED'
    );
  }

  // Validation 2: Non-negative amounts
  if (usd < 0 || iqd < 0) {
    throw new PaymentValidationError(
      'currency amounts cannot be negative',
      'NEGATIVE_AMOUNT'
    );
  }
}

/**
 * Determine if payment is same-currency (change stored as NULL when there is none)
 *
 * Only IQD account + IQD payment = same-currency
 * USD account + USD payment DOES track change (converted to IQD)
 * because clinic uses $50/$100 bills and gives change in IQD
 *
 * @param accountCurrency - Work account currency (USD or IQD)
 * @param usd - USD amount received
 * @param iqd - IQD amount received
 * @returns True if same-currency payment (only IQD-to-IQD)
 */
function isSameCurrencyPayment(
  accountCurrency: CurrencyType | string,
  usd: number,
  iqd: number
): boolean {
  return accountCurrency === 'IQD' && iqd > 0 && usd === 0;
}

/**
 * Validate change amount for cross-currency payments
 * @param changeAmount - change to give back
 * @param usd - USD received
 * @param iqd - IQD received
 * @param exchangeRate - Current exchange rate
 * @throws PaymentValidationError If validation fails
 */
function validateChangeAmount(
  changeAmount: number,
  usd: number,
  iqd: number,
  exchangeRate: number | null
): void {
  if (changeAmount < 0) {
    throw new PaymentValidationError(
      'change amount cannot be negative',
      'NEGATIVE_CHANGE'
    );
  }

  if (changeAmount === 0) {
    return; // No change, no validation needed
  }

  // Validation 3: change cannot exceed IQD received (simple case)
  if (usd === 0 && changeAmount > iqd) {
    throw new PaymentValidationError(
      `change (${changeAmount} IQD) cannot exceed IQD received (${iqd} IQD)`,
      'CHANGE_EXCEEDS_IQD_RECEIVED'
    );
  }

  // Validation 4: For USD payments, validate against total IQD value
  if (usd > 0 && exchangeRate) {
    const totalIQDValue = iqd + Math.floor(usd * exchangeRate);

    if (changeAmount > totalIQDValue) {
      throw new PaymentValidationError(
        `change (${changeAmount} IQD) cannot exceed total IQD value in transaction (${totalIQDValue} IQD at rate ${exchangeRate})`,
        'CHANGE_EXCEEDS_TOTAL_VALUE',
        {
          usdReceived: usd,
          iqdReceived: iqd,
          exchangeRate: exchangeRate,
          totalIQDValue: totalIQDValue,
          changeRequested: changeAmount,
        }
      );
    }
  }
}

/**
 * Calculate and validate change for a payment
 * @param params - change calculation parameters
 * @returns Validated change amount (null for same-currency)
 */
async function calculateValidatedChange(
  params: ChangeCalculationParams
): Promise<number | null> {
  const { accountCurrency, usd, iqd, change, paymentDate } = params;

  const changeAmount = parseInt(String(change)) || 0;

  // Same-currency (IQD→IQD) payments store NULL rather than 0: nothing was handed
  // back and the column means "not tracked".
  //
  // A POSITIVE change is honoured even here. This used to be an unconditional early
  // return, which re-derived "same currency ⇒ no change" from the cash amounts and so
  // discarded REAL change on a mixed payment settled in IQD only — a case where the
  // client shows the field, auto-calculates it and reports it on the receipt. The money
  // left the drawer either way, so dropping it left ExpectedCashIQD overstated.
  if (changeAmount === 0 && isSameCurrencyPayment(accountCurrency, usd, iqd)) {
    return null;
  }

  if (changeAmount > 0) {
    // As-of, not exact-date: a payment dated on a day nobody entered a rate for must
    // not silently skip validateChangeAmount's cross-currency ceiling check.
    const rate = await getExchangeRateAsOf(paymentDate);
    validateChangeAmount(changeAmount, usd, iqd, rate?.exchangeRate ?? null);
  }

  return changeAmount;
}

/**
 * Validate and create a new invoice with comprehensive validation
 *
 * Validation Rules:
 * 1. At least one currency amount (USD or IQD) must be > 0
 * 2. currency amounts cannot be negative
 * 3. For same-currency payments with no change: change is set to NULL (not tracked)
 * 4. Any change actually handed back is validated and saved, same- or cross-currency
 * 5. change cannot exceed IQD received (simple case)
 * 6. For USD payments: change validated against total IQD value at exchange rate
 *
 * @param invoiceData - Invoice data to validate and create
 * @returns Created invoice record
 * @throws PaymentValidationError If validation fails
 */
export async function validateAndCreateInvoice(
  invoiceData: InvoiceCreateData
): Promise<CreatedInvoice> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } =
    invoiceData;

  // Parse and validate amounts
  const usd = parseInt(String(usdReceived)) || 0;
  const iqd = parseInt(String(iqdReceived)) || 0;

  // Validate currency amounts
  validateCurrencyAmounts(usd, iqd);

  // Get work details to determine account currency
  const workDetails = await getWorkDetails(workid);
  if (!workDetails) {
    throw new PaymentValidationError('Work record not found', 'WORK_NOT_FOUND');
  }

  const accountCurrency = workDetails.currency || 'USD';

  // Block overpayment: amountPaid must not exceed remaining balance
  // Remaining = total_required - discount - TotalPaid
  //
  // This is a FAST FAIL on an unlocked read — it reports the fuller message before the
  // change-validation round trips run. It is NOT the guarantee: two payments registered
  // against the same work concurrently would both read this pre-insert balance and both
  // pass. The authoritative re-check runs under a row lock inside
  // addInvoiceWithBalanceGuard below, in the same transaction as the insert.
  const totalRequired = Number(workDetails.total_required ?? 0);
  const discount = Number(workDetails.discount ?? 0);
  const totalPaid = Number(workDetails.TotalPaid ?? 0);
  const remaining = totalRequired - discount - totalPaid;
  const requestedAmount = Number(amountPaid) || 0;

  if (requestedAmount > remaining) {
    throw new PaymentValidationError(
      `Payment (${requestedAmount}) exceeds remaining balance (${remaining}). Total ${totalRequired}, discount ${discount}, already paid ${totalPaid}.`,
      'PAYMENT_EXCEEDS_REMAINING',
      { workId: workid, amountPaid: requestedAmount, totalRequired, discount, totalPaid, remaining }
    );
  }

  // Calculate and validate change
  const changeToSave = await calculateValidatedChange({
    accountCurrency,
    usd,
    iqd,
    change,
    paymentDate,
  });

  // Save invoice with validated data — the balance is re-read under a row lock on the
  // work and re-checked inside the insert's own transaction, so a concurrent payment
  // that slipped past the pre-check above is rejected here rather than overpaying.
  const result = await addInvoiceWithBalanceGuard({
    workid,
    amountPaid,
    paymentDate,
    usdReceived: usd,
    iqdReceived: iqd,
    change: changeToSave, // NULL for same-currency, validated number for cross-currency
  });

  if (result.outcome === 'work_not_found') {
    // The work was deleted between the read above and the insert.
    throw new PaymentValidationError('Work record not found', 'WORK_NOT_FOUND');
  }

  if (result.outcome === 'exceeds_remaining') {
    const b = result.balance;
    throw new PaymentValidationError(
      `Payment (${requestedAmount}) exceeds remaining balance (${b.remaining}). Total ${b.totalRequired}, discount ${b.discount}, already paid ${b.totalPaid}.`,
      'PAYMENT_EXCEEDS_REMAINING',
      {
        workId: workid,
        amountPaid: requestedAmount,
        totalRequired: b.totalRequired,
        discount: b.discount,
        totalPaid: b.totalPaid,
        remaining: b.remaining,
      }
    );
  }

  log.info(
    `Invoice created successfully: Work ${workid}, amount ${amountPaid}, change: ${changeToSave}`
  );

  // Construct the Invoice object from input data plus returned id
  const invoice: CreatedInvoice = {
    InvoiceID: result.invoice_id,
    workid,
    amount_paid: amountPaid,
    date_of_payment: new Date(paymentDate),
    usd_received: usd || null,
    iqd_received: iqd || null,
    change: changeToSave,
  };

  return invoice;
}

export default {
  validateAndCreateInvoice,
  PaymentValidationError,
};
