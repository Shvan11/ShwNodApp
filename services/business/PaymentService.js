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
import * as database from '../database/index.js';
import {
    addInvoice,
    getExchangeRateForDate
} from '../database/queries/payment-queries.js';
import { getWorkDetails } from '../database/queries/work-queries.js';

/**
 * Validation error class for payment business logic
 */
export class PaymentValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'PaymentValidationError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Validate currency amounts
 * @param {number} usd - USD amount
 * @param {number} iqd - IQD amount
 * @throws {PaymentValidationError} If validation fails
 */
function validateCurrencyAmounts(usd, iqd) {
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
 * @param {string} accountCurrency - Work account currency (USD or IQD)
 * @param {number} usd - USD amount received
 * @param {number} iqd - IQD amount received
 * @returns {boolean} True if same-currency payment
 */
function isSameCurrencyPayment(accountCurrency, usd, iqd) {
    return (
        (accountCurrency === 'USD' && usd > 0 && iqd === 0) ||
        (accountCurrency === 'IQD' && iqd > 0 && usd === 0)
    );
}

/**
 * Validate change amount for cross-currency payments
 * @param {number} changeAmount - Change to give back
 * @param {number} usd - USD received
 * @param {number} iqd - IQD received
 * @param {number} exchangeRate - Current exchange rate
 * @throws {PaymentValidationError} If validation fails
 */
function validateChangeAmount(changeAmount, usd, iqd, exchangeRate) {
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
                    changeRequested: changeAmount
                }
            );
        }
    }
}

/**
 * Calculate and validate change for a payment
 * @param {Object} params
 * @param {string} params.accountCurrency - Work account currency
 * @param {number} params.usd - USD received
 * @param {number} params.iqd - IQD received
 * @param {number} params.change - Change amount
 * @param {string} params.paymentDate - Payment date
 * @returns {Promise<number|null>} Validated change amount (null for same-currency)
 */
async function calculateValidatedChange({ accountCurrency, usd, iqd, change, paymentDate }) {
    // For same-currency payments: Force change to NULL (cash handling not tracked)
    if (isSameCurrencyPayment(accountCurrency, usd, iqd)) {
        return null;
    }

    // Cross-currency or mixed payment - validate change
    const changeAmount = parseInt(change) || 0;

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
 * @param {Object} invoiceData
 * @param {number} invoiceData.workid - Work ID
 * @param {number} invoiceData.amountPaid - Amount credited to account
 * @param {string} invoiceData.paymentDate - Date of payment
 * @param {number} invoiceData.usdReceived - USD amount received
 * @param {number} invoiceData.iqdReceived - IQD amount received
 * @param {number} invoiceData.change - Change to give back
 * @returns {Promise<Object>} Created invoice record
 * @throws {PaymentValidationError} If validation fails
 */
export async function validateAndCreateInvoice(invoiceData) {
    const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

    // Parse and validate amounts
    const usd = parseInt(usdReceived) || 0;
    const iqd = parseInt(iqdReceived) || 0;

    // Validate currency amounts
    validateCurrencyAmounts(usd, iqd);

    // Get work details to determine account currency
    const workDetails = await getWorkDetails(workid);
    if (!workDetails) {
        throw new PaymentValidationError(
            'Work record not found',
            'WORK_NOT_FOUND'
        );
    }

    const accountCurrency = workDetails.Currency;

    // Calculate and validate change
    const changeToSave = await calculateValidatedChange({
        accountCurrency,
        usd,
        iqd,
        change,
        paymentDate
    });

    // Save invoice with validated data
    const result = await addInvoice({
        workid,
        amountPaid,
        paymentDate,
        usdReceived: usd,
        iqdReceived: iqd,
        change: changeToSave  // NULL for same-currency, validated number for cross-currency
    });

    log.info(`Invoice created successfully: Work ${workid}, Amount ${amountPaid}, Change: ${changeToSave}`);

    return result;
}

/**
 * Create aligner payment
 * @param {Object} paymentData
 * @param {number} paymentData.workid - Work ID
 * @param {number} paymentData.AlignerSetID - Aligner set ID (optional)
 * @param {number} paymentData.Amountpaid - Amount paid
 * @param {string} paymentData.Dateofpayment - Date of payment
 * @param {number} paymentData.ActualAmount - Actual amount (optional)
 * @param {string} paymentData.ActualCur - Actual currency (optional)
 * @param {number} paymentData.Change - Change amount (optional)
 * @returns {Promise<Object>} Created payment record with invoiceID
 */
export async function createAlignerPayment(paymentData) {
    const { workid, AlignerSetID, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change } = paymentData;

    log.info(`Creating aligner payment: Work ${workid}, Set ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`);

    // Insert payment into tblInvoice
    const query = `
        INSERT INTO tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change, AlignerSetID)
        VALUES (@workid, @Amountpaid, @Dateofpayment, @ActualAmount, @ActualCur, @Change, @AlignerSetID);
        SELECT SCOPE_IDENTITY() AS invoiceID;
    `;

    const result = await database.executeQuery(
        query,
        [
            ['workid', database.TYPES.Int, parseInt(workid)],
            ['Amountpaid', database.TYPES.Decimal, parseFloat(Amountpaid)],
            ['Dateofpayment', database.TYPES.Date, new Date(Dateofpayment)],
            ['ActualAmount', database.TYPES.Decimal, ActualAmount ? parseFloat(ActualAmount) : null],
            ['ActualCur', database.TYPES.NVarChar, ActualCur || null],
            ['Change', database.TYPES.Decimal, Change ? parseFloat(Change) : null],
            ['AlignerSetID', database.TYPES.Int, AlignerSetID || null]
        ],
        (columns) => ({
            invoiceID: columns[0].value
        })
    );

    const invoiceID = result && result.length > 0 ? result[0].invoiceID : null;

    log.info(`Aligner payment created successfully: Invoice ${invoiceID}`);

    return {
        success: true,
        invoiceID: invoiceID
    };
}

export default {
    validateAndCreateInvoice,
    createAlignerPayment,
    PaymentValidationError
};
