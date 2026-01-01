/**
 * Payment Service - Business Logic Layer
 *
 * This service handles all payment and invoice business logic including:
 * - Invoice validation and creation
 * - Currency validation and conversion
 * - Change calculation and validation
 * - Payment amount validation
 * - Exchange rate handling
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import {
  addInvoice,
  getExchangeRateForDate,
} from '../database/queries/payment-queries.js';
import { getWorkDetails } from '../database/queries/work-queries.js';
import type { Invoice, WorkWithDetails } from '../../types/database.types.js';

/**
 * Payment error codes
 */
export type PaymentErrorCode =
  | 'NO_CASH_RECEIVED'
  | 'NEGATIVE_AMOUNT'
  | 'NEGATIVE_CHANGE'
  | 'CHANGE_EXCEEDS_IQD_RECEIVED'
  | 'CHANGE_EXCEEDS_TOTAL_VALUE'
  | 'WORK_NOT_FOUND';

/**
 * Currency type
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
 * Change calculation parameters
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
      'Currency amounts cannot be negative',
      'NEGATIVE_AMOUNT'
    );
  }
}

/**
 * Determine if payment is same-currency (no change tracking needed)
 * @param accountCurrency - Work account currency (USD or IQD)
 * @param usd - USD amount received
 * @param iqd - IQD amount received
 * @returns True if same-currency payment
 */
function isSameCurrencyPayment(
  accountCurrency: CurrencyType | string,
  usd: number,
  iqd: number
): boolean {
  return (
    (accountCurrency === 'USD' && usd > 0 && iqd === 0) ||
    (accountCurrency === 'IQD' && iqd > 0 && usd === 0)
  );
}

/**
 * Validate change amount for cross-currency payments
 * @param changeAmount - Change to give back
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
      'Change amount cannot be negative',
      'NEGATIVE_CHANGE'
    );
  }

  if (changeAmount === 0) {
    return; // No change, no validation needed
  }

  // Validation 3: Change cannot exceed IQD received (simple case)
  if (usd === 0 && changeAmount > iqd) {
    throw new PaymentValidationError(
      `Change (${changeAmount} IQD) cannot exceed IQD received (${iqd} IQD)`,
      'CHANGE_EXCEEDS_IQD_RECEIVED'
    );
  }

  // Validation 4: For USD payments, validate against total IQD value
  if (usd > 0 && exchangeRate) {
    const totalIQDValue = iqd + Math.floor(usd * exchangeRate);

    if (changeAmount > totalIQDValue) {
      throw new PaymentValidationError(
        `Change (${changeAmount} IQD) cannot exceed total IQD value in transaction (${totalIQDValue} IQD at rate ${exchangeRate})`,
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
 * @param params - Change calculation parameters
 * @returns Validated change amount (null for same-currency)
 */
async function calculateValidatedChange(
  params: ChangeCalculationParams
): Promise<number | null> {
  const { accountCurrency, usd, iqd, change, paymentDate } = params;

  // For same-currency payments: Force change to NULL (cash handling not tracked)
  if (isSameCurrencyPayment(accountCurrency, usd, iqd)) {
    return null;
  }

  // Cross-currency or mixed payment - validate change
  const changeAmount = parseInt(String(change)) || 0;

  if (changeAmount > 0) {
    // Get exchange rate for validation
    const exchangeRate = await getExchangeRateForDate(paymentDate);
    validateChangeAmount(changeAmount, usd, iqd, exchangeRate);
  }

  return changeAmount;
}

/**
 * Validate and create a new invoice with comprehensive validation
 *
 * Validation Rules:
 * 1. At least one currency amount (USD or IQD) must be > 0
 * 2. Currency amounts cannot be negative
 * 3. For same-currency payments: change is set to NULL (not tracked)
 * 4. For cross-currency payments: change is validated and saved
 * 5. Change cannot exceed IQD received (simple case)
 * 6. For USD payments: change validated against total IQD value at exchange rate
 *
 * @param invoiceData - Invoice data to validate and create
 * @returns Created invoice record
 * @throws PaymentValidationError If validation fails
 */
export async function validateAndCreateInvoice(
  invoiceData: InvoiceCreateData
): Promise<Invoice> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } =
    invoiceData;

  // Parse and validate amounts
  const usd = parseInt(String(usdReceived)) || 0;
  const iqd = parseInt(String(iqdReceived)) || 0;

  // Validate currency amounts
  validateCurrencyAmounts(usd, iqd);

  // Get work details to determine account currency
  const workDetails = (await getWorkDetails(workid)) as WorkWithDetails | null;
  if (!workDetails) {
    throw new PaymentValidationError('Work record not found', 'WORK_NOT_FOUND');
  }

  const accountCurrency = workDetails.Currency || 'USD';

  // Calculate and validate change
  const changeToSave = await calculateValidatedChange({
    accountCurrency,
    usd,
    iqd,
    change,
    paymentDate,
  });

  // Save invoice with validated data
  const result = await addInvoice({
    workid,
    amountPaid,
    paymentDate,
    usdReceived: usd,
    iqdReceived: iqd,
    change: changeToSave, // NULL for same-currency, validated number for cross-currency
  });

  log.info(
    `Invoice created successfully: Work ${workid}, Amount ${amountPaid}, Change: ${changeToSave}`
  );

  // Construct the Invoice object from input data plus returned ID
  const invoice: Invoice = {
    InvoiceID: result[0]?.invoiceID,
    workid,
    Amountpaid: amountPaid,
    Dateofpayment: new Date(paymentDate),
    USDReceived: usd || null,
    IQDReceived: iqd || null,
    Change: changeToSave,
  };

  return invoice;
}

export default {
  validateAndCreateInvoice,
  PaymentValidationError,
};
