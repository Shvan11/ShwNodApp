/**
 * Employee CRUD (PostgreSQL / Kysely).
 *
 * Employee expenses now reference `employees` directly via `expenses.employee_id` (a
 * real FK), so the old name-matched `expense_subcategories` shadow under category 5
 * (and its insert/rename/delete sync) is gone — see the labs-normalization migration.
 */
import { sql } from 'kysely';
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

// ---------------------------------------------------------------------------
// Reads — the employee/position/doctor/operator feeds.
//
// These four were raw `sql` in the route layer (`employee.routes.ts` 12
// statements, `staff.routes.ts` 2) until the R9(b) move; the routes now do
// query-string adaptation only. Rows are `type` (not `interface`) so an array
// of them feeds the contracts' `sendData` arg — the index-signature rule
// (CLAUDE.md / TS2345).
// ---------------------------------------------------------------------------

/** One row of the GET /employees feed — the SELECT list is fully enumerated. */
export type EmployeeListRow = {
  id: number;
  employee_name: string;
  position: number | null;
  position_name: string | null;
  email: string | null;
  phone: string | null;
  percentage: boolean;
  commission_percentage: number | null;
  receive_email: boolean;
  get_appointments: boolean;
  is_active: boolean;
  sort_order: number;
  appointment_color: string | null;
};

export type PositionListRow = {
  id: number;
  position_name: string | null;
};

/** Minimal staff row for the doctor/operator selectors. */
export type StaffMemberRow = {
  id: number;
  employee_name: string;
};

export type EmployeeListFilters = {
  /** Only employees who can be booked on the calendar. */
  getAppointments?: boolean;
  /** Only employees who receive email notifications AND have a non-blank address. */
  receiveEmail?: boolean;
  /** Only employees on percentage-based compensation. */
  percentage?: boolean;
  /**
   * position id OR position NAME — an all-numeric value matches
   * `employees.position`, anything else matches `positions.position_name`.
   * Both forms are in use by callers, so the discrimination lives here with
   * the SQL rather than in the route.
   */
  position?: string;
  /**
   * ALSO return quit (is_active=false) employees. They are hidden by default —
   * only the Settings management page opts in. Everywhere else (dropdowns,
   * recipient lists) sees active staff only.
   */
  includeInactive?: boolean;
};

/** All employees matching the filters, ordered by sort_order then name. */
export async function listEmployees(filters: EmployeeListFilters = {}): Promise<EmployeeListRow[]> {
  const { getAppointments, receiveEmail, percentage, position, includeInactive } = filters;

  // Build WHERE clause conditions as composable SQL fragments
  const conditions = [];

  // Quit employees are kept for historical purposes but hidden everywhere
  // except the Settings page, which passes includeInactive to manage them.
  if (!includeInactive) {
    conditions.push(sql`e."is_active" = true`);
  }

  if (getAppointments) {
    conditions.push(sql`e."get_appointments" = true`);
  }

  if (receiveEmail) {
    conditions.push(sql`e."receive_email" = true`);
    conditions.push(sql`e."email" IS NOT NULL`);
    conditions.push(sql`e."email" != ''`);
  }

  if (percentage) {
    conditions.push(sql`e."percentage" = true`);
  }

  if (position) {
    // Support filtering by position name or id
    if (isNaN(Number(position))) {
      conditions.push(sql`p."position_name" = ${position}`);
    } else {
      conditions.push(sql`e."position" = ${parseInt(position, 10)}`);
    }
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const { rows } = await sql<EmployeeListRow>`
      SELECT e."id", e."employee_name", e."position", p."position_name", e."email", e."phone", e."percentage", e."commission_percentage", e."receive_email", e."get_appointments", e."is_active", e."sort_order", e."appointment_color"
      FROM "employees" e
      LEFT JOIN "positions" p ON e."position" = p."id"
      ${whereClause}
      ORDER BY e."sort_order", e."employee_name"
    `.execute(getKysely());

  return rows;
}

/** Every position, alphabetically. */
export async function listPositions(): Promise<PositionListRow[]> {
  const { rows } = await sql<PositionListRow>`
      SELECT "id", "position_name"
      FROM "positions"
      ORDER BY "position_name"
    `.execute(getKysely());
  return rows;
}

/**
 * All ACTIVE doctors (employees whose position is 'Doctor'; quit employees are
 * hidden — they only appear on the Settings page).
 */
export async function listActiveDoctors(): Promise<StaffMemberRow[]> {
  const { rows } = await sql<StaffMemberRow>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      INNER JOIN "positions" p ON e."position" = p."id"
      WHERE p."position_name" = 'Doctor'
        AND e."is_active" = true
      ORDER BY e."employee_name"
    `.execute(getKysely());
  return rows;
}

/** All ACTIVE operators (every current employee; quit employees are hidden). */
export async function listActiveOperators(): Promise<StaffMemberRow[]> {
  const { rows } = await sql<StaffMemberRow>`
      SELECT e."id", e."employee_name"
      FROM "employees" e
      WHERE e."is_active" = true
      ORDER BY e."employee_name"
    `.execute(getKysely());
  return rows;
}
