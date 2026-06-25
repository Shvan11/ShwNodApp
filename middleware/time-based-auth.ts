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
import type { ApiErrorResponse } from '../types/index.js';

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
// `date` columns (date_of_payment, expense_date) resolve to 'YYYY-MM-DD' strings at
// runtime; `timestamp` columns (date_added, addition_date) resolve to Date. `isToday`
// normalizes both via `new Date(...)`, so the fn type is the honest union.
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
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: `Cannot delete ${resourceType} not created today. Contact admin.`
          });
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
            return res.status(403).json({
              success: false,
              error: 'Forbidden',
              message: `Cannot edit money-related fields for ${resourceType} not created today. Contact admin.`,
              details: { restrictedFields }
            });
          }
        }
      }

      // Record created today - allow operation
      next();
    } catch (error) {
      log.error('Date-based auth error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
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
    SELECT "date_added" AS "createdAt" FROM "patients" WHERE "person_id" = ${personId}
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
    SELECT "addition_date" AS "createdAt" FROM "works" WHERE "work_id" = ${parseInt(String(workId))}
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

  const { rows: result } = await sql<RecordDateResult>`
    SELECT "date_of_payment" AS "createdAt" FROM "invoices" WHERE "invoice_id" = ${invoiceId}
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

  const { rows: result } = await sql<RecordDateResult>`
    SELECT "expense_date" AS "createdAt" FROM "expenses" WHERE "id" = ${id}
  `.execute(getKysely());

  if (!result || result.length === 0) {
    throw new Error('Expense not found');
  }

  return result[0].createdAt;
}
