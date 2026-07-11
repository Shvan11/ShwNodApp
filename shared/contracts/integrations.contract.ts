/**
 * API contract — service-integration management (`/api/integrations/*`).
 *
 * Currently Telegram only (manage the MTProto user login from Settings →
 * Integrations); WhatsApp / Google will join here later. Single source of truth
 * for each endpoint's request + response shapes, imported by BOTH the Express
 * routes (relative `.js`) and the React app (`@shared` alias). One exported
 * `const <action> = { body?, response } as const` per endpoint; types via
 * `z.infer`. See docs/shared-contract-progress.md.
 *
 * Every shape is a CLOSED `z.object` — the server builds each DTO field-for-field
 * from the auth manager, so there is no long tail to preserve.
 */
import { z } from 'zod';

// Authenticated Telegram account summary (all fields nullable — Telegram users
// may have no username/phone visibility).
export const telegramAccount = z
  .object({
    username: z.string().nullable(),
    phone: z.string().nullable(),
    firstName: z.string().nullable(),
  })
  .nullable();
export type TelegramAccount = z.infer<typeof telegramAccount>;

// GET /api/integrations/telegram/status — live auth status.
export const telegramStatus = {
  response: z.object({
    configured: z.boolean(),
    hasSession: z.boolean(),
    authorized: z.boolean(),
    account: telegramAccount,
    pending: z.boolean(),
    error: z.string().nullable(),
  }),
} as const;
export type TelegramStatusResponse = z.infer<typeof telegramStatus.response>;

// POST /api/integrations/telegram/auth/start — request a login code.
export const telegramAuthStart = {
  body: z.object({ phone: z.string().min(1) }),
  response: z.object({ codeSent: z.boolean() }),
} as const;
export type TelegramAuthStartBody = z.infer<typeof telegramAuthStart.body>;

// POST /api/integrations/telegram/auth/code — submit the received code.
export const telegramAuthCode = {
  body: z.object({ code: z.string().min(1) }),
  response: z.object({
    authorized: z.boolean(),
    passwordNeeded: z.boolean(),
    account: telegramAccount,
  }),
} as const;
export type TelegramAuthCodeBody = z.infer<typeof telegramAuthCode.body>;

// POST /api/integrations/telegram/auth/password — submit the 2FA password.
export const telegramAuthPassword = {
  body: z.object({ password: z.string().min(1) }),
  response: z.object({ authorized: z.boolean(), account: telegramAccount }),
} as const;
export type TelegramAuthPasswordBody = z.infer<typeof telegramAuthPassword.body>;

// POST /api/integrations/telegram/auth/cancel — abort an in-progress login.
export const telegramAuthCancel = {
  response: z.object({ ok: z.boolean() }),
} as const;

// POST /api/integrations/telegram/logout — clear the stored session.
export const telegramLogout = {
  response: z.object({ ok: z.boolean() }),
} as const;

// ── Gemini (Google GenAI) ──
// Runtime-managed API key + model (stored in the `options` table, env fallback),
// managed from Settings → Integrations. The raw key is NEVER returned — status
// carries only a masked form. Closed z.object (field-for-field DTO).

// GET /api/integrations/gemini/status — configuration status (masked key).
export const geminiStatus = {
  response: z.object({
    configured: z.boolean(),
    source: z.enum(['db', 'env']).nullable(),
    model: z.string(),
    maskedKey: z.string().nullable(),
  }),
} as const;
export type GeminiStatusResponse = z.infer<typeof geminiStatus.response>;

// POST /api/integrations/gemini/config — save key and/or model. Omitting `apiKey`
// leaves the stored key untouched (so the model can be changed on its own).
export const geminiConfig = {
  body: z.object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }),
  response: geminiStatus.response,
} as const;
export type GeminiConfigBody = z.infer<typeof geminiConfig.body>;

// POST /api/integrations/gemini/test — lightweight connectivity check.
export const geminiTest = {
  response: z.object({ ok: z.boolean(), model: z.string(), error: z.string().nullable() }),
} as const;
export type GeminiTestResponse = z.infer<typeof geminiTest.response>;

