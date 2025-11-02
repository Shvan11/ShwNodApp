/**
 * Expense Management Page Controller
 * Handles CRUD operations for expenses with filtering and summary displays
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    expenses: [],
    categories: [],
    subcategories: [],
    currentExpenseId: null,
    filters: {
        startDate: null,
        endDate: null,
        categoryId: null,
        subcategoryId: null,
        currency: null
    }
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
    // Buttons
    addExpenseBtn: document.getElementById('add-expense-btn'),
    applyFiltersBtn: document.getElementById('apply-filters-btn'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    saveExpenseBtn: document.getElementById('save-expense-btn'),
    confirmDeleteBtn: document.getElementById('confirm-delete-btn'),

    // Filters
    filterStartDate: document.getElementById('filter-start-date'),
    filterEndDate: document.getElementById('filter-end-date'),
    filterCategory: document.getElementById('filter-category'),
    filterSubcategory: document.getElementById('filter-subcategory'),
    filterCurrency: document.getElementById('filter-currency'),

    // Summary
    summaryTotal: document.getElementById('summary-total'),
    summaryIqd: document.getElementById('summary-iqd'),
    summaryUsd: document.getElementById('summary-usd'),
    summaryCount: document.getElementById('summary-count'),

    // Table
    expensesTBody: document.getElementById('expenses-tbody'),
    loadingIndicator: document.getElementById('loading-indicator'),

    // Modals
    expenseModal: document.getElementById('expense-modal'),
    deleteModal: document.getElementById('delete-modal'),
    modalTitle: document.getElementById('modal-title'),

    // Form
    expenseForm: document.getElementById('expense-form'),
    expenseDate: document.getElementById('expense-date'),
    expenseAmount: document.getElementById('expense-amount'),
    expenseCurrency: document.getElementById('expense-currency'),
    expenseCategory: document.getElementById('expense-category'),
    expenseSubcategory: document.getElementById('expense-subcategory'),
    expenseNote: document.getElementById('expense-note'),

    // Delete modal
    deleteExpenseDetails: document.getElementById('delete-expense-details')
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch expenses with optional filters
 */
async function fetchExpenses(filters = {}) {
    try {
        showLoading(true);
        const queryParams = new URLSearchParams();

        if (filters.startDate) queryParams.append('startDate', filters.startDate);
        if (filters.endDate) queryParams.append('endDate', filters.endDate);
        if (filters.categoryId) queryParams.append('categoryId', filters.categoryId);
        if (filters.subcategoryId) queryParams.append('subcategoryId', filters.subcategoryId);
        if (filters.currency) queryParams.append('currency', filters.currency);

        const response = await fetch(`/api/expenses?${queryParams}`);
        if (!response.ok) throw new Error('Failed to fetch expenses');

        const data = await response.json();
        state.expenses = data;
        renderExpensesTable();
        updateSummary();
    } catch (error) {
        console.error('Error fetching expenses:', error);
        showNotification('Failed to load expenses', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Fetch expense categories
 */
async function fetchCategories() {
    try {
        const response = await fetch('/api/expenses-categories');
        if (!response.ok) throw new Error('Failed to fetch categories');

        const data = await response.json();
        state.categories = data;
        populateCategoryDropdowns();
    } catch (error) {
        console.error('Error fetching categories:', error);
        showNotification('Failed to load categories', 'error');
    }
}

/**
 * Fetch expense subcategories
 */
async function fetchSubcategories(categoryId = null) {
    try {
        const url = categoryId
            ? `/api/expenses-subcategories?categoryId=${categoryId}`
            : '/api/expenses-subcategories';

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch subcategories');

        const data = await response.json();
        state.subcategories = data;
        populateSubcategoryDropdown(categoryId);
    } catch (error) {
        console.error('Error fetching subcategories:', error);
    }
}

/**
 * Create a new expense
 */
async function createExpense(expenseData) {
    try {
        const response = await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expenseData)
        });

        if (!response.ok) throw new Error('Failed to create expense');

        const result = await response.json();
        showNotification('Expense created successfully', 'success');
        return result;
    } catch (error) {
        console.error('Error creating expense:', error);
        showNotification('Failed to create expense', 'error');
        throw error;
    }
}

