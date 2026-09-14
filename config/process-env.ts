/**
 * Process-level environment defaults, applied BEFORE anything else loads.
 *
 * Two of them: NODE_ENV and TZ. Both must be settled before the first module that
 * reads them is evaluated, which is why this is the FIRST import in `index.ts` —
 * ESM hoists and fully evaluates every `import` before any statement in the
 * importing module's body, so a `process.env.X ??= …` written at the top of
 * index.ts runs far too late (it used to, for NODE_ENV: `middleware/csrf.ts` had
 * already computed `isProduction` as false and issued the CSRF cookie WITHOUT
 * `secure`, while the session cookie set later in the same boot got `secure: true`,
 * and `utils/logger.ts` had already added its console transport — both only on the
 * documented `npm start` path, which sets TZ but not NODE_ENV).
 *
 * ── NODE_ENV ──────────────────────────────────────────────────────────────────
 * Defaults to 'production' so an unset value is the SAFE value (secure cookies,
 * no console transport, no dev-only error detail). `npm run dev:server` sets
 * NODE_ENV=development explicitly, so development is always opt-in.
 *
 * ── TZ ────────────────────────────────────────────────────────────────────────
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
 * other launch path (bare `node`/`tsx`). Node honors a runtime `process.env.TZ` change
 * for subsequent `Date` operations.
 */

// Default to production for safety — an unset NODE_ENV must not mean "development".
process.env.NODE_ENV ??= 'production';

if (!process.env.TZ) {
  process.env.TZ = 'Asia/Baghdad';
}

export {};