// POST /api/integrations/gemini/clear — drop the DB overrides (revert to env).
export const geminiClear = {
  response: geminiStatus.response,
} as const;

// ── 3Shape Unite Web Service (OAuth) ──
// The interactive connect flow itself is browser redirects under /api/auth/3shape
// (login/callback); these endpoints just surface status + disconnect. Closed
// z.object — the status is built field-for-field from the OAuth manager.

// GET /api/integrations/3shape/status — connection status (no live workstation call).
export const threeshapeStatus = {
  response: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    expiresAt: z.string().nullable(),
    scopes: z.string().nullable(),
  }),
} as const;
export type ThreeShapeStatusResponse = z.infer<typeof threeshapeStatus.response>;

// POST /api/integrations/3shape/disconnect — clear the stored tokens.
export const threeshapeDisconnect = {
  response: z.object({ ok: z.boolean() }),
} as const;

// POST /api/integrations/3shape/webhook/register — subscribe the workstation to events.
export const threeshapeWebhookRegister = {
  response: z.object({ ok: z.boolean(), callbackUrl: z.string() }),
} as const;

const threeshapeWebhookSub = z.object({
  subscriptionId: z.string(),
  callbackUrl: z.string().nullable(),
  events: z.array(z.string()),
});

// GET /api/integrations/3shape/webhooks — current subscriptions.
export const threeshapeWebhookList = {
  response: z.object({ subscriptions: z.array(threeshapeWebhookSub) }),
} as const;
export type ThreeShapeWebhookListResponse = z.infer<typeof threeshapeWebhookList.response>;

// DELETE /api/integrations/3shape/webhooks/:subscriptionId — remove a subscription.
export const threeshapeWebhookDelete = {
  params: z.object({ subscriptionId: z.string().min(1) }),
  response: z.object({ ok: z.boolean() }),
} as const;
export type ThreeShapeWebhookDeleteParams = z.infer<typeof threeshapeWebhookDelete.params>;

// ── Google Drive (aligner PDF storage, OAuth) ──
// The interactive connect flow itself is browser redirects under
// /api/admin/google-drive (auth-url/callback); these endpoints just surface
// status + disconnect. Closed z.object — the status is built field-for-field
// from the OAuth token store.

// GET /api/integrations/google-drive/status — connection status (no live Drive call).
export const googleDriveStatus = {
  response: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    folderConfigured: z.boolean(),
    expiresAt: z.string().nullable(),
    scope: z.string().nullable(),
  }),
} as const;
export type GoogleDriveStatusResponse = z.infer<typeof googleDriveStatus.response>;

// POST /api/integrations/google-drive/disconnect — clear the stored tokens.
export const googleDriveDisconnect = {
  response: z.object({ ok: z.boolean() }),
} as const;

// ── Cloudflare Zero Trust (aligner-portal Access email list) ──
// The server mirrors aligner_doctors.doctor_email into the Zero Trust list the
// external portal's Access policy references ("Emails in list"). Sync runs
// automatically on doctor create/update/delete + at boot; these endpoints
// surface status and a manual trigger. Closed z.object — the DTO is built
// field-for-field by services/cloudflare/doctor-email-list.ts.

// Outcome of one sync run.
export const cloudflareListSyncResult = z.object({
  at: z.string(),
  ok: z.boolean(),
  trigger: z.string(),
  emailCount: z.number().nullable(),
  skipped: z.boolean(),
  error: z.string().nullable(),
});
export type CloudflareListSyncResult = z.infer<typeof cloudflareListSyncResult>;

// GET /api/integrations/cloudflare-list/status — configuration + last run outcome.
export const cloudflareListStatus = {
  response: z.object({
    configured: z.boolean(),
    lastSync: cloudflareListSyncResult.nullable(),
  }),
} as const;
export type CloudflareListStatusResponse = z.infer<typeof cloudflareListStatus.response>;

// POST /api/integrations/cloudflare-list/sync — push the doctor emails now;
// returns the refreshed status (the run's outcome lands in lastSync).
export const cloudflareListSync = {
  response: cloudflareListStatus.response,
} as const;
