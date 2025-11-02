/**
 * Expense-related database queries
 */
import { executeQuery, TYPES } from '../index.js';

/**
 * Retrieves all expenses with optional filtering
 * @param {Object} filters - Optional filters
 * @param {string} filters.startDate - Start date (YYYY-MM-DD)
 * @param {string} filters.endDate - End date (YYYY-MM-DD)
 * @param {number} filters.categoryId - Category ID
 * @param {number} filters.subcategoryId - Subcategory ID
 * @param {string} filters.currency - Currency (USD, IQD)
 * @returns {Promise<Array>} - A promise that resolves with an array of expense objects
 */
export async function getAllExpenses(filters = {}) {
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

    const params = [];

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

    return executeQuery(
        query,
        params,
        (columns) => ({
            ID: columns[0].value,
            expenseDate: columns[1].value,
            Amount: columns[2].value,
            Currency: columns[3].value,
            Note: columns[4].value,
            CategoryID: columns[5].value,
            SubcategoryID: columns[6].value,
            CategoryName: columns[7].value,
            SubcategoryName: columns[8].value
        })
    );
}

/**
 * Retrieves a single expense by ID
 * @param {number} id - The expense ID
 * @returns {Promise<Object>} - A promise that resolves with the expense object
 */
export async function getExpenseById(id) {
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

    const result = await executeQuery(
        query,
        [['id', TYPES.Int, id]],
        (columns) => ({
            ID: columns[0].value,
            expenseDate: columns[1].value,
            Amount: columns[2].value,
            Currency: columns[3].value,
            Note: columns[4].value,
            CategoryID: columns[5].value,
            SubcategoryID: columns[6].value,
            CategoryName: columns[7].value,
            SubcategoryName: columns[8].value
        })
    );

    return result.length > 0 ? result[0] : null;
}

/**
 * Retrieves all expense categories
 * @returns {Promise<Array>} - A promise that resolves with an array of category objects
 */
export async function getExpenseCategories() {
    const query = `
        SELECT CategoryID, CategoryName
        FROM dbo.tblExpenseCategories
        ORDER BY CategoryName
    `;

    return executeQuery(
        query,
        [],
        (columns) => ({
            CategoryID: columns[0].value,
            CategoryName: columns[1].value
        })
    );
}

/**
 * Retrieves expense subcategories for a given category
 * @param {number} categoryId - The category ID (optional, if not provided returns all)
 * @returns {Promise<Array>} - A promise that resolves with an array of subcategory objects
 */
export async function getExpenseSubcategories(categoryId = null) {
    let query = `
        SELECT
            s.SubcategoryID,
            s.SubcategoryName,
            s.CategoryID,
            c.CategoryName
        FROM dbo.tblExpenseSubcategories s
        LEFT JOIN dbo.tblExpenseCategories c ON s.CategoryID = c.CategoryID
    `;

    const params = [];

    if (categoryId) {
        query += ' WHERE s.CategoryID = @categoryId';
        params.push(['categoryId', TYPES.Int, categoryId]);
    }

    query += ' ORDER BY s.SubcategoryName';

    return executeQuery(
        query,
        params,
        (columns) => ({
            SubcategoryID: columns[0].value,
            SubcategoryName: columns[1].value,
            CategoryID: columns[2].value,
            CategoryName: columns[3].value
        })
    );
}

/**
 * Adds a new expense
 * @param {Object} expenseData - Expense data object
 * @param {string} expenseData.expenseDate - Expense date (YYYY-MM-DD)
 * @param {number} expenseData.amount - Amount
 * @param {string} expenseData.currency - Currency (USD, IQD)
 * @param {string} expenseData.note - Note/description
 * @param {number} expenseData.categoryId - Category ID
 * @param {number} expenseData.subcategoryId - Subcategory ID (optional)
 * @returns {Promise<Object>} - A promise that resolves with the result including the new ID
 */
export async function addExpense(expenseData) {
    const query = `
        INSERT INTO dbo.tblExpenses (expenseDate, Amount, Currency, Note, CategoryID, SubcategoryID)
        VALUES (@expenseDate, @amount, @currency, @note, @categoryId, @subcategoryId);
        SELECT SCOPE_IDENTITY() AS NewID;
    `;

    const params = [
        ['expenseDate', TYPES.Date, expenseData.expenseDate],
        ['amount', TYPES.Int, expenseData.amount],
        ['currency', TYPES.NChar, expenseData.currency || 'IQD'],
        ['note', TYPES.NVarChar, expenseData.note || null],
        ['categoryId', TYPES.Int, expenseData.categoryId || null],
        ['subcategoryId', TYPES.Int, expenseData.subcategoryId || null]
    ];

    const result = await executeQuery(
        query,
        params,
        (columns) => ({
            NewID: columns[0].value
        })
    );
    return result[0];
}

/**
 * Updates an existing expense
 * @param {number} id - The expense ID
 * @param {Object} expenseData - Expense data object
 * @returns {Promise<Object>} - A promise that resolves with the result
 */
export async function updateExpense(id, expenseData) {
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

    const params = [
        ['id', TYPES.Int, id],
        ['expenseDate', TYPES.Date, expenseData.expenseDate],
        ['amount', TYPES.Int, expenseData.amount],
        ['currency', TYPES.NChar, expenseData.currency || 'IQD'],
        ['note', TYPES.NVarChar, expenseData.note || null],
        ['categoryId', TYPES.Int, expenseData.categoryId || null],
        ['subcategoryId', TYPES.Int, expenseData.subcategoryId || null]
    ];

    await executeQuery(query, params);
    return { success: true, id };
}

/**
 * Deletes an expense
 * @param {number} id - The expense ID
 * @returns {Promise<Object>} - A promise that resolves with the result
 */
export async function deleteExpense(id) {
    const query = 'DELETE FROM dbo.tblExpenses WHERE ID = @id';

    await executeQuery(query, [['id', TYPES.Int, id]]);
    return { success: true, id };
}

/**
 * Gets expense summary by category and currency
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} - A promise that resolves with summary data
 */
export async function getExpenseSummary(startDate, endDate) {
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

    const params = [
        ['startDate', TYPES.Date, startDate],
        ['endDate', TYPES.Date, endDate]
    ];

    return executeQuery(
        query,
        params,
        (columns) => ({
            CategoryName: columns[0].value,
            Currency: columns[1].value,
            ExpenseCount: columns[2].value,
            TotalAmount: columns[3].value
        })
    );
}

/**
 * Gets total expenses by currency for a date range
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} - A promise that resolves with totals by currency
 */
export async function getExpenseTotalsByCurrency(startDate, endDate) {
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

    const params = [
        ['startDate', TYPES.Date, startDate],
        ['endDate', TYPES.Date, endDate]
    ];

    return executeQuery(
        query,
        params,
        (columns) => ({
            Currency: columns[0].value,
            ExpenseCount: columns[1].value,
            TotalAmount: columns[2].value
        })
    );
}
