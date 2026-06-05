/**
 * API contract — payment endpoints.
 *
 * Single source of truth for each payment endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`.
 * See docs/shared-contract-progress.md + the plan.
 *
 * Phase 1 (the reference conversion): request bodies are **fully enumerated** →
 * `z.infer` is the body SSoT (the route's hand-written `XxxBody` interfaces are
 * deleted). Bodies default to `z.looseObject` so a field missed during
 * enumeration fails safe (passes through) rather than being stripped on
 * `validate()`'s write-back. Responses assert the container + the stable
 * identifiers the consumer reads; long-tail fields stay loose.
 */
import { z } from 'zod';
import { intId, dateString, idParams } from '../validation.js';

// ---------------------------------------------------------------------------
// GET /api/getpaymenthistory?workId= — bare array of invoice rows.
// services/database/queries/payment-queries.ts#getPaymentHistoryByWorkId
//
// WorkComponent's payment-history table reads InvoiceID, amount_paid,
// date_of_payment, actual_amount, actual_cur, change → model those (the row's
// always-present columns; actual_*/change are nullable). Long tail stays loose.
// ---------------------------------------------------------------------------

const paymentHistoryRow = z.looseObject({
  InvoiceID: z.number(),
  amount_paid: z.number(),
  date_of_payment: z.string(),
  actual_amount: z.number().nullable(),
  actual_cur: z.string().nullable(),
  change: z.number().nullable(),
});

export const paymentHistory = {
  response: z.array(paymentHistoryRow),
} as const;
export type PaymentHistoryResponse = z.infer<typeof paymentHistory.response>;

// ---------------------------------------------------------------------------
// GET /api/getworkforreceipt/:workId — single work row (inline SQL in the route).
// Consumer (PaymentModal) keeps its richer local `WorkData` type; the contract
// is the runtime boundary guard, so model only the stable id + stay loose.
// ---------------------------------------------------------------------------

export const workForReceipt = {
  response: z.looseObject({ work_id: z.number() }),
} as const;
export type WorkForReceiptResponse = z.infer<typeof workForReceipt.response>;

// ---------------------------------------------------------------------------
// GET /api/getActiveWorkForInvoice?PID= — array of active works.
// services/database/queries/payment-queries.ts#getActiveWorkForInvoice
// (No frontend consumer today; the contract pins the backend payload.)
// ---------------------------------------------------------------------------

export const activeWorkForInvoice = {
  response: z.array(z.looseObject({ work_id: z.number() })),
} as const;
export type ActiveWorkForInvoiceResponse = z.infer<typeof activeWorkForInvoice.response>;

// ---------------------------------------------------------------------------
// GET /api/getCurrentExchangeRate — { exchangeRate } (closed container).
// ---------------------------------------------------------------------------

export const currentExchangeRate = {
  response: z.object({ exchangeRate: z.number() }),
} as const;
export type CurrentExchangeRateResponse = z.infer<typeof currentExchangeRate.response>;

// ---------------------------------------------------------------------------
// GET /api/getExchangeRateForDate?date= — { exchangeRate, date } (closed).
// `date` is the request date echoed back (already used to find the rate) → a
// plain string, not the stricter `dateString` (avoid a dev-parse false-positive).
// ---------------------------------------------------------------------------

export const exchangeRateForDate = {
  response: z.object({ exchangeRate: z.number(), date: z.string() }),
} as const;
export type ExchangeRateForDateResponse = z.infer<typeof exchangeRateForDate.response>;

// ---------------------------------------------------------------------------
// GET /api/exchange-rates?from=&to= — { rates: { date, exchangeRate }[] }.
// services/database/queries/payment-queries.ts#listExchangeRates (closed rows).
// ---------------------------------------------------------------------------

export const exchangeRates = {
  response: z.object({
    rates: z.array(z.object({ date: z.string(), exchangeRate: z.number() })),
  }),
} as const;
export type ExchangeRatesResponse = z.infer<typeof exchangeRates.response>;

// ---------------------------------------------------------------------------
// POST /api/updateExchangeRateForDate — upsert one day's rate.
// Body fully enumerated: { date, exchangeRate }. Handler forwards both to
// updateExchangeRateForDate(date, exchangeRate); both required. `.positive()`
// keeps the existing reject-≤0 rule. Response echoes the (empty) upsert result.
// ---------------------------------------------------------------------------

export const updateExchangeRate = {
  body: z.looseObject({
    date: dateString,
    exchangeRate: z.coerce.number().positive(),
  }),
  response: z.object({
    result: z.array(z.unknown()),
    date: z.string(),
    exchangeRate: z.number(),
  }),
} as const;
export type UpdateExchangeRateBody = z.infer<typeof updateExchangeRate.body>;
export type UpdateExchangeRateResponse = z.infer<typeof updateExchangeRate.response>;

// ---------------------------------------------------------------------------
// POST /api/addInvoice — create an invoice (delegates to PaymentService).
//
// Body fully enumerated (3-place trace: handler destructure → PaymentService
// InvoiceCreateData → addInvoice() column writes):
//  - workid / amountPaid / paymentDate — required (handler 400s if missing).
//  - usdReceived / iqdReceived / change — OPTIONAL: the handler defaults each
//    with `?? 0`, so callers legitimately omit them. The client may send
//    `change: null` (same-currency); `z.coerce.number()` maps null→0, which the
//    handler's `change ?? 0` would have produced anyway (identical persisted row).
// looseObject so any un-traced field still passes through to the service.
//
// Response: the service returns a freshly-built CreatedInvoice (date_of_payment
// is a JS Date → serialized to a string for the client), so model only the
// stable id and keep the rest loose.
// ---------------------------------------------------------------------------

export const addInvoice = {
  body: z.looseObject({
    workid: intId,
    amountPaid: z.coerce.number(),
    paymentDate: dateString,
    usdReceived: z.coerce.number().optional(),
    iqdReceived: z.coerce.number().optional(),
    change: z.coerce.number().optional(),
  }),
  response: z.looseObject({ InvoiceID: z.number().optional() }),
} as const;
export type AddInvoiceBody = z.infer<typeof addInvoice.body>;
export type AddInvoiceResponse = z.infer<typeof addInvoice.response>;

// ---------------------------------------------------------------------------
// DELETE /api/deleteInvoice/:invoiceId — { rowsAffected }.
// ---------------------------------------------------------------------------

export const deleteInvoice = {
  params: idParams('invoiceId'),
  response: z.object({ rowsAffected: z.number() }),
} as const;
export type DeleteInvoiceResponse = z.infer<typeof deleteInvoice.response>;

// Shared GET query for the payment read endpoints. Type-only (handlers parse manually).
export const paymentQuery = z.object({
  code: z.string().optional(),
  workId: z.string().optional(),
  date: z.string().optional(),
  PID: z.string().optional(),
});
export type PaymentQueryParams = z.infer<typeof paymentQuery>;
