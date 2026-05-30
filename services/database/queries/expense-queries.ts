/**
 * Expense-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `tblExpenses.Amount` is
 * PG `integer` (maps straight to a JS number; no numeric cast). `expenseDate` is a PG
 * `date`, which the centralized pg parser (kysely.ts) returns as a 'YYYY-MM-DD' string;
 * the declared return types still say `Date`, preserved via `$castTo<Date>()` — the
 * runtime value is now a string (see FLAGS). `Currency` is `citext`, so equality is
 * already case-insensitive (matches the old Arabic_CI_AS column); we keep the trim
 * (`LTRIM(RTRIM(...))`) via PG `btrim()` so the grouping/filtering behavior is identical.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// Type definitions
interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  subcategoryId?: number;
  currency?: string;
  // Optional pagination. When omitted, behavior is unchanged (all matching rows).
  limit?: number;
  offset?: number;
}

// Upper bound on a single page, so a caller can't request an unbounded scan.
const MAX_PAGE_SIZE = 1000;

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
  const db = getKysely();

  let q = db
    .selectFrom('tblExpenses as e')
    .leftJoin('tblExpenseCategories as c', 'e.CategoryID', 'c.CategoryID')
    .leftJoin('tblExpenseSubcategories as s', 'e.SubcategoryID', 's.SubcategoryID')
    .select((eb) => [
      'e.ID',
      eb.ref('e.expenseDate').$castTo<Date>().as('expenseDate'),
      'e.Amount',
      'e.Currency',
      'e.Note',
      'e.CategoryID',
      'e.SubcategoryID',
      'c.CategoryName',
      's.SubcategoryName',
    ]);

  if (filters.startDate) {
    q = q.where('e.expenseDate', '>=', sql<Date>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where('e.expenseDate', '<=', sql<Date>`${filters.endDate}`);
  }
  if (filters.categoryId) {
    q = q.where('e.CategoryID', '=', filters.categoryId);
  }
  if (filters.subcategoryId) {
    q = q.where('e.SubcategoryID', '=', filters.subcategoryId);
  }
  if (filters.currency) {
    // citext is case-insensitive; keep the trim to match LTRIM(RTRIM(...)).
    q = q.where(sql<boolean>`btrim(${sql.ref('e.Currency')}) = ${filters.currency}`);
  }

  q = q.orderBy('e.expenseDate', 'desc').orderBy('e.ID', 'desc');

  // Opt-in pagination (mirrors the old OFFSET/FETCH; requires the ORDER BY above).
  if (filters.limit != null) {
    const limit = Math.min(Math.max(Math.trunc(filters.limit), 1), MAX_PAGE_SIZE);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    q = q.limit(limit).offset(offset);
  }

  return q.execute() as Promise<Expense[]>;
}

/**
 * Retrieves a single expense by ID
 */
export async function getExpenseById(id: number): Promise<Expense | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblExpenses as e')
    .leftJoin('tblExpenseCategories as c', 'e.CategoryID', 'c.CategoryID')
    .leftJoin('tblExpenseSubcategories as s', 'e.SubcategoryID', 's.SubcategoryID')
    .where('e.ID', '=', id)
    .select((eb) => [
      'e.ID',
      eb.ref('e.expenseDate').$castTo<Date>().as('expenseDate'),
      'e.Amount',
      'e.Currency',
      'e.Note',
      'e.CategoryID',
      'e.SubcategoryID',
      'c.CategoryName',
      's.SubcategoryName',
    ])
    .executeTakeFirst();

  return (row as Expense | undefined) ?? null;
}

/**
 * Retrieves all expense categories
 */
export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const db = getKysely();
  return db
    .selectFrom('tblExpenseCategories')
    .select(['CategoryID', 'CategoryName'])
    .orderBy('CategoryName')
    .execute();
}

/**
 * Retrieves expense subcategories for a given category
 */
