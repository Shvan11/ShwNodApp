/**
 * SIMPLE Date-based Authorization Middleware
 *
 * Rule: Secretary can only edit/delete records created TODAY
 * Admin bypasses all restrictions
 *
 * KISS Principle: No complex calculations, no logging, no notifications
 */

import type { Request, Response, NextFunction } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { log } from '../utils/logger.js';
import { ErrorResponses } from '../utils/error-response.js';
import type { ApiErrorResponse } from './types.js';

/**
 * Resource types that can be protected
 */
export type ResourceType = 'patient' | 'work' | 'invoice' | 'expense';

/**
 * Operation types that can be restricted
 */
export type OperationType = 'delete' | 'update';

/**
 * Function type for getting record creation date
 */
// All four helpers below now read a real insert stamp — `timestamp` columns
// (date_added, addition_date, expenses.created_at), or a `timestamptz` expression for
// invoices — every one of which the pg driver resolves to a `Date`. The `string` arm
// stays because `isToday` normalizes either via `new Date(...)`, so a future helper
// reading a `date` column ('YYYY-MM-DD' string) needs no signature change.
export type GetRecordDateFn = (req: Request) => Promise<Date | string>;

/**
 * Options for requireRecordAge middleware
 */
export interface RecordAgeOptions {
  resourceType: ResourceType;
  operation: OperationType;
  getRecordDate: GetRecordDateFn;
  restrictedFields?: string[];
  /**
   * When set, called instead of returning 403 for a non-admin on a restricted
   * (old-record delete, or old-record update of restricted fields). The callback
   * enqueues the approval hold and sends the pending-outcome response itself —
   * each route has its own `withPendingOutcome` contract shape, so the response
   * responsibility stays with the caller.
   */
  enqueueIfRestricted?: (req: Request, res: Response) => Promise<void>;
}

/**
 * Record date result from database
 */
interface RecordDateResult {
  createdAt: Date | string;
}

/**
 * Check if date is today (timezone-safe)
 * @param date - The date to check
 * @returns True if date is today in local timezone
 */
export function isToday(date: Date | string): boolean {
  const today = new Date();
  const recordDate = new Date(date);

  // toDateString() returns "Thu Nov 28 2025" - compares date only, ignores time
  // Works correctly with useUTC: false configuration
  return today.toDateString() === recordDate.toDateString();
}

/**
 * Middleware factory - returns configured middleware
 * @param options - Configuration options
 * @returns Express middleware function
 */
export function requireRecordAge(options: RecordAgeOptions) {
  const {
    resourceType,
    operation,
    getRecordDate,
    restrictedFields = [],
    enqueueIfRestricted,
  } = options;

  return async (
    req: Request,
    res: Response<ApiErrorResponse>,
    next: NextFunction
  ): Promise<void | Response<ApiErrorResponse>> => {
    try {
      // Admin bypasses all restrictions (check session.userRole, NOT session.user.role)
      if (req.session?.userRole === 'admin') {
        return next();
      }

      // Secretary: check if record was created today
      const recordDate = await getRecordDate(req);

      if (!isToday(recordDate)) {
        // Record is old (not created today)
        if (operation === 'delete') {
          if (enqueueIfRestricted) {
            await enqueueIfRestricted(req, res);
            return;
          }
          return ErrorResponses.forbidden(
            res,
            `Cannot delete ${resourceType} not created today. Contact admin.`
          );
        }

        if (operation === 'update' && restrictedFields.length > 0) {
          // Check if trying to update restricted fields
          const updatingRestrictedField = restrictedFields.some(
            field => Object.prototype.hasOwnProperty.call(req.body, field)
          );

          if (updatingRestrictedField) {
            if (enqueueIfRestricted) {
              await enqueueIfRestricted(req, res);
              return;
            }
            return ErrorResponses.forbidden(
              res,
              `Cannot edit money-related fields for ${resourceType} not created today. Contact admin.`,
              { restrictedFields }
            );
          }
        }
      }

      // Record created today - allow operation
      next();
    } catch (error) {
      // Detail is logged, never returned — the raw error message could leak
      // internal state (the central error-handler follows the same posture).
      log.error('Date-based auth error:', error);
      ErrorResponses.internalError(res, 'Authorization check failed');
    }
  };
}

