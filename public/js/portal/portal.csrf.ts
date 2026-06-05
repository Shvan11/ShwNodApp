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
 */
let token: string | null = null;

/** Header object carrying the portal CSRF token (empty if it can't be fetched). */
export async function portalCsrfHeader(): Promise<Record<string, string>> {
  if (!token) {
    try {
      // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (audit N17): self-contained portal CSRF bootstrap; a plain GET that must not route through the staff funnel.
      const res = await fetch('/api/portal/csrf-token', { credentials: 'same-origin' });
      if (res.ok) token = ((await res.json()) as { csrfToken?: string }).csrfToken ?? null;
    } catch {
      /* best-effort */
    }
  }
  return token ? { 'x-csrf-token': token } : {};
}
