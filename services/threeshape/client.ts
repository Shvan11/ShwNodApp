/**
 * 3Shape Unite Web Service (`/v3`) client — server-side calls to the workstation
 * Host Device (`config.threeshape.webServiceBase`, e.g. https://WORK_PC:5492).
 *
 * The Host Device serves a SELF-SIGNED cert (CN "3Shape Web Service"), so a
 * dedicated HTTPS agent with `rejectUnauthorized:false` is used — scoped to THIS
 * client only, never a global TLS bypass. Every call carries a Bearer token from
 * the OAuth layer (oauth.getValidAccessToken). Network failures map to a friendly
 * 'unreachable' error (Unite off / not signed in / firewall), 401 maps to
 * 'reconnect_required'.
 */
import https from 'node:https';
import fetch, { type Response } from 'node-fetch';
import config from '../../config/config.js';
import { ThreeShapeError } from './errors.js';
import { getValidAccessToken } from './oauth.js';
import { v3Case, v3Media, v3Webhook } from './dtos.js';

// Self-signed LAN cert for the Web Service Host Device — scoped to this client only.
const agent = new https.Agent({ rejectUnauthorized: false });

interface WsRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

function baseUrl(): string {
  const base = config.threeshape.webServiceBase;
  if (!base) {
    throw new ThreeShapeError('not_configured', '3Shape Web Service URL is not set (THREESHAPE_WEBSERVICE_BASE).');
  }
  return base.replace(/\/+$/, '');
}

/** Authenticated fetch to the Web Service; network failures → 'unreachable'. */
async function wsFetch(path: string, init: WsRequest = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = { ...(init.headers ?? {}), Authorization: `Bearer ${token}` };
  try {
    return await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      agent,
    });
  } catch (err) {
    throw new ThreeShapeError(
      'unreachable',
      `Could not reach the 3Shape Web Service on the workstation — check Unite is running and signed in, and that port 5492 is open from this server. (${(err as Error).message})`
    );
  }
}

/** Throw a typed error for a non-2xx response, else pass it through. */
async function ensureOk(res: Response, ctx: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401) {
    throw new ThreeShapeError('reconnect_required', '3Shape rejected the request — reconnect in Settings → Integrations.', 401);
  }
  const body = await res.text().catch(() => '');
  throw new ThreeShapeError('api_error', `3Shape ${ctx} failed (HTTP ${res.status}). ${body.slice(0, 200)}`.trim(), res.status);
}

/** GET /version — Bearer smoke test (200 with a valid token, 401 without). */
export async function version(): Promise<string> {
  const res = await ensureOk(await wsFetch('/version'), 'version');
  return res.text();
}

/** Patient demographics for a workflow push. `integrationId` is the app's stable key. */
export interface InitiateWorkflowPatient {
  integrationId: string;
  firstName: string;
  lastName: string;
  patientId?: string;
  email?: string | null;
  phoneNumber?: string | null;
  /** 'YYYY-MM-DD' or null. */
  dateOfBirth?: string | null;
  gender?: number | null;
  notes?: string | null;
}

/** POST /v3/patients/initiate-workflow — push the patient + start a scan workflow. */
export async function initiateWorkflow(patient: InitiateWorkflowPatient): Promise<void> {
  // Omit null/empty optionals so we never send empty fields to the scanner.
  const details: Record<string, unknown> = {
    IntegrationId: patient.integrationId,
    FirstName: patient.firstName,
    LastName: patient.lastName,
  };
  if (patient.patientId) details.PatientId = patient.patientId;
  if (patient.email) details.Email = patient.email;
  if (patient.phoneNumber) details.PhoneNumber = patient.phoneNumber;
  if (patient.dateOfBirth) details.DateOfBirth = patient.dateOfBirth;
  if (patient.gender != null) details.Gender = patient.gender;
  if (patient.notes) details.Notes = patient.notes;

  const res = await wsFetch('/v3/patients/initiate-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ PatientDetails: details }),
  });
  await ensureOk(res, 'initiate-workflow');
}

// ── Pull: cases + media (read-through, keyed by IntegrationId = person_id) ──

async function getJson(path: string, ctx: string): Promise<unknown> {
  const res = await ensureOk(await wsFetch(path, { headers: { Accept: 'application/json' } }), ctx);
  return res.json();
}

/** 3Shape paged endpoints wrap items in an envelope whose exact key we don't know
 *  for sure — accept a bare array or a common items/results/data field. */
function extractArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ['items', 'Items', 'results', 'Results', 'data', 'Data', 'cases', 'Cases', 'media', 'Media', 'value']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/** Our normalized case shape (camelCase) — what the contract/UI consume. */
export interface ScanCase {
  id: string;
  name: string | null;
  workflowId: string | null;
  itemNames: string[];
  isScanned: boolean;
  isModelled: boolean;
}

