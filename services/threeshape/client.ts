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
import { log } from '../../utils/logger.js';
import { describeFetchError } from '../../utils/fetch-timeout.js';
import { ThreeShapeError } from './errors.js';
import { getValidAccessToken } from './oauth.js';
import { v3Case, v3Media, v3Webhook } from './dtos.js';

// Self-signed LAN cert for the Web Service Host Device — scoped to this client only.
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Hard cap on a Web Service round trip.
 *
 * node-fetch v3 dropped its `timeout` option, so without an explicit signal there is NO bound. A
 * workstation that is OFF refuses the connection and fails fast, which is the case the friendly
 * 'unreachable' message was written for — but the common real-world case is a workstation asleep or
 * on a segmented VLAN, where the SYN is DROPPED and the request hangs for the OS TCP timeout
 * (~75s+). That is past Express's own 30s requestTimeout, so staff saw a generic timeout instead of
 * "check Unite is running", and the request held a connection the whole time.
 *
 * Binary transfers get a longer budget than metadata calls — a volume scan is genuinely large.
 */
const WS_TIMEOUT_MS = 15_000;
const WS_DOWNLOAD_TIMEOUT_MS = 120_000;

interface WsRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Override the default round-trip cap (binary transfers need a longer budget). */
  timeoutMs?: number;
}

function baseUrl(): string {
  const base = config.threeshape.webServiceBase;
  if (!base) {
    throw new ThreeShapeError('not_configured', '3Shape Web Service URL is not set (THREESHAPE_WEBSERVICE_BASE).');
  }
  return base.replace(/\/+$/, '');
}

/** Authenticated fetch to the Web Service; network failures and timeouts → 'unreachable'. */
async function wsFetch(path: string, init: WsRequest = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = { ...(init.headers ?? {}), Authorization: `Bearer ${token}` };
  const timeoutMs = init.timeoutMs ?? WS_TIMEOUT_MS;
  try {
    return await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      agent,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A dropped SYN reaches us as the timeout above rather than a connection error; both mean the
    // same thing to the person at the desk, so both get the same actionable message.
    const detail = describeFetchError(err, timeoutMs);
    throw new ThreeShapeError(
      'unreachable',
      `Could not reach the 3Shape Web Service on the workstation — check Unite is running and signed in, and that port 5492 is open from this server. (${detail})`
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
  // Only IntegrationId + LastName are required by 3Shape; FirstName is optional.
  const details: Record<string, unknown> = {
    IntegrationId: patient.integrationId,
    LastName: patient.lastName,
  };
  if (patient.firstName) details.FirstName = patient.firstName;
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

/**
 * POST /v3/launchUnite — bring the Unite / Dental Desktop app up on the
 * workstation. Empty body (`UniteLaunchParametersDto`). Launching an
 * already-running Unite is a no-op on 3Shape's side. Note: this still goes
 * through the Web Service (:5492), so it can only foreground a Unite whose Web
 * Service is reachable — it cannot revive a fully-down workstation.
 */
export async function launchUnite(): Promise<void> {
  const res = await wsFetch('/v3/launchUnite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  await ensureOk(res, 'launchUnite');
}

// ── Pull: cases + media (read-through, keyed by IntegrationId = person_id) ──

async function getJson(path: string, ctx: string): Promise<unknown> {
  const res = await ensureOk(await wsFetch(path, { headers: { Accept: 'application/json' } }), ctx);
  return res.json();
}

/**
 * Unwrap a 3Shape paged response to its array of items.
 *
 * Field NAMES within an item are confirmed against the official /v3 docs (see dtos.ts); the
 * ENVELOPE key is the part read leniently, because 3Shape's forward-compatibility rule asks for
 * tolerant readers and different endpoints have used different wrappers. A bare array is accepted
 * too.
 *
 * Throws rather than returning `[]` when nothing matches: an unrecognised shape and a genuinely
 * empty result are completely different facts, and rendering "no scans" for a payload we simply
 * failed to read is the kind of silence that hides an upstream change for months.
 */
const ENVELOPE_KEYS = [
  'items', 'Items', 'results', 'Results', 'data', 'Data',
  'cases', 'Cases', 'media', 'Media', 'value',
] as const;

function extractArray(json: unknown, ctx: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ENVELOPE_KEYS) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    // An object with no recognised array key AND no keys at all is an empty page, not a shape change.
    if (Object.keys(o).length === 0) return [];
  }
  throw new ThreeShapeError(
    'api_error',
    `3Shape ${ctx} returned an unrecognised response shape — the Web Service API may have changed.`
  );
}

/**
 * Walk a /v3 offset-paged endpoint to the end, mapping each page's items.
 *
 * The two list endpoints used to request one page (`offset=0`, `pageSize=100`/`200`) and stop —
 * so a long-running ortho patient past that count silently lost their older scans, with nothing in
 * the UI to say so. `HARD_ITEM_CAP` keeps a runaway or mis-paging endpoint from looping forever;
 * hitting it is logged, because at that point the list IS truncated and we should know.
 */
const PAGE_SIZE = 100;
const HARD_ITEM_CAP = 2000;

async function fetchAllPages<T>(
  path: string,
  extraParams: Record<string, string>,
  ctx: string,
  map: (raw: unknown) => T[]
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...extraParams, offset: String(offset), pageSize: String(PAGE_SIZE) });
    const page = extractArray(await getJson(`${path}?${qs.toString()}`, ctx), ctx);
    for (const raw of page) out.push(...map(raw));
    // A short page is the last page. (An exactly-full final page costs one extra empty request.)
    if (page.length < PAGE_SIZE) return out;
    offset += page.length;
    if (offset >= HARD_ITEM_CAP) {
      log.warn(`[3Shape] ${ctx} truncated at the ${HARD_ITEM_CAP}-item cap`, { path, offset });
      return out;
    }
  }
}

