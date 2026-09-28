/**
 * API contract — staff endpoints (doctor / operator lists).
 *
 * Single source of truth for each staff endpoint's response shape, imported by
 * BOTH the Express routes (relative `.js`) and the React app (`@shared` alias).
 * One exported `const <action> = { response } as const` per endpoint; types via
 * `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 9 (Wave 2): both are READ-ONLY `StaffMember[]` feeds → response-only.
 * Rows carry a stable `id` the selectors key on → `z.array(z.looseObject({ id }))`.
 */
import { z } from 'zod';

// Both /doctors and /operators SELECT exactly id + employee_name (NOT NULL);
// modeling employee_name lets the selectors read it without an unknown-cast.
const staffMemberRow = z.looseObject({ id: z.number(), employee_name: z.string() });

// GET /api/doctors — employees with position 'Doctor'.
export const doctors = {
  response: z.array(staffMemberRow),
} as const;
export type DoctorsResponse = z.infer<typeof doctors.response>;

// GET /api/work-doctors — who a work can be attributed to: active employees with
// position 'Doctor' OR the commission flag (FE-F7-1). Same row shape as /doctors.
export const workDoctors = {
  response: z.array(staffMemberRow),
} as const;
export type WorkDoctorsResponse = z.infer<typeof workDoctors.response>;

// GET /api/operators — all employees.
export const operators = {
  response: z.array(staffMemberRow),
} as const;
export type OperatorsResponse = z.infer<typeof operators.response>;
