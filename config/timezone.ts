/**
 * Pin the Node process timezone to the clinic's wall-clock BEFORE anything else loads.
 *
 * The whole date layer interprets `timestamp` values in the *process's local* timezone:
 * the pg parser (`services/database/kysely.ts` — `new Date('YYYY-MM-DD HH:MM:SS')`),
 * `utils/date.ts#toDateOnly`, the `isToday` edit-window check, and server-side
 * `to_char(...)` all assume that local zone is the clinic's (Asia/Baghdad, UTC+3, no DST).
 * On the current Windows host that happens to be true. A future Linux/cloud server
 * defaults to **UTC**, which would silently shift every stored timestamp (and roll
 * date-only values back a day). Pinning TZ makes the assumption explicit and
 * host-independent — the design deliberately uses `timestamp WITHOUT time zone`
 * (single-clinic wall-clock), so the process must agree on which wall clock that is.
 *
 * Launch-level env sets this before Node even starts (the Windows service `env` array
 * and `cross-env TZ=...` in the npm scripts). This guard is the safety net for any
 * other launch path (bare `node`/`tsx`). It is imported FIRST in `index.ts`: in ESM the
 * first import is evaluated before later imports, so TZ is set before any module reads
 * it. Node honors a runtime `process.env.TZ` change for subsequent `Date` operations.
 */
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Baghdad';
}

export {};