export async function getExpenseSubcategories(
  categoryId: number | null = null
): Promise<ExpenseSubcategory[]> {
  const db = getKysely();
  let q = db
    .selectFrom('tblExpenseSubcategories as s')
    .leftJoin('tblExpenseCategories as c', 's.CategoryID', 'c.CategoryID')
    .select(['s.SubcategoryID', 's.SubcategoryName', 's.CategoryID', 'c.CategoryName']);

  if (categoryId) {
    q = q.where('s.CategoryID', '=', categoryId);
  }

  q = q.orderBy('s.SubcategoryName');

  return q.execute() as Promise<ExpenseSubcategory[]>;
}

/**
 * Adds a new expense
 */
export async function addExpense(expenseData: ExpenseData): Promise<{ NewID: number }> {
  const db = getKysely();
  const row = await db
    .insertInto('tblExpenses')
    .values({
      expenseDate: sql<Date>`${expenseData.expenseDate}`,
      Amount: expenseData.amount,
      Currency: expenseData.currency || 'IQD',
      Note: expenseData.note || null,
      CategoryID: expenseData.categoryId || null,
      SubcategoryID: expenseData.subcategoryId || null,
    })
    .returning('ID as NewID')
    .executeTakeFirst();

  if (!row) {
    throw new Error('Failed to create expense: no ID returned');
  }

  return row;
}

/**
 * Updates an existing expense
 */
export async function updateExpense(
  id: number,
  expenseData: ExpenseData
): Promise<{ success: boolean; id: number }> {
  const db = getKysely();
  await db
    .updateTable('tblExpenses')
    .set({
      expenseDate: sql<Date>`${expenseData.expenseDate}`,
      Amount: expenseData.amount,
      Currency: expenseData.currency || 'IQD',
      Note: expenseData.note || null,
      CategoryID: expenseData.categoryId || null,
      SubcategoryID: expenseData.subcategoryId || null,
    })
    .where('ID', '=', id)
    .execute();

  return { success: true, id };
}

/**
 * Deletes an expense
 */
export async function deleteExpense(id: number): Promise<{ success: boolean; id: number }> {
  const db = getKysely();
  await db.deleteFrom('tblExpenses').where('ID', '=', id).execute();
  return { success: true, id };
}

/**
 * Gets expense summary by category and currency
 */
export async function getExpenseSummary(
  startDate: string,
  endDate: string
): Promise<ExpenseSummary[]> {
  const db = getKysely();
  return db
    .selectFrom('tblExpenses as e')
    .leftJoin('tblExpenseCategories as c', 'e.CategoryID', 'c.CategoryID')
    .where('e.expenseDate', '>=', sql<Date>`${startDate}`)
    .where('e.expenseDate', '<=', sql<Date>`${endDate}`)
    .groupBy(['c.CategoryName', sql`btrim(${sql.ref('e.Currency')})`])
    .orderBy('c.CategoryName')
    .orderBy(sql`btrim(${sql.ref('e.Currency')})`)
    .select((eb) => [
      'c.CategoryName',
      sql<string>`btrim(${sql.ref('e.Currency')})`.as('Currency'),
      eb.fn.countAll<number>().as('ExpenseCount'),
      eb.fn.sum('e.Amount').$castTo<number>().as('TotalAmount'),
    ])
    .execute() as Promise<ExpenseSummary[]>;
}

/**
 * Gets total expenses by currency for a date range
 */
export async function getExpenseTotalsByCurrency(
  startDate: string,
  endDate: string
): Promise<ExpenseTotal[]> {
  const db = getKysely();
  return db
    .selectFrom('tblExpenses')
    .where('expenseDate', '>=', sql<Date>`${startDate}`)
    .where('expenseDate', '<=', sql<Date>`${endDate}`)
    .groupBy(sql`btrim(${sql.ref('Currency')})`)
    .orderBy(sql`btrim(${sql.ref('Currency')})`)
    .select((eb) => [
      sql<string>`btrim(${sql.ref('Currency')})`.as('Currency'),
      eb.fn.countAll<number>().as('ExpenseCount'),
      eb.fn.sum('Amount').$castTo<number>().as('TotalAmount'),
    ])
    .execute() as Promise<ExpenseTotal[]>;
}
