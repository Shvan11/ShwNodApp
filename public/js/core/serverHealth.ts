/**
 * Liveness probes against the public `/health/basic` — the one endpoint that answers
 * without a session, an envelope or CSRF. Shared by the chair kiosk (reload only once
 * the app is back, FE-F11-15d) and Settings → Database's *Restart App* (reload only once
 * the NEW process is up, FE-F22-6).
 */

/** Seconds the server process has been up, or null when the app isn't answering. */
export async function readServerUptime(): Promise<number | null> {
    try {
        // eslint-disable-next-line no-restricted-syntax -- liveness probe of the public /health/basic, not an API read: no envelope, no CSRF, must not redirect on 401
        const res = await fetch('/health/basic', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        // A proxy's 502 while the app is down is "not answering", not an answer.
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as { uptime?: unknown } | null;
        return typeof body?.uptime === 'number' ? body.uptime : 0;
    } catch {
        return null;
    }
}

/** Is the app itself answering? Any answer, even for an expired session, is a yes. */
export async function appIsReachable(): Promise<boolean> {
    return (await readServerUptime()) !== null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve true once a process STARTED AFTER `requestedAt` (a `Date.now()`) answers, or
 * false after `timeoutMs`. Checking the uptime, not just "it answers", matters: the old
 * process keeps answering for the second or more its graceful shutdown takes (up to a
 * 15 s watchdog), and a reload in that window comes back to the server that is about to
 * exit — then to a proxy error page.
 */
export async function waitForServerRestart(requestedAt: number, timeoutMs = 120_000): Promise<boolean> {
    const deadline = requestedAt + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(2000);
        const uptime = await readServerUptime();
        if (uptime !== null && uptime < (Date.now() - requestedAt) / 1000) return true;
    }
    return false;
}
