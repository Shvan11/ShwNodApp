/**
 * Special expense categories whose sub-level is a first-class ENTITY, not a generic
 * subcategory: "Employees" expenses reference `employees`, "Lab" expenses reference
 * `labs` (via expenses.employee_id / expenses.lab_id). The expense form swaps its
 * sub-level dropdown based on these.
 *
 * Hardcoded to the seed ids — the seed assigns category ids in a fixed order across
 * every deployment, the same posture as the backend constant these mirror (see the
 * labs-normalization migration; the old backend EMPLOYEE_EXPENSE_CATEGORY = 5).
 */
export const EMPLOYEE_EXPENSE_CATEGORY = 5;
export const LAB_EXPENSE_CATEGORY = 7;
