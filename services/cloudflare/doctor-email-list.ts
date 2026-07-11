/**
 * Cloudflare Zero Trust list sync — external aligner-portal access control.
 *
 * The external aligner portal (aligner-portal-external, Cloudflare Pages) sits
 * behind a Cloudflare Access policy whose include rule is "Emails in list",
 * pointing at a Zero Trust list (Zero Trust → My Team → Lists). This service
 * keeps that list in lockstep with `aligner_doctors.doctor_email`, so granting
 * or revoking portal access is just editing the doctor in Settings → Aligner
 * Doctors — no Cloudflare dashboard visit.
 *
 * Sync is a full replace: `PUT /accounts/{account}/gateway/lists/{list}` with a
 * non-empty `items` array overwrites the entire item set, so every run is
 * idempotent regardless of which earlier runs succeeded. A GET first preserves
 * the list's dashboard-assigned name/description (PUT requires `name`).
 *
 * Failures never propagate to the doctor CRUD request — they log an error and
 * the next doctor edit (or the boot reconcile in index.ts) converges the list.
 * Disabled unless all three CLOUDFLARE_* env vars are set (config.cloudflare).
 */

import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import * as alignerQueries from '../database/queries/aligner-queries.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 15_000;

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

interface ZeroTrustListMeta {
  name?: string;
  description?: string;
}

export function isDoctorEmailListSyncEnabled(): boolean {
  const { apiToken, accountId, doctorEmailListId } = config.cloudflare;
  return Boolean(apiToken && accountId && doctorEmailListId);
}

/** Outcome of one sync run — surfaced in Settings → Integrations. */
export interface DoctorEmailListSyncResult {
  /** ISO timestamp of when the run finished. */
  at: string;
  ok: boolean;
  /** What started the run ("doctor 12 updated", "boot reconcile", "manual (Settings)"…). */
  trigger: string;
  /** Emails pushed to the list; null when the run failed before counting. */
  emailCount: number | null;
  /** True when the run was a no-op because aligner_doctors has no emails. */
  skipped: boolean;
  error: string | null;
}

let inFlight: Promise<DoctorEmailListSyncResult> | null = null;
let rerunQueued = false;
let lastResult: DoctorEmailListSyncResult | null = null;

/** Current configuration + last run outcome (for GET /api/integrations/cloudflare-list/status). */
export function getDoctorEmailListSyncStatus(): {
  configured: boolean;
  lastSync: DoctorEmailListSyncResult | null;
} {
  return { configured: isDoctorEmailListSyncEnabled(), lastSync: lastResult };
}

/** Runs one sync, never rejects — failures become an ok:false result + error log. */
async function execute(trigger: string): Promise<DoctorEmailListSyncResult> {
  let result: DoctorEmailListSyncResult;
  try {
    result = await syncNow(trigger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Cloudflare doctor email-list sync failed', { trigger, error: message });
    result = {
      at: new Date().toISOString(),
      ok: false,
      trigger,
      emailCount: null,
      skipped: false,
      error: message,
    };
  }
  lastResult = result;
  return result;
}

/** Claims the in-flight slot and chains the queued rerun (shared by both entry points). */
function start(trigger: string): Promise<DoctorEmailListSyncResult> {
  const run = execute(trigger).finally(() => {
    inFlight = null;
    if (rerunQueued) {
      rerunQueued = false;
      start(`rerun after ${trigger}`);
    }
  });
  inFlight = run;
  return run;
}

/**
 * Fire-and-forget: reconcile the Cloudflare list with aligner_doctors.
 * Coalesces concurrent triggers (one in-flight sync + at most one queued rerun)
 * so rapid doctor edits can't race two PUTs against each other.
 */
export function scheduleDoctorEmailListSync(trigger: string): void {
  if (!isDoctorEmailListSyncEnabled()) return;
  if (inFlight) {
    rerunQueued = true;
    return;
  }
  start(trigger);
}

/**
 * Awaitable manual run (the Settings "Sync now" button). Waits out any in-flight
 * run first so the caller always gets a fresh outcome. Caller must check
 * isDoctorEmailListSyncEnabled(); the returned result carries ok/error rather
 * than throwing.
 */
export async function runDoctorEmailListSyncNow(
  trigger: string
): Promise<DoctorEmailListSyncResult> {
  while (inFlight) await inFlight;
  return start(trigger);
}

async function cfFetch<T>(
  path: string,
  init?: { method: string; body: string }
): Promise<CloudflareEnvelope<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as CloudflareEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    const detail = body?.errors
      ?.map((e) => [e.code, e.message].filter(Boolean).join(' '))
      .join('; ');
    throw new Error(
      `Cloudflare API ${init?.method ?? 'GET'} ${path} → HTTP ${res.status}${detail ? ` (${detail})` : ''}`
    );
  }
  return body;
}

async function syncNow(trigger: string): Promise<DoctorEmailListSyncResult> {
  const { accountId, doctorEmailListId } = config.cloudflare;
  const doctors = await alignerQueries.getAllDoctors();
  const emails = [
    ...new Set(
      doctors
        .map((d) => d.doctor_email?.trim().toLowerCase())
        .filter((e): e is string => !!e)
    ),
  ].sort();

  if (emails.length === 0) {
    // The API only overwrites items when the array is NON-empty, so an empty
    // set can't be pushed — if the last emailed doctor was genuinely removed,
    // clear the list in the Zero Trust dashboard by hand.
    log.warn('Cloudflare doctor email-list sync skipped: no doctor emails in aligner_doctors', {
      trigger,
    });
    return {
      at: new Date().toISOString(),
      ok: true,
      trigger,
      emailCount: 0,
      skipped: true,
      error: null,
    };
  }

  const listPath = `/accounts/${accountId}/gateway/lists/${doctorEmailListId}`;
  // PUT requires `name`; read it first so the dashboard-assigned name/description survive.
  const current = await cfFetch<ZeroTrustListMeta>(listPath);
  await cfFetch(listPath, {
    method: 'PUT',
    body: JSON.stringify({
      name: current.result?.name || 'Aligner Portal Doctors',
      ...(current.result?.description ? { description: current.result.description } : {}),
      items: emails.map((value) => ({ value })),
    }),
  });

  log.info('Cloudflare doctor email-list synced', { trigger, emailCount: emails.length });
  return {
    at: new Date().toISOString(),
    ok: true,
    trigger,
    emailCount: emails.length,
    skipped: false,
    error: null,
  };
}
