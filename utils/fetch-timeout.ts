/**
 * Timeout helpers for the outbound HTTP clients (3Shape, WebCeph, LocalSend, Cloudflare).
 *
 * `node-fetch` v3 dropped its `timeout` option and never replaced it, so an outbound call with no
 * explicit signal has NO upper bound. That matters more than it sounds: a host that REFUSES the
 * connection fails in milliseconds — the case the friendly "is the workstation on?" messages were
 * written for — but a host that DROPS the packet (asleep, firewalled, on another VLAN) hangs for
 * the OS TCP timeout, ~75s and up. That is past Express's own 30s `requestTimeout`, so the caller
 * saw a generic timeout instead of the actionable message, and the request held a connection the
 * whole time it waited.
 *
 * Every outbound client now passes `AbortSignal.timeout(...)`. These two helpers keep the resulting
 * error handling from being re-derived (and diverging) in each of them.
 */

/**
 * Did this error come from an AbortSignal — our own timeout, or a caller's cancellation?
 *
 * `AbortSignal.timeout()` rejects with a `TimeoutError`, while `AbortController.abort()` rejects
 * with an `AbortError`; both surface through fetch as a DOMException whose `name` is the only
 * reliable discriminator (the message differs between runtimes and undici versions).
 */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError';
}

/**
 * A short cause phrase for a failed fetch, for splicing into a caller-facing message.
 *
 * A timeout and a refused connection are the same fact to the person at the desk — "we couldn't
 * talk to it" — so both should reach them as the client's own actionable text rather than as a raw
 * exception string.
 */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (isAbortError(err)) return `no response within ${Math.round(timeoutMs / 1000)}s`;
  return err instanceof Error ? err.message : String(err);
}
