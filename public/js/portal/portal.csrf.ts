/**
 * CSRF token for the patient portal (audit H2).
 *
 * The portal is the app's deliberate raw / Zod boundary (CLAUDE.md, audit N17)
 * and keeps its own session + CSRF context, separate from the staff core/http
 * funnel. It fetches a token bound to the portal session from
 * GET /api/portal/csrf-token and echoes it in the `x-csrf-token` header on its
 * one mutation that needs it: logout (login is pre-auth and CSRF-exempt).
 *
 * Without the token the server rejects the logout before the handler runs, so
 * the portal session would survive server-side even though the client cleared
 * its state — hence this is required, not cosmetic.
 *
 * Fetched fresh for every call, never cached: the token is HMAC-bound to the
 * session id, which login regenerates and logout destroys. A token cached for the
 * page's life was the FIRST session's, so the second Sign out in one page load
 * (a parent signing in for two children) was refused 403 and that session stayed
 * signed in (audit FE-F23-4). Logout is rare; one extra GET is nothing.
 */

/** Header object carrying a portal CSRF token for the current session (empty if it can't be fetched). */
export async function portalCsrfHeader(): Promise<Record<string, string>> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (audit N17): self-contained portal CSRF bootstrap; a plain GET that must not route through the staff funnel.
    const res = await fetch('/api/portal/csrf-token', { credentials: 'same-origin' });
    if (!res.ok) return {};
    const token = ((await res.json()) as { csrfToken?: string }).csrfToken;
    return token ? { 'x-csrf-token': token } : {};
  } catch {
    return {};
  }
}
