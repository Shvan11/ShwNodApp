/**
 * API contract — email-api endpoints (`/api/email/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). See docs/shared-contract-progress.md.
 *
 * Phase 14 (Wave 2) — ROOT MIGRATION (partial). Only the EmailSettings-consumed
 * endpoints (`config` GET/POST, `test-send`) migrate from the MANUAL top-level
 * envelope onto `sendData` — their consumer rides the core/http funnel, which
 * unwraps `{success,data}` → payload (the EmailSettings `.success`-at-2xx checks
 * are dropped). DELIBERATELY LEFT RAW:
 *   - `POST /send-appointments` — consumed by the RAW whatsapp `apiClient` (reads
 *     top-level `appointmentCount`/`success`), which does NOT unwrap; nesting it
 *     would hide those fields. Stays a top-level manual envelope.
 *   - `GET /test` — semantic-success at 200 (the consumer reads `data.success` as
 *     the test result, not as a transport flag).
 * The `EmailConfigBody` stays DYNAMIC `z.looseObject` (free-form key set; the known
 * SMTP fields are listed so the handler can read them typed, the loose tail
 * preserves any other config key). The route's hand-written `EmailConfigBody`/
 * `TestSendBody` interfaces are dropped for the `z.infer` exports below.
 */
import { z } from 'zod';

// GET /api/email/config → { config } (masked config object, dynamic shape).
export const config = {
  response: z.object({ config: z.unknown() }),
} as const;

// POST /api/email/config → { message, updated }. Body is a free-form key/value map
// (the known SMTP keys enumerated; loose tail preserved).
export const updateConfig = {
  // Known SMTP keys enumerated; the typed `.catchall` preserves any other config
  // key AND makes the inferred index `string|number|boolean|undefined` (matching
  // the email service's `Partial<EmailConfig>` param — a plain looseObject would
  // infer an `unknown` index that isn't assignable there).
  body: z
    .object({
      smtp_host: z.string().optional(),
      smtp_port: z.coerce.number().optional(),
      smtp_secure: z.boolean().optional(),
      smtp_user: z.string().optional(),
      smtp_password: z.string().optional(),
      from_address: z.string().optional(),
      from_name: z.string().optional(),
    })
    .catchall(z.union([z.string(), z.number(), z.boolean(), z.undefined()])),
  response: z.looseObject({ message: z.string() }),
} as const;
export type EmailConfigBody = z.infer<typeof updateConfig.body>;

// POST /api/email/test-send → { message, messageId }.
export const testSend = {
  body: z.object({ to: z.string().optional() }),
  response: z.looseObject({ message: z.string() }),
} as const;
export type TestSendBody = z.infer<typeof testSend.body>;
