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
 * BODY stays LOOSE: create/update are called with an EXPLICIT object literal (no
 * `...req.body` spread), so over-posting is already closed — the contract only
 * enforces the two required scalars (name present, position a positive int).
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

// Shared loose body for create + update (relocated verbatim from the route).
const employeeBody = z.looseObject({
  employee_name: z.string().min(1, 'Employee name is required'),
  position: z.coerce.number().int().positive(),
});

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
