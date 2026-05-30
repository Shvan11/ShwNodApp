/**
 * Employee CRUD (PostgreSQL / Kysely).
 *
 * Phase 5: replaces the raw T-SQL in routes/api/employee.routes.ts (which used
 * `OUTPUT INSERTED … INTO @table` — not valid in PG) and folds in the three tblEmployees triggers
 * (trg_InsertEmployee / trg_UpdateEmployee / trg_DeleteEmployee) that mirrored employee names into
 * tblExpenseSubcategories under CategoryID = 5. Each write runs in one transaction.
 */
import { getKysely, withPgTransaction } from '../kysely.js';

const EMPLOYEE_EXPENSE_CATEGORY = 5; // CategoryID for the "Employees" expense category

export interface EmployeeWriteData {
  employeeName: string;
  Position: number;
  Email: string | null;
  Phone: string | null;
  Percentage: boolean;
  receiveEmail: boolean;
  getAppointments: boolean;
  SortOrder: number;
  AppointmentColor: string | null;
}

/** Insert an employee (+ trg_InsertEmployee: mirror into tblExpenseSubcategories). */
export async function createEmployee(data: EmployeeWriteData): Promise<number> {
  return withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('tblEmployees')
      .values({
        employeeName: data.employeeName,
        Position: data.Position,
        Email: data.Email,
        Phone: data.Phone,
        Percentage: data.Percentage,
        receiveEmail: data.receiveEmail,
        getAppointments: data.getAppointments,
        SortOrder: data.SortOrder,
        AppointmentColor: data.AppointmentColor,
      })
      .returning('ID')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('tblExpenseSubcategories')
      .values({ SubcategoryName: data.employeeName, CategoryID: EMPLOYEE_EXPENSE_CATEGORY })
      .execute();

    return row.ID;
  });
}

/** Update an employee (+ trg_UpdateEmployee: rename the matching expense subcategory). */
export async function updateEmployee(id: number, data: EmployeeWriteData): Promise<void> {
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('tblEmployees')
      .select('employeeName')
      .where('ID', '=', id)
      .executeTakeFirst();

    await trx
      .updateTable('tblEmployees')
      .set({
        employeeName: data.employeeName,
        Position: data.Position,
        Email: data.Email,
        Phone: data.Phone,
        Percentage: data.Percentage,
        receiveEmail: data.receiveEmail,
        getAppointments: data.getAppointments,
        SortOrder: data.SortOrder,
        AppointmentColor: data.AppointmentColor,
      })
      .where('ID', '=', id)
      .execute();

    if (existing && existing.employeeName !== data.employeeName) {
      await trx
        .updateTable('tblExpenseSubcategories')
        .set({ SubcategoryName: data.employeeName })
        .where('CategoryID', '=', EMPLOYEE_EXPENSE_CATEGORY)
        .where('SubcategoryName', '=', existing.employeeName)
        .execute();
    }
  });
}

/** Delete an employee (+ trg_DeleteEmployee: drop the matching expense subcategory). */
export async function deleteEmployee(id: number): Promise<void> {
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('tblEmployees')
      .select('employeeName')
      .where('ID', '=', id)
      .executeTakeFirst();

    await trx.deleteFrom('tblEmployees').where('ID', '=', id).execute();

    if (existing) {
      await trx
        .deleteFrom('tblExpenseSubcategories')
        .where('CategoryID', '=', EMPLOYEE_EXPENSE_CATEGORY)
        .where('SubcategoryName', '=', existing.employeeName)
        .execute();
    }
  });
}

/** Whether an employee with this email exists (optionally excluding one ID). */
export async function employeeEmailExists(email: string, excludeId?: number): Promise<boolean> {
  let q = getKysely().selectFrom('tblEmployees').select('ID').where('Email', '=', email);
  if (excludeId !== undefined) q = q.where('ID', '!=', excludeId);
  const row = await q.executeTakeFirst();
  return !!row;
}
