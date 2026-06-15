/**
 * API contract — employee endpoints.
 *
 * Single source of truth for each employee endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`. See
 * docs/shared-contract-progress.md.
 *
 * Phase 9 (Wave 2). Adds the previously-missing GET `/employees` query schema
 * (the filters were read with manual `parseInt`/`Number`). The create/update
 * BODY is now FULLY ENUMERATED as a strict `z.object` (the hand-written
 * `EmployeeBody` interface in the route was deleted; the handler types from
 * `EmployeeBody = z.infer` below). The client (`EmployeeSettings.tsx`) sends
 * `position`/`sort_order` as STRINGS (coerced) and the three flags as real JS
 * booleans; `sort_order: ''` maps to undefined so the handler's `999` default
 * still applies. `phone` is read by the handler but the form omits it (optional).
 */
import { z } from 'zod';
import { idParams } from '../validation.js';

// ---------------------------------------------------------------------------
// GET /api/employees?getAppointments=&receiveEmail=&percentage=&position=
//   → { employees: Employee[] }
//
// All filters are loose strings: the booleans are matched as the literal 'true',
// and `position` may be a position NAME or an id (`isNaN(Number(position))`
// branch) — so a numeric query schema would 400 the name form. Validate only
// that they are strings (closes the boundary); the handler owns the semantics.
// ---------------------------------------------------------------------------
// One staff row — every column the GET /employees SELECT projects (id +
// employee_name + the joined position_name + the editable fields). Closed
// `z.object` (not `looseObject`): the SELECT list is fully enumerated here, so
// there is no long-tail field to preserve, and a closed row gives `z.infer` a
// clean type with no index signature — which both keeps the server `sendData`
// source (the DB-typed row array) assignable AND lets every read site drop its
// `as unknown as Doctor[]`/`Employee[]` cast and use `EmployeeRow` directly.
const employeeRow = z.object({
  id: z.number(),
  employee_name: z.string(),
  position: z.number().nullable(),
  position_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  percentage: z.boolean(),
  receive_email: z.boolean(),
  get_appointments: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number(),
  appointment_color: z.string().nullable(),
});
export type EmployeeRow = z.infer<typeof employeeRow>;

export const employees = {
  query: z.object({
    getAppointments: z.string().optional(),
    receiveEmail: z.string().optional(),
    percentage: z.string().optional(),
    position: z.string().optional(),
    // Quit (is_active=false) employees are hidden by DEFAULT — the endpoint
    // returns active staff only so every dropdown/recipient list excludes them.
    // Only the Settings management page opts back in with `includeInactive=true`.
    includeInactive: z.string().optional(),
  }),
  response: z.object({
    employees: z.array(employeeRow),
  }),
} as const;
export type EmployeesResponse = z.infer<typeof employees.response>;

// GET /api/positions → { positions: position[] }.
// GET /positions row — the two columns the SELECT projects. `position_name` is
// nullable in the DB (positions.position_name), so the read sites get the honest
// `string | null` instead of an `as unknown as Position[]` cast over it.
const positionRow = z.object({
  id: z.number(),
  position_name: z.string().nullable(),
});
export type PositionRow = z.infer<typeof positionRow>;

export const positions = {
  response: z.object({
    positions: z.array(positionRow),
  }),
} as const;
export type PositionsResponse = z.infer<typeof positions.response>;

// Shared body for create + update — fully enumerated strict `z.object`.
// Strip (not strictObject): `z.object` drops unknown keys so over-posting can't
// reach the DB, without 400ing the real form. Every field the handler reads is
// listed (else validate's writeback would drop it). `sort_order` preprocesses
// ''→undefined so the empty form field falls back to the handler's 999 default.
const employeeBody = z.object({
  employee_name: z.string().min(1, 'Employee name is required'),
  position: z.coerce.number().int().positive(),
  email: z.string().optional(),
  phone: z.string().optional(),
  percentage: z.boolean().optional(),
  receiveEmail: z.boolean().optional(),
  getAppointments: z.boolean().optional(),
  // Employment status — true = currently employed, false = quit/left. Optional in
  // the wire shape so a caller that omits it defaults to active (handler maps
  // undefined → true); the Settings form always sends a real checkbox boolean.
  is_active: z.boolean().optional(),
  sort_order: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().optional()).optional(),
  appointment_color: z.string().nullable().optional(),
});
export type EmployeeBody = z.infer<typeof employeeBody>;

// POST /api/employees → { employeeID } (createEmployee returns the new id).
export const createEmployee = {
  body: employeeBody,
  response: z.object({ employeeID: z.number() }),
} as const;

// PUT /api/employees/:id — void success.
export const updateEmployee = {
  params: idParams('id'),
  body: employeeBody,
} as const;

// DELETE /api/employees/:id — void success.
export const deleteEmployee = {
  params: idParams('id'),
} as const;

// Route-level type aliases for the GET-list query + `:id` param (the validated
// boundaries are `employees.query` / `updateEmployee.params`). Type-only.
export type EmployeeQuery = z.infer<typeof employees.query>;
export type EmployeeParams = z.infer<typeof updateEmployee.params>;