/** A case indication, normalized for the UI. */
export interface CaseIndication {
  from: number | null;
  to: number | null;
  type: string | null;
  material: string | null;
}

/** Our normalized case shape (camelCase) — what the contract/UI consume. */
export interface ScanCase {
  /** = 3Shape `caseId`; also the key for the case-thumbnail proxy. */
  id: string;
  workflowStatus: string | null;
  creationDate: string | null;
  /** null when 3Shape returns its no-date sentinel (year < 1900). */
  deliveryDate: string | null;
  lastModifiedDate: string | null;
  uniteCloudLink: string | null;
  indications: CaseIndication[];
}

/** 3Shape uses a 1753-01-01 (.NET/SQL min) sentinel for "no date" — null it out. */
function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const year = Number(d.slice(0, 4));
  return Number.isFinite(year) && year < 1900 ? null : d;
}

/** GET /v3/patients/{integrationId}/cases — every one of a patient's cases (all pages). */
export async function getCases(integrationId: string, workflowStatus?: string): Promise<ScanCase[]> {
  return fetchAllPages<ScanCase>(
    `/v3/patients/${encodeURIComponent(integrationId)}/cases`,
    workflowStatus ? { workflowStatus } : {},
    'list cases',
    (raw) => {
      const parsed = v3Case.safeParse(raw);
      if (!parsed.success || parsed.data.caseId == null) return [];
      const c = parsed.data;
      return [
        {
          id: String(c.caseId),
          workflowStatus: c.workflowStatus ?? null,
          creationDate: c.creationDate ?? null,
          deliveryDate: normalizeDate(c.deliveryDate),
          lastModifiedDate: c.lastModifiedDate ?? null,
          uniteCloudLink: c.uniteCloudLink ?? null,
          indications: (c.indications ?? []).map((i) => ({
            from: i.from ?? null,
            to: i.to ?? null,
            type: i.type ?? null,
            material: i.material ?? null,
          })),
        },
      ];
    }
  );
}

/** A downloadable file inside a media item, normalized for the UI. */
export interface ScanMediaFile {
  /** = 3Shape mediaFiles[].id; pass as `fileId` to the download proxy. */
  id: string | null;
  name: string | null;
  size: number | null;
  fileType: string | null;
  /** Upper | Lower | Bite | null (surface scans only). */
  scanType: string | null;
}

/** Our normalized media shape (camelCase). */
export interface ScanMedia {
  /** = 3Shape media id; also the key for the thumbnail/download proxies. */
  id: string;
  mediaType: string | null; // Image | SurfaceScan | VolumeScan | Pdf | Video
  captureDate: string | null;
  /** Unite Cloud web-viewer link — the only way to view TRIOS scans (not downloadable). */
  uniteCloudLink: string | null;
  files: ScanMediaFile[];
}

/** GET /v3/patients/{integrationId}/media — every one of a patient's media items (all pages). */
export async function getMedia(integrationId: string, type?: string): Promise<ScanMedia[]> {
  return fetchAllPages<ScanMedia>(
    `/v3/patients/${encodeURIComponent(integrationId)}/media`,
    type ? { type } : {},
    'list media',
    (raw) => {
      const parsed = v3Media.safeParse(raw);
      if (!parsed.success || parsed.data.id == null) return [];
      const m = parsed.data;
      return [
        {
          id: String(m.id),
          mediaType: m.mediaType ?? null,
          captureDate: m.captureDate ?? null,
          uniteCloudLink: m.uniteCloudLink ?? null,
          files: (m.mediaFiles ?? []).map((f) => ({
            id: f.id != null ? String(f.id) : null,
            name: f.name ?? null,
            size: f.size != null ? Number(f.size) : null,
            fileType: f.fileType ?? null,
            scanType: f.metadata?.scanType ?? null,
          })),
        },
      ];
    }
  );
}

// ── Binary proxies — return the upstream Response; the route buffers + forwards bytes. ──

/** GET /v3/media/{id}/download — download a media file. */
export async function fetchMediaDownload(id: string, fileId?: string, format?: string): Promise<Response> {
  const qs = new URLSearchParams();
  if (fileId) qs.set('fileId', fileId);
  if (format) qs.set('format', format);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return ensureOk(
    await wsFetch(`/v3/media/${encodeURIComponent(id)}/download${suffix}`, {
      timeoutMs: WS_DOWNLOAD_TIMEOUT_MS,
    }),
    'media download'
  );
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
  return extractArray(json, 'list webhooks').flatMap((raw) => {
    const parsed = v3Webhook.safeParse(raw);
    if (!parsed.success || parsed.data.subscriptionId == null) return [];
    return [
      {
        subscriptionId: String(parsed.data.subscriptionId),
        callbackUrl: parsed.data.callbackUrl ?? null,
        events: parsed.data.subscribedEvents ?? [],
      },
    ];
  });
}

/** DELETE /v3/webhooks/{subscriptionId} — remove a subscription. */
export async function deleteWebhook(subscriptionId: string): Promise<void> {
  const res = await wsFetch(`/v3/webhooks/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
  await ensureOk(res, 'delete webhook');
}
