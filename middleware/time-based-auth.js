/**
 * SIMPLE Date-based Authorization Middleware
 *
 * Rule: Secretary can only edit/delete records created TODAY
 * Admin bypasses all restrictions
 *
 * KISS Principle: No complex calculations, no logging, no notifications
 */

import { executeQuery, TYPES } from '../services/database/index.js';

/**
 * Check if date is today (simple!)
 * @param {Date} date - The date to check
 * @returns {boolean} - True if date is today
 */
function isToday(date) {
  const today = new Date();
  const recordDate = new Date(date);

  return today.getFullYear() === recordDate.getFullYear() &&
         today.getMonth() === recordDate.getMonth() &&
         today.getDate() === recordDate.getDate();
}

/**
 * Middleware factory - returns configured middleware
 * @param {Object} options - Configuration options
 * @param {string} options.resourceType - Type of resource (patient, work, invoice, expense)
 * @param {string} options.operation - Operation type (delete or update)
 * @param {Function} options.getRecordDate - Async function to get record creation date
 * @param {string[]} options.restrictedFields - Fields that cannot be edited (for updates only)
 * @returns {Function} - Express middleware function
 */
export function requireRecordAge(options) {
  const {
    resourceType,
    operation,
    getRecordDate,
    restrictedFields = []
  } = options;

  return async (req, res, next) => {
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
          return res.status(403).json({
            error: 'Forbidden',
            message: `Cannot delete ${resourceType} not created today. Contact admin.`
          });
        }

        if (operation === 'update' && restrictedFields.length > 0) {
          // Check if trying to update restricted fields
          const updatingRestrictedField = restrictedFields.some(
            field => req.body.hasOwnProperty(field)
          );

          if (updatingRestrictedField) {
            return res.status(403).json({
              error: 'Forbidden',
              message: `Cannot edit money-related fields for ${resourceType} not created today. Contact admin.`,
              restrictedFields
            });
          }
        }
      }

      // Record created today - allow operation
      next();
    } catch (error) {
      console.error('Date-based auth error:', error);
      res.status(500).json({
        error: 'Authorization check failed',
        message: error.message
      });
    }
  };
}

/**
 * Helper Functions to Get Record Creation Dates
 */

/**
 * Get patient creation date
 * @param {Object} req - Express request object
 * @returns {Promise<Date>} - Patient creation date
 */
export async function getPatientCreationDate(req) {
  const { personId } = req.params;

  const result = await executeQuery(
    'SELECT DateAdded FROM dbo.tblpatients WHERE PersonID = @personId',
    [['personId', TYPES.Int, personId]],
    (columns) => ({ createdAt: columns[0].value })
  );

  if (!result || result.length === 0) {
    throw new Error('Patient not found');
  }

  return result[0].createdAt;
}

/**
 * Get work creation date
 * @param {Object} req - Express request object
 * @returns {Promise<Date>} - Work creation date
 */
export async function getWorkCreationDate(req) {
  // workId can come from body (delete, update) or params
  const workId = req.body.workId || req.body.workid || req.params.workId;

  if (!workId) {
    throw new Error('Work ID not provided');
  }

  const result = await executeQuery(
    'SELECT AdditionDate FROM dbo.tblwork WHERE WorkID = @workId',
    [['workId', TYPES.Int, parseInt(workId)]],
    (columns) => ({ createdAt: columns[0].value })
  );

  if (!result || result.length === 0) {
    throw new Error('Work not found');
  }

  return result[0].createdAt;
}

/**
 * Get invoice creation date
 * @param {Object} req - Express request object
 * @returns {Promise<Date>} - Invoice creation date
 */
export async function getInvoiceCreationDate(req) {
  const { invoiceId } = req.params;

  const result = await executeQuery(
    'SELECT Dateofpayment FROM dbo.tblInvoice WHERE InvoiceID = @invoiceId',
    [['invoiceId', TYPES.Int, invoiceId]],
    (columns) => ({ createdAt: columns[0].value })
  );

  if (!result || result.length === 0) {
    throw new Error('Invoice not found');
  }

  return result[0].createdAt;
}

/**
 * Get expense creation date
 * @param {Object} req - Express request object
 * @returns {Promise<Date>} - Expense creation date
 */
export async function getExpenseCreationDate(req) {
  const { id } = req.params;

  const result = await executeQuery(
    'SELECT expenseDate FROM dbo.tblExpenses WHERE ExpenseID = @expenseId',
    [['expenseId', TYPES.Int, id]],
    (columns) => ({ createdAt: columns[0].value })
  );

  if (!result || result.length === 0) {
    throw new Error('Expense not found');
  }

  return result[0].createdAt;
}

/**
 * Export isToday for frontend usage (if needed)
 */
export { isToday };