/** GET /v3/patients/{integrationId}/cases — a patient's cases (paged; first 100). */
export async function getCases(integrationId: string, workflowStatus?: string): Promise<ScanCase[]> {
  const qs = new URLSearchParams({ offset: '0', pageSize: '100' });
  if (workflowStatus) qs.set('workflowStatus', workflowStatus);
  const json = await getJson(
    `/v3/patients/${encodeURIComponent(integrationId)}/cases?${qs.toString()}`,
    'list cases'
  );
  return extractArray(json).flatMap((raw) => {
    const parsed = v3Case.safeParse(raw);
    if (!parsed.success || parsed.data.Id == null) return [];
    const c = parsed.data;
    return [
      {
        id: String(c.Id),
        name: c.Name ?? null,
        workflowId: c.WorkflowId != null ? String(c.WorkflowId) : null,
        itemNames: c.ItemNames ?? [],
        isScanned: c.IsScanned ?? false,
        isModelled: c.IsModelled ?? false,
      },
    ];
  });
}

/** Our normalized media shape (camelCase). */
export interface ScanMedia {
  id: string;
  name: string | null;
  type: string | null;
  fileName: string | null;
  createdAt: string | null;
}

/** GET /v3/patients/{integrationId}/media — a patient's media files (paged; first 200). */
export async function getMedia(integrationId: string, type?: string): Promise<ScanMedia[]> {
  const qs = new URLSearchParams({ offset: '0', pageSize: '200' });
  if (type) qs.set('type', type);
  const json = await getJson(
    `/v3/patients/${encodeURIComponent(integrationId)}/media?${qs.toString()}`,
    'list media'
  );
  return extractArray(json).flatMap((raw) => {
    const parsed = v3Media.safeParse(raw);
    if (!parsed.success || parsed.data.Id == null) return [];
    const m = parsed.data;
    return [
      {
        id: String(m.Id),
        name: m.Name ?? null,
        type: m.Type ?? null,
        fileName: m.FileName ?? null,
        createdAt: m.CreatedAt ?? null,
      },
    ];
  });
}

// ── Binary proxies — return the upstream Response; the route buffers + forwards bytes. ──

/** GET /v3/media/{id}/download — download a media file. */
export async function fetchMediaDownload(id: string, fileId?: string, format?: string): Promise<Response> {
  const qs = new URLSearchParams();
  if (fileId) qs.set('fileId', fileId);
  if (format) qs.set('format', format);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return ensureOk(await wsFetch(`/v3/media/${encodeURIComponent(id)}/download${suffix}`), 'media download');
}

/** GET /v3/media/{id}/thumbnail — a media thumbnail image. */
export async function fetchMediaThumbnail(id: string, imageFormat?: string): Promise<Response> {
  const qs = imageFormat ? `?imageFormat=${encodeURIComponent(imageFormat)}` : '';
  return ensureOk(await wsFetch(`/v3/media/${encodeURIComponent(id)}/thumbnail${qs}`), 'media thumbnail');
}

/** GET /v3/case/{caseId}/thumbnail — a case thumbnail image. */
export async function fetchCaseThumbnail(caseId: string): Promise<Response> {
  return ensureOk(await wsFetch(`/v3/case/${encodeURIComponent(caseId)}/thumbnail`), 'case thumbnail');
}

// ── Webhooks (Phase 3) ──

/** Events we subscribe to by default (the scan/case/media lifecycle). */
const DEFAULT_WEBHOOK_EVENTS = ['case_created', 'case_updated', 'media_added', 'scan_completed'];

export interface WebhookSubscription {
  subscriptionId: string;
  callbackUrl: string | null;
  events: string[];
}

/** POST /v3/webhooks — register (or update) a webhook subscription. */
export async function registerWebhook(opts: {
  callbackUrl: string;
  authSchema: string;
  authValue: string;
  events?: string[];
}): Promise<void> {
  const res = await wsFetch('/v3/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      CallbackUrl: opts.callbackUrl,
      AuthSchema: opts.authSchema,
      AuthValue: opts.authValue,
      SubscribedEvents: opts.events ?? DEFAULT_WEBHOOK_EVENTS,
    }),
  });
  await ensureOk(res, 'register webhook');
}

/** GET /v3/webhooks — list current subscriptions. */
export async function listWebhooks(): Promise<WebhookSubscription[]> {
  const json = await getJson('/v3/webhooks', 'list webhooks');
  return extractArray(json).flatMap((raw) => {
    const parsed = v3Webhook.safeParse(raw);
    if (!parsed.success || parsed.data.SubscriptionId == null) return [];
    return [
      {
        subscriptionId: String(parsed.data.SubscriptionId),
        callbackUrl: parsed.data.CallbackUrl ?? null,
        events: parsed.data.SubscribedEvents ?? [],
      },
    ];
  });
}

/** DELETE /v3/webhooks/{subscriptionId} — remove a subscription. */
export async function deleteWebhook(subscriptionId: string): Promise<void> {
  const res = await wsFetch(`/v3/webhooks/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
  await ensureOk(res, 'delete webhook');
}
