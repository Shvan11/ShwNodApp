/**
 * API contract — lookup (reference-data) endpoints.
 *
 * Single source of truth for each lookup endpoint's response shape, imported by
 * BOTH the Express routes (relative `.js`) and the React app (`@shared` alias).
 * One exported `const <action> = { response } as const` per endpoint; types via
 * `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 6 (Wave 2): these routes are **pre-auth, READ-ONLY dropdown feeds**
 * (`routes/api/lookup.routes.ts`, mounted before the auth gate) — so they are
 * **response-only** (never add a `body`/mutation here). Each row carries a stable
 * id the dropdown consumers key on, so model `z.array(z.looseObject({ <id> }))` —
 * the classic N13 (array-vs-object) victim where a row-id guard earns its keep.
 * `looseObject` keeps the long-tail row fields the funnel-parsed payload feeds.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// All six are bare arrays of `{ id, name }`-style lookup rows.
// patient-queries.ts#{getReferralSources,getPatientTypes,getAddresses,getGenders}
// → LookupItem { id, name }; work-queries.ts#getImplantManufacturers → { id, name };
// alert-queries.ts#getAlertTypes → { alert_type_id, type_name }.
// ---------------------------------------------------------------------------

const idNameRow = z.looseObject({ id: z.number() });

export const referralSources = {
  response: z.array(idNameRow),
} as const;
export type ReferralSourcesResponse = z.infer<typeof referralSources.response>;

export const patientTypes = {
  response: z.array(idNameRow),
} as const;
export type PatientTypesResponse = z.infer<typeof patientTypes.response>;

export const addresses = {
  response: z.array(idNameRow),
} as const;
export type AddressesResponse = z.infer<typeof addresses.response>;

export const genders = {
  response: z.array(idNameRow),
} as const;
export type GendersResponse = z.infer<typeof genders.response>;

export const implantManufacturers = {
  response: z.array(idNameRow),
} as const;
export type ImplantManufacturersResponse = z.infer<typeof implantManufacturers.response>;

// alert_types rows are keyed by `alert_type_id` (the consumer reads it).
export const alertTypes = {
  response: z.array(z.looseObject({ alert_type_id: z.number() })),
} as const;
export type AlertTypesResponse = z.infer<typeof alertTypes.response>;