/**
 * Helper Functions to Get Record Creation Dates
 */

/**
 * Get patient creation date
 * @param req - Express request object
 * @returns Patient creation date
 */
export async function getPatientCreationDate(req: Request): Promise<Date | string> {
  const { personId } = req.params;

  const { rows: result } = await sql<RecordDateResult>`
    SELECT "date_added" AS "createdAt" FROM "patients" WHERE "person_id" = ${parseInt(String(personId), 10)}
  `.execute(getKysely());

  if (!result || result.length === 0) {
    throw new Error('Patient not found');
  }

  return result[0].createdAt;
}

/**
 * Request body with work ID
 */
interface WorkRequestBody {
  workId?: number | string;
  workid?: number | string;
}

/**
 * Get work creation date
 * @param req - Express request object
 * @returns Work creation date
 */
export async function getWorkCreationDate(req: Request): Promise<Date | string> {
  // workId can come from body (delete, update) or params
  const body = req.body as WorkRequestBody | undefined;
  const workId = body?.workId || body?.workid || req.params?.workId;

  if (!workId) {
    throw new Error('Work ID not provided');
  }

  const { rows: result } = await sql<RecordDateResult>`
    SELECT "addition_date" AS "createdAt" FROM "works" WHERE "work_id" = ${parseInt(String(workId), 10)}
  `.execute(getKysely());

  if (!result || result.length === 0) {
    throw new Error('Work not found');
  }

  return result[0].createdAt;
}

/**
 * Get invoice creation date
 * @param req - Express request object
 * @returns Invoice creation date
 */
export async function getInvoiceCreationDate(req: Request): Promise<Date | string> {
  const { invoiceId } = req.params;

  // `sys_start_time`, NOT `date_of_payment`. This value is the age guard's only
  // input, and `date_of_payment` is typed by the user on the payment form — so
  // reading it let anyone re-date an old invoice into today's window and edit or
  // delete it without an approval. `sys_start_time` is defaulted, i.e. the row's
  // real insert time, which is what "created today" was always meant to mean.
  //
  // `AT TIME ZONE 'UTC'` because this one column is stored in UTC wall-clock
  // (`DEFAULT now() AT TIME ZONE 'UTC'`), unlike every other creation stamp in the
  // schema (`LOCALTIMESTAMP`). Read raw, it arrives 3h behind Baghdad, so an invoice
  // taken between 00:00 and 03:00 read as YESTERDAY's and the person who had just
  // entered it could not correct it. The clause re-attaches the offset, yielding a
  // `timestamptz` the driver resolves to the correct instant for `isToday`.
  const { rows: result } = await sql<RecordDateResult>`
    SELECT "sys_start_time" AT TIME ZONE 'UTC' AS "createdAt" FROM "invoices" WHERE "invoice_id" = ${parseInt(String(invoiceId), 10)}
  `.execute(getKysely());

  if (!result || result.length === 0) {
    throw new Error('Invoice not found');
  }

  return result[0].createdAt;
}

/**
 * Get expense creation date
 * @param req - Express request object
 * @returns Expense creation date
 */
export async function getExpenseCreationDate(req: Request): Promise<Date | string> {
  const { id } = req.params;

  // `created_at`, NOT `expense_date` — same reasoning as the invoice guard above:
  // `expense_date` is typed into the expense form, so reading it let the record
  // certify its own age in both directions. The column was added for exactly this
  // (migrations/pg/1788812700000_expenses-created-at.sql) and is `LOCALTIMESTAMP`,
  // so unlike `invoices.sys_start_time` it needs no timezone conversion.
  const { rows: result } = await sql<RecordDateResult>`
    SELECT "created_at" AS "createdAt" FROM "expenses" WHERE "id" = ${parseInt(String(id), 10)}
  `.execute(getKysely());

  if (!result || result.length === 0) {
    throw new Error('Expense not found');
  }

  return result[0].createdAt;
}
