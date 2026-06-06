/**
 * API contract — LocalSend LAN file-sharing endpoints (`/api/localsend/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Every shape is a CLOSED `z.object` (not `z.looseObject`): the server builds each
 * DTO field-for-field from the in-memory device/transfer maps, so there is no
 * long tail to preserve, and a closed schema keeps the service-side `type`
 * aliases assignable to `sendData` without an interface→type flip.
 */
import { z } from 'zod';
import { intId } from '../validation.js';

// ── Core shapes ───────────────────────────────────────────────────────────────

/** A discovered (or probed) LocalSend device on the LAN. */
export const device = z.object({
  fingerprint: z.string(),
  alias: z.string(),
  deviceModel: z.string().optional(),
  deviceType: z.string().optional(),
  ip: z.string(),
  port: z.number(),
  protocol: z.enum(['http', 'https']),
});
export type LocalSendDevice = z.infer<typeof device>;

/** One file the client wants pushed — resolved server-side to a disk path. */
export const sendFileRef = z.object({
  source: z.enum(['patient-file', 'patient-image']),
  personId: intId,
  ref: z.string().min(1),
  displayName: z.string().optional(),
});
export type SendFileRef = z.infer<typeof sendFileRef>;

/** Per-file progress within a transfer. */
const transferFile = z.object({
  name: z.string(),
  status: z.enum(['pending', 'sending', 'completed', 'failed']),
  sentBytes: z.number(),
  totalBytes: z.number(),
});

/** A transfer's live status (polled by the modal). */
export const transferStatus = z.object({
  id: z.string(),
  status: z.enum([
    'pending',
    'pin-required',
    'sending',
    'completed',
    'declined',
    'failed',
    'canceled',
  ]),
  deviceAlias: z.string(),
  files: z.array(transferFile),
  error: z.string().optional(),
});
export type TransferStatus = z.infer<typeof transferStatus>;
export type TransferState = TransferStatus['status'];

// ── Endpoints ─────────────────────────────────────────────────────────────────

// GET /api/localsend/devices[?rescan=1] → { enabled, devices[] }.
export const devices = {
  query: z.object({ rescan: z.coerce.boolean().optional() }),
  response: z.object({ enabled: z.boolean(), devices: z.array(device) }),
} as const;
export type DevicesResponse = z.infer<typeof devices.response>;

// POST /api/localsend/probe → { device }. Manual add / WSL-dev fallback.
export const probe = {
  body: z.object({ ip: z.string().min(1) }),
  response: z.object({ device }),
} as const;
export type ProbeBody = z.infer<typeof probe.body>;

// POST /api/localsend/send → { transferId }. Returns immediately (async transfer).
export const send = {
  body: z.object({
    deviceId: z.string().min(1),
    pin: z.string().optional(),
    files: z.array(sendFileRef).min(1),
  }),
  response: z.object({ transferId: z.string() }),
} as const;
export type SendBody = z.infer<typeof send.body>;

// GET /api/localsend/transfers/:id → TransferStatus. Polled ~1 s by the modal.
export const transfer = {
  params: z.object({ id: z.string() }),
  response: transferStatus,
} as const;

// POST /api/localsend/transfers/:id/cancel → { ok }.
export const cancel = {
  params: z.object({ id: z.string() }),
  response: z.object({ ok: z.boolean() }),
} as const;