/**
 * Update an existing expense
 */
async function updateExpense(id, expenseData) {
    try {
        const response = await fetch(`/api/expenses/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expenseData)
        });

        if (!response.ok) throw new Error('Failed to update expense');

        const result = await response.json();
        showNotification('Expense updated successfully', 'success');
        return result;
    } catch (error) {
        console.error('Error updating expense:', error);
        showNotification('Failed to update expense', 'error');
        throw error;
    }
}

/**
 * Delete an expense
 */
async function deleteExpense(id) {
    try {
        const response = await fetch(`/api/expenses/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete expense');

        showNotification('Expense deleted successfully', 'success');
        return true;
    } catch (error) {
        console.error('Error deleting expense:', error);
        showNotification('Failed to delete expense', 'error');
        throw error;
    }
}

/**
 * Fetch expense summary
 */
async function fetchSummary(startDate, endDate) {
    try {
        if (!startDate || !endDate) return;

        const response = await fetch(`/api/expenses-summary?startDate=${startDate}&endDate=${endDate}`);
        if (!response.ok) throw new Error('Failed to fetch summary');

        return await response.json();
    } catch (error) {
        console.error('Error fetching summary:', error);
        return null;
    }
}

// ============================================================================
// UI RENDERING FUNCTIONS
// ============================================================================

/**
 * Render expenses table
 */
function renderExpensesTable() {
    if (!state.expenses || state.expenses.length === 0) {
        elements.expensesTBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">No expenses found</td>
            </tr>
        `;
        return;
    }

    const html = state.expenses.map(expense => {
        const date = new Date(expense.expenseDate).toLocaleDateString('en-US');
        const amount = formatNumber(expense.Amount);
        const currency = (expense.Currency || '').trim();
        const category = expense.CategoryName || '-';
        const subcategory = expense.SubcategoryName || '-';
        const note = expense.Note || '-';

        return `
            <tr data-expense-id="${expense.ID}">
                <td>${date}</td>
                <td class="amount-cell currency-${currency.toLowerCase()}">${amount}</td>
                <td><span class="currency-${currency.toLowerCase()}">${currency}</span></td>
                <td>${category}</td>
                <td>${subcategory}</td>
                <td class="note-cell" title="${note}">${note}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="window.editExpense(${expense.ID})">
                            Edit
                        </button>
                        <button class="btn-icon btn-delete" onclick="window.confirmDeleteExpense(${expense.ID})">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    elements.expensesTBody.innerHTML = html;
}

/**
 * Update summary display
 */
async function updateSummary() {
    const startDate = elements.filterStartDate.value;
    const endDate = elements.filterEndDate.value;

    if (startDate && endDate) {
        const summary = await fetchSummary(startDate, endDate);
        if (summary) {
            displaySummary(summary);
            return;
        }
    }

    // Fallback to client-side calculation if no date range
    const iqd = state.expenses
        .filter(e => (e.Currency || '').trim() === 'IQD')
        .reduce((sum, e) => sum + (e.Amount || 0), 0);

    const usd = state.expenses
        .filter(e => (e.Currency || '').trim() === 'USD')
        .reduce((sum, e) => sum + (e.Amount || 0), 0);

    elements.summaryIqd.textContent = formatNumber(iqd) + ' IQD';
    elements.summaryUsd.textContent = formatNumber(usd) + ' USD';
    elements.summaryCount.textContent = state.expenses.length;
    elements.summaryTotal.textContent = state.expenses.length + ' expenses';
}

/**
 * Display summary data
 */
function displaySummary(summary) {
    const iqd = summary.totals.find(t => t.Currency === 'IQD')?.TotalAmount || 0;
    const usd = summary.totals.find(t => t.Currency === 'USD')?.TotalAmount || 0;
    const count = summary.totals.reduce((sum, t) => sum + (t.ExpenseCount || 0), 0);

    elements.summaryIqd.textContent = formatNumber(iqd) + ' IQD';
    elements.summaryUsd.textContent = formatNumber(usd) + ' USD';
    elements.summaryCount.textContent = count;
    elements.summaryTotal.textContent = count + ' expenses';
}

/**
 * Populate category dropdowns
 */
function populateCategoryDropdowns() {
    const filterOptions = state.categories.map(cat =>
        `<option value="${cat.CategoryID}">${cat.CategoryName}</option>`
    ).join('');

    elements.filterCategory.innerHTML = '<option value="">All Categories</option>' + filterOptions;
    elements.expenseCategory.innerHTML = '<option value="">Select Category</option>' + filterOptions;
}

/**
 * Populate subcategory dropdown
 */
function populateSubcategoryDropdown(categoryId = null) {
    const subcategories = categoryId
        ? state.subcategories.filter(sub => sub.CategoryID === parseInt(categoryId))
        : state.subcategories;

    const options = subcategories.map(sub =>
        `<option value="${sub.SubcategoryID}">${sub.SubcategoryName}</option>`
    ).join('');

    elements.filterSubcategory.innerHTML = '<option value="">All Subcategories</option>' + options;
    elements.expenseSubcategory.innerHTML = '<option value="">Select Subcategory</option>' + options;
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================

/**
 * Open modal for adding new expense
 */
function openAddExpenseModal() {
    state.currentExpenseId = null;
    elements.modalTitle.textContent = 'Add New Expense';
    elements.expenseForm.reset();

    // Set default date to today
    elements.expenseDate.valueAsDate = new Date();

    openModal(elements.expenseModal);
}

/**
 * Open modal for editing expense
 */
async function openEditExpenseModal(id) {
    try {
        const response = await fetch(`/api/expenses/${id}`);
        if (!response.ok) throw new Error('Failed to fetch expense');

        const expense = await response.json();
        state.currentExpenseId = id;

        elements.modalTitle.textContent = 'Edit Expense';
        elements.expenseDate.value = expense.expenseDate.split('T')[0];
        elements.expenseAmount.value = expense.Amount;
        elements.expenseCurrency.value = (expense.Currency || '').trim();
        elements.expenseCategory.value = expense.CategoryID || '';

        // Load subcategories for the selected category
        if (expense.CategoryID) {
            await fetchSubcategories(expense.CategoryID);
            elements.expenseSubcategory.value = expense.SubcategoryID || '';
        }

        elements.expenseNote.value = expense.Note || '';

        openModal(elements.expenseModal);
    } catch (error) {
        console.error('Error loading expense:', error);
        showNotification('Failed to load expense data', 'error');
    }
}

/**
 * Open delete confirmation modal
 */
function openDeleteConfirmModal(id) {
    const expense = state.expenses.find(e => e.ID === id);
    if (!expense) return;

    state.currentExpenseId = id;

    const date = new Date(expense.expenseDate).toLocaleDateString('en-US');
    const amount = formatNumber(expense.Amount);
    const currency = (expense.Currency || '').trim();

    elements.deleteExpenseDetails.innerHTML = `
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Amount:</strong> ${amount} ${currency}</p>
        <p><strong>Category:</strong> ${expense.CategoryName || '-'}</p>
        <p><strong>Note:</strong> ${expense.Note || '-'}</p>
    `;

    openModal(elements.deleteModal);
}

/**
 * Open modal
 */
function openModal(modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
}

/**
 * Close modal
 */
function closeModal(modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle form submission
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    const formData = new FormData(elements.expenseForm);
    const expenseData = {
        expenseDate: formData.get('expenseDate'),
        amount: parseInt(formData.get('amount')),
        currency: formData.get('currency'),
        note: formData.get('note'),
        categoryId: formData.get('categoryId') || null,
        subcategoryId: formData.get('subcategoryId') || null
    };

    try {
        if (state.currentExpenseId) {
            await updateExpense(state.currentExpenseId, expenseData);
        } else {
            await createExpense(expenseData);
        }

        closeModal(elements.expenseModal);
        await fetchExpenses(state.filters);
    } catch (error) {
        // Error already handled in API functions
    }
}

/**
 * Handle delete confirmation
 */
async function handleDeleteConfirm() {
    if (!state.currentExpenseId) return;

    try {
        await deleteExpense(state.currentExpenseId);
        closeModal(elements.deleteModal);
        await fetchExpenses(state.filters);
    } catch (error) {
        // Error already handled in API functions
    }
}

/**
 * Handle filter application
 */
function handleApplyFilters() {
    state.filters = {
        startDate: elements.filterStartDate.value || null,
        endDate: elements.filterEndDate.value || null,
        categoryId: elements.filterCategory.value || null,
        subcategoryId: elements.filterSubcategory.value || null,
        currency: elements.filterCurrency.value || null
    };

    fetchExpenses(state.filters);
}

/**
 * Handle filter reset
 */
function handleResetFilters() {
    elements.filterStartDate.value = '';
    elements.filterEndDate.value = '';
    elements.filterCategory.value = '';
    elements.filterSubcategory.value = '';
    elements.filterCurrency.value = '';

    state.filters = {};
    fetchExpenses();
}

/**
 * Handle category change in filters
 */
function handleFilterCategoryChange() {
    const categoryId = elements.filterCategory.value;
    if (categoryId) {
        fetchSubcategories(categoryId);
    } else {
        elements.filterSubcategory.innerHTML = '<option value="">All Subcategories</option>';
    }
}

/**
 * Handle category change in expense form
 */
function handleFormCategoryChange() {
    const categoryId = elements.expenseCategory.value;
    if (categoryId) {
        fetchSubcategories(categoryId);
    } else {
        elements.expenseSubcategory.innerHTML = '<option value="">Select Subcategory</option>';
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format number with thousand separators
 */
function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num || 0);
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = show ? 'block' : 'none';
    }
}

/**
 * Show notification (simple alert for now)
 */
function showNotification(message, type) {
    alert(message);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the page
 */
async function initializePage() {
    // Set default date range (current month)
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    elements.filterStartDate.valueAsDate = firstDay;
    elements.filterEndDate.valueAsDate = lastDay;

    state.filters.startDate = formatDateString(firstDay);
    state.filters.endDate = formatDateString(lastDay);

    // Load initial data
    await fetchCategories();
    await fetchSubcategories();
    await fetchExpenses(state.filters);

    // Set up event listeners
    setupEventListeners();
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Button clicks
    elements.addExpenseBtn.addEventListener('click', openAddExpenseModal);
    elements.applyFiltersBtn.addEventListener('click', handleApplyFilters);
    elements.resetFiltersBtn.addEventListener('click', handleResetFilters);
    elements.confirmDeleteBtn.addEventListener('click', handleDeleteConfirm);

    // Form submission
    elements.expenseForm.addEventListener('submit', handleFormSubmit);

    // Category changes
    elements.filterCategory.addEventListener('change', handleFilterCategoryChange);
    elements.expenseCategory.addEventListener('change', handleFormCategoryChange);

    // Modal close buttons
    const closeButtons = document.querySelectorAll('.close, .cancel-btn');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) closeModal(modal);
        });
    });

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            closeModal(event.target);
        }
    });
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================================================
// GLOBAL FUNCTIONS (for onclick handlers)
// ============================================================================

window.editExpense = openEditExpenseModal;
window.confirmDeleteExpense = openDeleteConfirmModal;

// ============================================================================
// START APPLICATION
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}
