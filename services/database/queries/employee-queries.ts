/**
 * Employee CRUD (PostgreSQL / Kysely).
 *
 * Phase 5: replaces the raw T-SQL in routes/api/employee.routes.ts (which used
 * `OUTPUT INSERTED … INTO @table` — not valid in PG).
 *
 * Employee expenses now reference `employees` directly via `expenses.employee_id` (a
 * real FK), so the old name-matched `expense_subcategories` shadow under category 5
 * (and its insert/rename/delete sync) is gone — see the labs-normalization migration.
 */
import { getKysely } from '../kysely.js';

export interface EmployeeWriteData {
  employee_name: string;
  position: number;
  email: string | null;
  phone: string | null;
  percentage: boolean;
  commission_percentage: number | null;
  receive_email: boolean;
  get_appointments: boolean;
  is_active: boolean;
  sort_order: number;
  appointment_color: string | null;
}

/** Insert an employee. */
export async function createEmployee(data: EmployeeWriteData): Promise<number> {
  const row = await getKysely()
    .insertInto('employees')
    .values({
      employee_name: data.employee_name,
      position: data.position,
      email: data.email,
      phone: data.phone,
      // Quit (is_active=false) clears the EMAIL + APPOINTMENT flags — a former
      // employee is no longer a recipient and gets no new appointments. The
      // commission flag + rate are PRESERVED on quit (the route already couples
      // them: rate is null iff the flag is off) so the doctor still appears in the
      // Statistics commission report for periods they were working.
      percentage: data.percentage,
      commission_percentage: data.commission_percentage,
      receive_email: data.is_active && data.receive_email,
      get_appointments: data.is_active && data.get_appointments,
      is_active: data.is_active,
      sort_order: data.sort_order,
      appointment_color: data.appointment_color,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

/** Update an employee. */
export async function updateEmployee(id: number, data: EmployeeWriteData): Promise<void> {
  await getKysely()
    .updateTable('employees')
    .set({
      employee_name: data.employee_name,
      position: data.position,
      email: data.email,
      phone: data.phone,
      // Quit (is_active=false) clears EMAIL + APPOINTMENT flags only; the
      // commission flag + rate are PRESERVED on quit — see createEmployee.
      percentage: data.percentage,
      commission_percentage: data.commission_percentage,
      receive_email: data.is_active && data.receive_email,
      get_appointments: data.is_active && data.get_appointments,
      is_active: data.is_active,
      sort_order: data.sort_order,
      appointment_color: data.appointment_color,
    })
    .where('id', '=', id)
    .execute();
}

/** Delete an employee. (Blocked by FK if the employee has expense/work history — deactivate instead.) */
export async function deleteEmployee(id: number): Promise<void> {
  await getKysely().deleteFrom('employees').where('id', '=', id).execute();
}

/** Whether an employee with this email exists (optionally excluding one id). */
export async function employeeEmailExists(email: string, excludeId?: number): Promise<boolean> {
  let q = getKysely().selectFrom('employees').select('id').where('email', '=', email);
  if (excludeId !== undefined) q = q.where('id', '!=', excludeId);
  const row = await q.executeTakeFirst();
  return !!row;
}

/**
 * Whether an employee exists AND is currently active (not quit). Used to block
 * NEW task/alert assignments to quit employees — they only live on the Settings
 * page now, so they must not be selectable as an assignee anywhere else.
 */
export async function employeeIsActive(id: number): Promise<boolean> {
  const row = await getKysely()
    .selectFrom('employees')
    .select('id')
    .where('id', '=', id)
    .where('is_active', '=', true)
    .executeTakeFirst();
  return !!row;
}

/**
 * Name + phone of an employee (or undefined if missing). Used to WhatsApp-notify
 * an employee when a task/alert is assigned to them.
 */
export async function getEmployeeContact(
  id: number
): Promise<{ employee_name: string; phone: string | null } | undefined> {
  return getKysely()
    .selectFrom('employees')
    .select(['employee_name', 'phone'])
    .where('id', '=', id)
    .executeTakeFirst();
}
