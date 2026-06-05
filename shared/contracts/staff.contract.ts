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

const staffMemberRow = z.looseObject({ id: z.number() });

// GET /api/doctors — employees with position 'Doctor'.
export const doctors = {
  response: z.array(staffMemberRow),
} as const;
export type DoctorsResponse = z.infer<typeof doctors.response>;

// GET /api/operators — all employees.
export const operators = {
  response: z.array(staffMemberRow),
} as const;
export type OperatorsResponse = z.infer<typeof operators.response>;
