/**
 * The patient portal's read path: one raw `fetch` + Zod parse for every tab.
 *
 * The portal is the app's deliberate raw / Zod boundary (CLAUDE.md, audit N17), so it
 * does not use the staff `core/http` funnel. Each tab used to carry its own copy of
 * this, and none of them handled a 401: when the session ended (24 h idle, or the
 * clinic disabling access or changing the PIN — FE-F23-3), every tab printed
 * "Authentication required" under the patient's name and only Sign out led back to
 * the sign-in screen (audit FE-F23-10). A 401 now calls the handler `PortalApp`
 * registers, which returns to sign-in.
 */
import type { z } from 'zod';
import { getPublicBranding } from '@shared/contracts/branding.contract';

let onSessionEnded: (() => void) | null = null;

/** `PortalApp` registers what a 401 does (drop to the sign-in screen). */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  onSessionEnded = handler;
}

type Envelope = { success: boolean; error?: string };

export type PortalRead<T> = { ok: true; data: T } | { ok: false; error: string | null };

/**
 * GET `url` with the portal session and validate the body. Resolves `{ ok: false }`
 * with the server's message (or null) on any failure, and throws only when the
 * server can't be reached, which each tab reports as such.
 */
export async function portalGet<S extends z.ZodType<Envelope>>(
  url: string,
  schema: S
): Promise<PortalRead<z.infer<S>>> {
  // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and reads res.ok/status; the staff funnel would obscure that.
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    onSessionEnded?.();
    return { ok: false, error: null };
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success || !parsed.data.success) {
    return { ok: false, error: (parsed.success ? parsed.data.error : undefined) ?? null };
  }
  return { ok: true, data: parsed.data };
}

/**
 * The clinic's configured display name, or null (unset, or unreachable). Read before
 * sign-in through `GET /api/branding/public`; the portal said "Shwan Orthodontics"
 * on every install (audit FE-F23-8).
 */
export async function fetchClinicName(): Promise<string | null> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (audit N17): pre-auth read, validated against the shared contract below.
    const res = await fetch('/api/branding/public', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const data = (body as { data?: unknown } | null)?.data;
    const parsed = getPublicBranding.response.safeParse(data);
    return parsed.success ? (parsed.data.clinicName?.trim() || null) : null;
  } catch {
    return null;
  }
}
