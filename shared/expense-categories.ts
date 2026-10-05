/**
 * Special expense categories whose sub-level is a first-class ENTITY, not a generic
 * subcategory: "Employees" expenses reference `employees`, "Lab" expenses reference
 * `labs` (via expenses.employee_id / expenses.lab_id). The expense form swaps its
 * sub-level dropdown based on these, and Settings → Lookups refuses to delete the two
 * rows (`lookup-admin-queries.ts`, audit FE-F21-12) — shared so both sides name them once.
 *
 * Hardcoded ids, so every deployment must have these two rows at exactly these ids:
 * migrations/pg/1789460500000_seed-product-constants.sql seeds them on a new install
 * (before it, an empty install handed 5 and 7 to whatever category was typed first),
 * and services/database/fresh-install.test.ts holds the two in step. The same posture
 * as the backend constant these mirror (see the labs-normalization migration; the old
 * backend EMPLOYEE_EXPENSE_CATEGORY = 5).
 */
export const EMPLOYEE_EXPENSE_CATEGORY = 5;
export const LAB_EXPENSE_CATEGORY = 7;
