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
 * The `EmailConfigBody` stays DYNAMIC `z.looseObject({})` (free-form key set).
 */
import { z } from 'zod';

// GET /api/email/config → { config } (masked config object, dynamic shape).
export const config = {
  response: z.object({ config: z.unknown() }),
} as const;

// POST /api/email/config → { message, updated }. Body free-form key/value map.
export const updateConfig = {
  body: z.looseObject({}),
  response: z.looseObject({ message: z.string() }),
} as const;

// POST /api/email/test-send → { message, messageId }.
export const testSend = {
  body: z.object({ to: z.string().optional() }),
  response: z.looseObject({ message: z.string() }),
} as const;
