/**
 * Expense-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `tblExpenses.amount` is
 * PG `integer` (maps straight to a JS number; no numeric cast). `expense_date` is a PG
 * `date`, which the centralized pg parser (kysely.ts) returns as a 'YYYY-MM-DD' string,
 * and the generated `Database` type already types it `string` — so it's projected as-is
 * and the declared return type is `string` (no `$castTo` needed). `currency` is `citext`, so equality is
 * already case-insensitive (matches the old Arabic_CI_AS column); we keep the trim
 * (`LTRIM(RTRIM(...))`) via PG `btrim()` so the grouping/filtering behavior is identical.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// type definitions
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
  id: number;
  expense_date: string;
  amount: number;
  currency: string | null;
  note: string | null;
  category_id: number | null;
  subcategory_id: number | null;
  category_name: string | null;
  subcategory_name: string | null;
}

interface ExpenseCategory {
  category_id: number;
  category_name: string;
}

interface ExpenseSubcategory {
  subcategory_id: number;
  subcategory_name: string;
  category_id: number;
  category_name: string | null;
}

interface ExpenseData {
  expense_date: string;
  amount: number;
  currency?: string;
  note?: string;
  categoryId?: number;
  subcategoryId?: number;
}

interface ExpenseSummary {
  category_name: string | null;
  currency: string;
  ExpenseCount: number;
  total_amount: number;
}

interface ExpenseTotal {
  currency: string;
  ExpenseCount: number;
  total_amount: number;
}

/**
 * Retrieves all expenses with optional filtering
 */
export async function getAllExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  const db = getKysely();

  let q = db
    .selectFrom('expenses as e')
    .leftJoin('expense_categories as c', 'e.category_id', 'c.category_id')
    .leftJoin('expense_subcategories as s', 'e.subcategory_id', 's.subcategory_id')
    .select([
      'e.id',
      'e.expense_date',
      'e.amount',
      'e.currency',
      'e.note',
      'e.category_id',
      'e.subcategory_id',
      'c.category_name',
      's.subcategory_name',
    ]);

  if (filters.startDate) {
    q = q.where('e.expense_date', '>=', sql<string>`${filters.startDate}`);
  }
  if (filters.endDate) {
    q = q.where('e.expense_date', '<=', sql<string>`${filters.endDate}`);
  }
  if (filters.categoryId) {
    q = q.where('e.category_id', '=', filters.categoryId);
  }
  if (filters.subcategoryId) {
    q = q.where('e.subcategory_id', '=', filters.subcategoryId);
  }
  if (filters.currency) {
    // citext is case-insensitive; keep the trim to match LTRIM(RTRIM(...)).
    q = q.where(sql<boolean>`btrim(${sql.ref('e.currency')}) = ${filters.currency}`);
  }

  q = q.orderBy('e.expense_date', 'desc').orderBy('e.id', 'desc');

  // Opt-in pagination (mirrors the old OFFSET/FETCH; requires the ORDER BY above).
  if (filters.limit != null) {
    const limit = Math.min(Math.max(Math.trunc(filters.limit), 1), MAX_PAGE_SIZE);
    const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
    q = q.limit(limit).offset(offset);
  }

  return q.execute() as Promise<Expense[]>;
}

/**
 * Retrieves a single expense by id
 */
export async function getExpenseById(id: number): Promise<Expense | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('expenses as e')
    .leftJoin('expense_categories as c', 'e.category_id', 'c.category_id')
    .leftJoin('expense_subcategories as s', 'e.subcategory_id', 's.subcategory_id')
    .where('e.id', '=', id)
    .select([
      'e.id',
      'e.expense_date',
      'e.amount',
      'e.currency',
      'e.note',
      'e.category_id',
      'e.subcategory_id',
      'c.category_name',
      's.subcategory_name',
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
    .selectFrom('expense_categories')
    .select(['category_id', 'category_name'])
    .orderBy('category_name')
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
    .selectFrom('expense_subcategories as s')
    .leftJoin('expense_categories as c', 's.category_id', 'c.category_id')
    .select(['s.subcategory_id', 's.subcategory_name', 's.category_id', 'c.category_name']);

  if (categoryId) {
    q = q.where('s.category_id', '=', categoryId);
  }

  q = q.orderBy('s.subcategory_name');

  return q.execute() as Promise<ExpenseSubcategory[]>;
}

/**
 * Adds a new expense
 */
export async function addExpense(expenseData: ExpenseData): Promise<{ NewID: number }> {
  const db = getKysely();
  const row = await db
    .insertInto('expenses')
    .values({
      expense_date: sql<string>`${expenseData.expense_date}`,
      amount: expenseData.amount,
      currency: expenseData.currency || 'IQD',
      note: expenseData.note || null,
      category_id: expenseData.categoryId || null,
      subcategory_id: expenseData.subcategoryId || null,
    })
    .returning('id as NewID')
    .executeTakeFirst();

  if (!row) {
    throw new Error('Failed to create expense: no id returned');
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
    .updateTable('expenses')
    .set({
      expense_date: sql<string>`${expenseData.expense_date}`,
      amount: expenseData.amount,
      currency: expenseData.currency || 'IQD',
      note: expenseData.note || null,
      category_id: expenseData.categoryId || null,
      subcategory_id: expenseData.subcategoryId || null,
    })
    .where('id', '=', id)
    .execute();

  return { success: true, id };
}

/**
 * Deletes an expense
 */
export async function deleteExpense(id: number): Promise<{ success: boolean; id: number }> {
  const db = getKysely();
  await db.deleteFrom('expenses').where('id', '=', id).execute();
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
    .selectFrom('expenses as e')
    .leftJoin('expense_categories as c', 'e.category_id', 'c.category_id')
    .where('e.expense_date', '>=', sql<string>`${startDate}`)
    .where('e.expense_date', '<=', sql<string>`${endDate}`)
    .groupBy(['c.category_name', sql`btrim(${sql.ref('e.currency')})`])
    .orderBy('c.category_name')
    .orderBy(sql`btrim(${sql.ref('e.currency')})`)
    .select((eb) => [
      'c.category_name',
      sql<string>`btrim(${sql.ref('e.currency')})`.as('currency'),
      eb.fn.countAll<number>().as('ExpenseCount'),
      eb.fn.sum('e.amount').$castTo<number>().as('total_amount'),
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
    .selectFrom('expenses')
    .where('expense_date', '>=', sql<string>`${startDate}`)
    .where('expense_date', '<=', sql<string>`${endDate}`)
    .groupBy(sql`btrim(${sql.ref('currency')})`)
    .orderBy(sql`btrim(${sql.ref('currency')})`)
    .select((eb) => [
      sql<string>`btrim(${sql.ref('currency')})`.as('currency'),
      eb.fn.countAll<number>().as('ExpenseCount'),
      eb.fn.sum('amount').$castTo<number>().as('total_amount'),
    ])
    .execute() as Promise<ExpenseTotal[]>;
}
