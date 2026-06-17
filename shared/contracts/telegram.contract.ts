/**
 * API contract — Telegram file-sharing endpoints (`/api/telegram/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Reuses the LocalSend `sendFileRef` shape — the browser sends the same untrusted
 * `{source, personId, ref}` for any share target, resolved server-side by
 * `services/files/share-ref.ts`. Every shape is a CLOSED `z.object`: the server
 * builds each DTO field-for-field, so there is no long tail to preserve.
 */
import { z } from 'zod';
import { sendFileRef } from './localsend.contract.js';

// GET /api/telegram/status → { enabled }. Whether the server can send via Telegram.
export const status = {
  response: z.object({ enabled: z.boolean() }),
} as const;
export type StatusResponse = z.infer<typeof status.response>;

// POST /api/telegram/send → { enabled, jobId, total }.
// Big-file uploads can run for minutes (and MUST NOT be bound to the request's
// 30s timeout), so this kicks off a background send job and returns its id
// immediately; the client polls `progress` below for per-file upload status.
export const send = {
  body: z.object({
    phone: z.string().min(1),
    files: z.array(sendFileRef).min(1),
  }),
  response: z.object({
    enabled: z.boolean(),
    jobId: z.string(),
    total: z.number(),
  }),
} as const;
export type SendBody = z.infer<typeof send.body>;
export type SendResponse = z.infer<typeof send.response>;

// GET /api/telegram/send/:jobId → live snapshot of a running/finished send job.
// Polled by the share modal to drive a per-file progress bar; the job is held
// in server memory for a short TTL after it finishes so the final poll lands.
export const progress = {
  params: z.object({ jobId: z.string().min(1) }),
  response: z.object({
    status: z.enum(['running', 'done']),
    total: z.number(),
    /** Files successfully sent so far. */
    sent: z.number(),
    /** 1-based index of the file currently uploading (clamped to total). */
    index: z.number(),
    /** Display name of the file currently uploading. */
    name: z.string(),
    /** Upload fraction (0..1) of the current file. */
    fileProgress: z.number(),
    /** Per-file failure messages accumulated so far. */
    errors: z.array(z.string()),
  }),
} as const;
export type ProgressParams = z.infer<typeof progress.params>;
export type ProgressResponse = z.infer<typeof progress.response>;
