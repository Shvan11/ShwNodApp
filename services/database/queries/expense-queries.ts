/**
 * Expense-related database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES, SqlParam } from '../index.js';

// Type definitions
interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  subcategoryId?: number;
  currency?: string;
}

interface Expense {
  ID: number;
  expenseDate: Date;
  Amount: number;
  Currency: string | null;
  Note: string | null;
  CategoryID: number | null;
  SubcategoryID: number | null;
  CategoryName: string | null;
  SubcategoryName: string | null;
}

interface ExpenseCategory {
  CategoryID: number;
  CategoryName: string;
}

interface ExpenseSubcategory {
  SubcategoryID: number;
  SubcategoryName: string;
  CategoryID: number;
  CategoryName: string | null;
}

interface ExpenseData {
  expenseDate: string;
  amount: number;
  currency?: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
}

interface ExpenseSummary {
  CategoryName: string | null;
  Currency: string;
  ExpenseCount: number;
  TotalAmount: number;
}

interface ExpenseTotal {
  Currency: string;
  ExpenseCount: number;
  TotalAmount: number;
}

/**
 * Retrieves all expenses with optional filtering
 */
export async function getAllExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  let query = `
    SELECT
      e.ID,
      e.expenseDate,
      e.Amount,
      e.Currency,
      e.Note,
      e.CategoryID,
      e.SubcategoryID,
      c.CategoryName,
      s.SubcategoryName
    FROM dbo.tblExpenses e
    LEFT JOIN dbo.tblExpenseCategories c ON e.CategoryID = c.CategoryID
    LEFT JOIN dbo.tblExpenseSubcategories s ON e.SubcategoryID = s.SubcategoryID
    WHERE 1=1
  `;

  const params: SqlParam[] = [];

  if (filters.startDate) {
    query += ' AND e.expenseDate >= @startDate';
    params.push(['startDate', TYPES.Date, filters.startDate]);
  }

  if (filters.endDate) {
    query += ' AND e.expenseDate <= @endDate';
    params.push(['endDate', TYPES.Date, filters.endDate]);
  }

  if (filters.categoryId) {
    query += ' AND e.CategoryID = @categoryId';
    params.push(['categoryId', TYPES.Int, filters.categoryId]);
  }

  if (filters.subcategoryId) {
    query += ' AND e.SubcategoryID = @subcategoryId';
    params.push(['subcategoryId', TYPES.Int, filters.subcategoryId]);
  }

  if (filters.currency) {
    query += ' AND LTRIM(RTRIM(e.Currency)) = @currency';
    params.push(['currency', TYPES.NVarChar, filters.currency]);
  }

  query += ' ORDER BY e.expenseDate DESC, e.ID DESC';

  return executeQuery<Expense>(query, params, (columns: ColumnValue[]) => ({
    ID: columns[0].value as number,
    expenseDate: columns[1].value as Date,
    Amount: columns[2].value as number,
    Currency: columns[3].value as string | null,
    Note: columns[4].value as string | null,
    CategoryID: columns[5].value as number | null,
    SubcategoryID: columns[6].value as number | null,
    CategoryName: columns[7].value as string | null,
    SubcategoryName: columns[8].value as string | null,
  }));
}

/**
 * Retrieves a single expense by ID
 */
export async function getExpenseById(id: number): Promise<Expense | null> {
  const query = `
    SELECT
      e.ID,
      e.expenseDate,
      e.Amount,
      e.Currency,
      e.Note,
      e.CategoryID,
      e.SubcategoryID,
      c.CategoryName,
      s.SubcategoryName
    FROM dbo.tblExpenses e
    LEFT JOIN dbo.tblExpenseCategories c ON e.CategoryID = c.CategoryID
    LEFT JOIN dbo.tblExpenseSubcategories s ON e.SubcategoryID = s.SubcategoryID
    WHERE e.ID = @id
  `;

  const result = await executeQuery<Expense>(query, [['id', TYPES.Int, id]], (columns: ColumnValue[]) => ({
    ID: columns[0].value as number,
    expenseDate: columns[1].value as Date,
    Amount: columns[2].value as number,
    Currency: columns[3].value as string | null,
    Note: columns[4].value as string | null,
    CategoryID: columns[5].value as number | null,
    SubcategoryID: columns[6].value as number | null,
    CategoryName: columns[7].value as string | null,
    SubcategoryName: columns[8].value as string | null,
  }));

  return result.length > 0 ? result[0] : null;
}

/**
 * Retrieves all expense categories
 */
export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const query = `
    SELECT CategoryID, CategoryName
    FROM dbo.tblExpenseCategories
    ORDER BY CategoryName
  `;

  return executeQuery<ExpenseCategory>(query, [], (columns: ColumnValue[]) => ({
    CategoryID: columns[0].value as number,
    CategoryName: columns[1].value as string,
  }));
}

/**
 * Retrieves expense subcategories for a given category
 */
