/**
 * API contract — clinic branding (header logo + display name).
 *
 * The logo and name shown in the universal header are per-deployment
 * customizable from Settings → General (this is a multi-clinic product; every
 * center brands its own instance). Both values persist as rows in the `options`
 * table — `CLINIC_LOGO` holds the stored logo filename, `CLINIC_NAME` the
 * display name — while the logo bytes live on the clinic disk volume
 * (`clinic1/branding/`, see services/files/clinic-branding.ts) and stream through
 * `GET /api/branding/logo`.
 *
 * SSoT for each endpoint's request + response, imported by BOTH the Express
 * route (relative `.js`) and the React app (`@shared` alias). See CLAUDE.md
 * "Shared API contracts".
 */
import { z } from 'zod';

// Fully-modeled, closed container owned end-to-end here, so a plain `z.object`
// (not `looseObject`) is correct. `logo` is the servable URL of the current logo
// (`/api/branding/logo?v=<token>`), or null when none is set; `clinicName` is the
// configured display name, or null when unset (the header falls back to a default).
const brandingResponse = z.object({
  clinicName: z.string().nullable(),
  logo: z.string().nullable(),
});
export type Branding = z.infer<typeof brandingResponse>;

// GET /api/branding → current branding.
export const getBranding = {
  response: brandingResponse,
} as const;

// PUT /api/branding → set the clinic display name. An empty string clears it
// (header reverts to the built-in default). Trimmed + capped so it fits the header.
export const updateBranding = {
  body: z.object({ clinicName: z.string().trim().max(80) }),
  response: brandingResponse,
} as const;
export type UpdateBrandingBody = z.infer<typeof updateBranding.body>;

// POST /api/branding/logo → multipart image upload (field `logo`, no JSON body).
// Returns the refreshed branding (with the new logo URL).
export const uploadLogo = {
  response: brandingResponse,
} as const;

// DELETE /api/branding/logo → remove the custom logo (revert to name/default).
export const deleteLogo = {
  response: brandingResponse,
} as const;
