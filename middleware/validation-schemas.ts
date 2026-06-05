/**
 * Re-export barrel — the Zod request-validation primitives now live in
 * `shared/validation.ts` (project root) so they are frontend-safe: importable by
 * both the Express routes AND the React bundle (`@shared` alias), which is
 * required once contract modules relocate the inline `validate()` request
 * schemas. See docs/shared-contract-progress.md + the plan.
 *
 * This barrel preserves the existing `middleware/validation-schemas.js` import
 * sites (10 route files) unchanged.
 */
export * from '../shared/validation.js';
