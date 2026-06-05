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
export const employees = {
  query: z.object({
    getAppointments: z.string().optional(),
    receiveEmail: z.string().optional(),
    percentage: z.string().optional(),
    position: z.string().optional(),
  }),
  response: z.object({
    employees: z.array(z.looseObject({ id: z.number() })),
  }),
} as const;
export type EmployeesResponse = z.infer<typeof employees.response>;

// GET /api/positions → { positions: position[] }.
export const positions = {
  response: z.object({
    positions: z.array(z.looseObject({ id: z.number() })),
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
