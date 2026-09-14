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
import {
  dateString,
  idParams,
  intId,
  moneyInt,
  numericParam,
  optionalDateString,
} from '../validation.js';
import { withPendingOutcome } from './approvals.contract.js';

// ---------------------------------------------------------------------------
// GET /api/getpaymenthistory?workId= — bare array of invoice rows.
// services/database/queries/payment-queries.ts#getPaymentHistoryByWorkId
//
// WorkComponent's payment-history table reads InvoiceID, amount_paid,
// date_of_payment, change → model those (the row's always-present columns; `change`
// is nullable). Long tail stays loose.
//
// The retired `actual_amount`/`actual_cur` pair is gone from the table entirely as of
// migration 1783000000000: no write path had populated it since the dual-currency
// rewrite (the cash split lives in usd_received/iqd_received), so the two columns it
// fed here showed "-" for every payment staff could create, and the stale `actual_cur`
// was mislabelling the Change column's currency. The 2,134 legacy rows were dumped to
// C:\DBBackup\invoices-actual-columns-2026-07-30.restore.sql first.
// ---------------------------------------------------------------------------

const paymentHistoryRow = z.looseObject({
  InvoiceID: z.number(),
  amount_paid: z.number(),
  date_of_payment: z.string(),
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
// GET /api/getCurrentExchangeRate — { exchangeRate } (closed container).
// ---------------------------------------------------------------------------

export const currentExchangeRate = {
  response: z.object({ exchangeRate: z.number() }),
} as const;
export type CurrentExchangeRateResponse = z.infer<typeof currentExchangeRate.response>;

// ---------------------------------------------------------------------------
// GET /api/getExchangeRateForDate?date= — the rate IN FORCE on `date` (closed).
// `date` is the request date echoed back (already used to find the rate) → a
// plain string, not the stricter `dateString` (avoid a dev-parse false-positive).
//
// The rate is CARRIED FORWARD: if nobody entered one for `date`, the most recent
// earlier rate is returned with `rateDate` naming the day it was recorded and
// `isCarriedForward: true` (the real-world rate doesn't reset overnight, and a
// 404 here used to block every payment until someone typed a rate in). A 404 now
// means `sms` holds no rate at all.
// ---------------------------------------------------------------------------

export const exchangeRateForDate = {
  response: z.object({
    exchangeRate: z.number(),
    date: z.string(),
    rateDate: z.string(),
    isCarriedForward: z.boolean(),
  }),
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
    // `sms.exchange_rate` is an `integer` column (IQD per USD — always a whole
    // number of dinars in practice).
    exchangeRate: moneyInt.positive(),
  }),
  response: z.object({
    // Intentionally loose: raw Kysely UpdateResult[] — structure is DB-driver-specific.
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

// All four money fields go through `moneyInt`: the invoices columns are PG
// `integer` (amount_paid/usd_received/iqd_received/change), and PaymentService
// parses the three cash fields with parseInt. Accepting a plain number meant a
// fractional input was silently TRUNCATED on the cash legs but ROUNDED by PG on
// amountPaid — two different answers for the same request. Reject it at the
// boundary instead.
//
// `moneyInt` also carries the non-negative floor, which this endpoint had nowhere:
// neither PaymentService's pre-check nor the locked re-check in
// `addInvoiceWithBalanceGuard` tests a LOWER bound (both ask only
// `amount > remaining`), so `amountPaid: -100000` was accepted and stored, which
// RAISES the work's outstanding balance and corrupts every sum over
// `invoices.amount_paid`. `amountPaid` is `.positive()` on top — 0 is not a
// payment, and `PaymentModal`'s own `if (!amountPaid)` already refuses it.
// `change` needs the floor too: `calculateValidatedChange` validates only when
// `changeAmount > 0`, so a negative slid through unchecked into the column.
// The cash legs were already service-guarded (`validateCurrencyAmounts` throws
// NEGATIVE_AMOUNT); stating it here makes the boundary agree and turns it into a
// field-level 400. The service guard stays — it still covers non-HTTP callers.
export const addInvoice = {
  body: z.looseObject({
    workid: intId,
    amountPaid: moneyInt.positive('Payment amount must be greater than zero'),
    paymentDate: dateString,
    usdReceived: moneyInt.optional(),
    iqdReceived: moneyInt.optional(),
    change: moneyInt.optional(),
  }),
  response: z.looseObject({ InvoiceID: z.number().optional() }),
} as const;
export type AddInvoiceBody = z.infer<typeof addInvoice.body>;
export type AddInvoiceResponse = z.infer<typeof addInvoice.response>;

// ---------------------------------------------------------------------------
// DELETE /api/deleteInvoice/:invoiceId — { rowsAffected }.
// ---------------------------------------------------------------------------

// A Front-Desk delete of an invoice not created today routes through admin
// approval instead of applying immediately — see `services/approvals/`.
export const deleteInvoice = {
  params: idParams('invoiceId'),
  response: withPendingOutcome({ rowsAffected: z.number() }),
} as const;
export type DeleteInvoiceResponse = z.infer<typeof deleteInvoice.response>;

// Shared GET query for the payment read endpoints. Type-only (handlers parse manually).
// Only the params a handler actually destructures: `workId` (getpaymenthistory) and
// `date` (getExchangeRateForDate).
// VALIDATED on `/getpaymenthistory` (it was type-only): the handler `parseInt`s
// `workId` straight into the query, so a junk id was a PG 22P02 → 500, not a 400.
// `numericParam` keeps it a STRING so the existing parseInt is unchanged.
export const paymentQuery = z.object({
  workId: numericParam.optional(),
  date: optionalDateString,
});

/** `:workId` route param for `/getworkforreceipt/:workId`. */
export const workIdParams = idParams('workId');
export type WorkIdParams = z.infer<typeof workIdParams>;
export type PaymentQueryParams = z.infer<typeof paymentQuery>;