export async function getExpenseSubcategories(
  categoryId: number | null = null
): Promise<ExpenseSubcategory[]> {
  let query = `
    SELECT
      s.SubcategoryID,
      s.SubcategoryName,
      s.CategoryID,
      c.CategoryName
    FROM dbo.tblExpenseSubcategories s
    LEFT JOIN dbo.tblExpenseCategories c ON s.CategoryID = c.CategoryID
  `;

  const params: SqlParam[] = [];

  if (categoryId) {
    query += ' WHERE s.CategoryID = @categoryId';
    params.push(['categoryId', TYPES.Int, categoryId]);
  }

  query += ' ORDER BY s.SubcategoryName';

  return executeQuery<ExpenseSubcategory>(query, params, (columns: ColumnValue[]) => ({
    SubcategoryID: columns[0].value as number,
    SubcategoryName: columns[1].value as string,
    CategoryID: columns[2].value as number,
    CategoryName: columns[3].value as string | null,
  }));
}

/**
 * Adds a new expense
 */
export async function addExpense(expenseData: ExpenseData): Promise<{ NewID: number }> {
  const query = `
    INSERT INTO dbo.tblExpenses (expenseDate, Amount, Currency, Note, CategoryID, SubcategoryID)
    VALUES (@expenseDate, @amount, @currency, @note, @categoryId, @subcategoryId);
    SELECT SCOPE_IDENTITY() AS NewID;
  `;

  const params: SqlParam[] = [
    ['expenseDate', TYPES.Date, expenseData.expenseDate],
    ['amount', TYPES.Int, expenseData.amount],
    ['currency', TYPES.NChar, expenseData.currency || 'IQD'],
    ['note', TYPES.NVarChar, expenseData.note || null],
    ['categoryId', TYPES.Int, expenseData.categoryId || null],
    ['subcategoryId', TYPES.Int, expenseData.subcategoryId || null],
  ];

  const result = await executeQuery<{ NewID: number }>(query, params, (columns: ColumnValue[]) => ({
    NewID: columns[0]?.value as number,
  }));

  if (!result?.[0]) {
    throw new Error('Failed to create expense: no ID returned');
  }

  return result[0];
}

/**
 * Updates an existing expense
 */
export async function updateExpense(
  id: number,
  expenseData: ExpenseData
): Promise<{ success: boolean; id: number }> {
  const query = `
    UPDATE dbo.tblExpenses
    SET
      expenseDate = @expenseDate,
      Amount = @amount,
      Currency = @currency,
      Note = @note,
      CategoryID = @categoryId,
      SubcategoryID = @subcategoryId
    WHERE ID = @id
  `;

  const params: SqlParam[] = [
    ['id', TYPES.Int, id],
    ['expenseDate', TYPES.Date, expenseData.expenseDate],
    ['amount', TYPES.Int, expenseData.amount],
    ['currency', TYPES.NChar, expenseData.currency || 'IQD'],
    ['note', TYPES.NVarChar, expenseData.note || null],
    ['categoryId', TYPES.Int, expenseData.categoryId || null],
    ['subcategoryId', TYPES.Int, expenseData.subcategoryId || null],
  ];

  await executeQuery(query, params, () => ({}));
  return { success: true, id };
}

/**
 * Deletes an expense
 */
export async function deleteExpense(id: number): Promise<{ success: boolean; id: number }> {
  const query = 'DELETE FROM dbo.tblExpenses WHERE ID = @id';

  await executeQuery(query, [['id', TYPES.Int, id]], () => ({}));
  return { success: true, id };
}

/**
 * Gets expense summary by category and currency
 */
export async function getExpenseSummary(
  startDate: string,
  endDate: string
): Promise<ExpenseSummary[]> {
  const query = `
    SELECT
      c.CategoryName,
      LTRIM(RTRIM(e.Currency)) AS Currency,
      COUNT(*) AS ExpenseCount,
      SUM(e.Amount) AS TotalAmount
    FROM dbo.tblExpenses e
    LEFT JOIN dbo.tblExpenseCategories c ON e.CategoryID = c.CategoryID
    WHERE e.expenseDate >= @startDate AND e.expenseDate <= @endDate
    GROUP BY c.CategoryName, LTRIM(RTRIM(e.Currency))
    ORDER BY c.CategoryName, LTRIM(RTRIM(e.Currency))
  `;

  const params: SqlParam[] = [
    ['startDate', TYPES.Date, startDate],
    ['endDate', TYPES.Date, endDate],
  ];

  return executeQuery<ExpenseSummary>(query, params, (columns: ColumnValue[]) => ({
    CategoryName: columns[0].value as string | null,
    Currency: columns[1].value as string,
    ExpenseCount: columns[2].value as number,
    TotalAmount: columns[3].value as number,
  }));
}

/**
 * Gets total expenses by currency for a date range
 */
export async function getExpenseTotalsByCurrency(
  startDate: string,
  endDate: string
): Promise<ExpenseTotal[]> {
  const query = `
    SELECT
      LTRIM(RTRIM(Currency)) AS Currency,
      COUNT(*) AS ExpenseCount,
      SUM(Amount) AS TotalAmount
    FROM dbo.tblExpenses
    WHERE expenseDate >= @startDate AND expenseDate <= @endDate
    GROUP BY LTRIM(RTRIM(Currency))
    ORDER BY LTRIM(RTRIM(Currency))
  `;

  const params: SqlParam[] = [
    ['startDate', TYPES.Date, startDate],
    ['endDate', TYPES.Date, endDate],
  ];

  return executeQuery<ExpenseTotal>(query, params, (columns: ColumnValue[]) => ({
    Currency: columns[0].value as string,
    ExpenseCount: columns[1].value as number,
    TotalAmount: columns[2].value as number,
  }));
}
