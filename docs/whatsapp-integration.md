# WhatsApp integration — comprehensive guide

> **What this is.** The end-to-end guide to how WhatsApp messaging works in this app: the
> unofficial library we drive, the client lifecycle, QR authentication, message sending +
> delivery tracking, the realtime (SSE) plumbing, the React frontend, and — the part that
> matters most — the **robustness machinery** that exists *only* because the underlying
> library is fragile by nature.
>
> **Read this before touching** anything under `services/messaging/`, the `/api/wa/*` routes
> (`routes/api/whatsapp.routes.ts`), the WhatsApp SSE channel, or the auth/send pages
> (`public/js/routes/WhatsAppAuth.tsx`, `WhatsAppSend.tsx`). Most of the non-obvious code is
> a workaround for a specific, documented library failure — removing it reintroduces the bug.

---

## Contents

1. [The library reality (read first)](#1-the-library-reality-read-first)
2. [Where everything lives](#2-where-everything-lives)
3. [The client state machine](#3-the-client-state-machine)
4. [How initialization is triggered (4 paths) + the kill-switch](#4-how-initialization-is-triggered-4-paths--the-kill-switch)
5. [The initialization sequence](#5-the-initialization-sequence)
6. [QR authentication flow](#6-qr-authentication-flow)
7. [The robustness machinery (the important part)](#7-the-robustness-machinery-the-important-part)
8. [Realtime: the SSE channel](#8-realtime-the-sse-channel)
9. [The frontend](#9-the-frontend)
10. [Message sending & delivery tracking](#10-message-sending--delivery-tracking)
11. [HTTP routes (`/api/wa/*`)](#11-http-routes-apiwa)
12. [Disconnect, recovery & shutdown](#12-disconnect-recovery--shutdown)
13. [Health check](#13-health-check)
14. [Gotchas & non-obvious behavior](#14-gotchas--non-obvious-behavior)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. The library reality (read first)

We send WhatsApp messages with **[`whatsapp-web.js`](https://github.com/wwebjs/whatsapp-web.js)** — an
**unofficial, reverse-engineered** library that automates the **WhatsApp Web** browser app inside a
headless **Chrome** driven by **Puppeteer**. There is no API: we literally run WhatsApp Web in a hidden
browser and poke its internals. That has one overriding consequence:

> **It breaks whenever WhatsApp changes their web app, and there is no SLA.** Most of the "WhatsApp is
> broken again" incidents are not our bugs — they are the library (or Puppeteer) reacting to a WhatsApp
> Web push. Our job is to **detect those failures and auto-recover**, which is what Section 7 is about.

### Pinned versions

| Package | Version | Notes |
|---|---|---|
| `whatsapp-web.js` | **1.34.7** | `@latest`; the recommended stable. `@next`/`@alpha` are *older* — do not use them. There is no `@web-cache` tag. |
| `puppeteer` | **24.38.0** | Pulled in transitively by whatsapp-web.js (exact pin in its deps). |

`new Client(...)` is configured in `createAndInitializeClient()` (`services/messaging/whatsapp.ts`):
`authStrategy: new LocalAuth({ clientId: 'client' })`, `headless: true`, `timeout: 30000`, and a
conservative Chrome `args` list. We deliberately do **not** set `--single-process` (breaks
whatsapp-web.js) and do **not** pin `webVersion`/`webVersionCache` (see the nuance below).

### Known library/Puppeteer failures we work around

| Symptom | Root cause | Our defense |
|---|---|---|
| `authenticated` fires after a fresh scan but **`ready` never fires** (errors `Execution context was destroyed` / `detached Frame` in `Client.inject`/`getWWebVersion`) | WhatsApp Web **2.3000.x** navigates the page *during* injection, destroying Puppeteer's context. Library issues [#3809](https://github.com/pedroslopez/whatsapp-web.js/issues/3809), [#3181](https://github.com/pedroslopez/whatsapp-web.js/issues/3181), [#127084](https://github.com/pedroslopez/whatsapp-web.js/issues/127084); partially fixed by [PR #3811](https://github.com/pedroslopez/whatsapp-web.js/pull/3811) (in 1.34.7). Also occurs on a **poisoned session restore** (half-written IndexedDB from an unclean shutdown). | **Ready-watchdog** → restart, then **park for manual re-link** (§7.1) |
| `The browser is already running for …\session-client` on launch | **Puppeteer's own** Windows check ([PR #14307](https://github.com/puppeteer/puppeteer/pull/14307), active in 24.38.0): it throws if a `lockfile` is left in the profile dir, e.g. after an unclean shutdown left an orphan Chrome. | **`ensureProfileUnlocked()`** + proactive cold-start unlock (§7.2) |
| Client dies on a network blip with **no `disconnected` event** | whatsapp-web.js doesn't fire `disconnected`/`change_state` on a plain socket drop. | **Liveness heartbeat** (§7.3) |
| `disconnected` fires up to **3×** (reason `NAVIGATION`/`LOGOUT`) | Library behavior on phone-side logout. | Idempotent handler (state-guarded) |

> **Nuance — do NOT pin `webVersionCache`.** Pinning an old WhatsApp Web HTML snapshot to dodge the
> inject race is a fire-extinguisher, not a foundation: pinned URLs 404 when the upstream store moves a
> file, and Meta force-upgrades old builds anyway. On 2.3000.x the maintainer guidance is to run the
> library's default local cache (which we do) and, if a future push re-breaks inject before the library
> catches up, escalate to `github:wwebjs/whatsapp-web.js#main` (HEAD has later inject hardening) — an
> explicit, temporary decision, not a standing config.

> **Strategic note.** For a *commercial, multi-clinic* product, proactive appointment reminders on **any**
> unofficial library carry real account-ban risk and zero SLA. The durable long-term path for the
> *outbound reminder* channel is the official **WhatsApp Cloud API** (Utility templates). whatsapp-web.js
> is fine for interactive/inbound and where the official-API economics don't fit — but treat it as
> inherently fragile.

---

## 2. Where everything lives

| Concern | File |
|---|---|
| Client + state machine + circuit breaker + reconnection + **all robustness machinery** | `services/messaging/whatsapp.ts` |
| Low-level media senders (`sendImg_`, `sendXray_`) via the circuit breaker | `services/messaging/whatsapp-api.ts` |
| Per-date message → appointment mapping for delivery ACKs | `services/messaging/MessageSession.ts`, `MessageSessionManager.ts` |
| Daily-appointments group-PDF settings (options table) | `services/messaging/group-settings.ts` |
| Shared mutable state (clientReady, QR, viewer count, send stats, persons) | `services/state/messageState.ts` |
| In-process event names (NOT on the wire) | `services/messaging/websocket-events.ts` (`InternalEmitterEvents`) |
| Server→client SSE broadcaster (QR / ready / status / send progress) | `services/messaging/sse-whatsapp.ts` |
| HTTP routes (`/api/wa/*`) | `routes/api/whatsapp.routes.ts` |
| Boot wiring + `WHATSAPP_AUTO_INIT` boot gate + graceful-shutdown chain | `index.ts` |
| Health check (`whatsapp`, every 15 s) | `services/monitoring/HealthCheck.ts` |
| Request/response Zod contracts | `shared/contracts/whatsapp.contract.ts` |
| Client SSE singleton (refcounted) | `public/js/services/sse-whatsapp.ts` |
| App-wide SSE subscription (drives global ready/QR + registers a viewer) | `public/js/contexts/GlobalStateContext.tsx` |
| Auth/QR page + hook | `public/js/routes/WhatsAppAuth.tsx`, `public/js/components/whatsapp-auth/*`, `public/js/hooks/useWhatsAppAuth.ts` |
| Send page + hook | `public/js/routes/WhatsAppSend.tsx`, `public/js/components/whatsapp-send/*`, `public/js/hooks/useWhatsAppSync.ts` |

> **Nuance — the filename `websocket-events.ts` is legacy.** WebSockets are retired; these are
> **in-process EventEmitter names**, never on the wire. The `wsEmitter` is a bare `EventEmitter` created
> in `index.ts` and handed to the SSE broadcasters at boot. "ws" throughout this module = in-process.

---

## 3. The client state machine

States (`ClientState` in `whatsapp.ts`): **`DISCONNECTED` → `INITIALIZING` → `CONNECTED`**, with
**`ERROR`** on failure. Every transition logs `State: X → Y`.

```
                 boot / on-demand / manual / reconnect
   DISCONNECTED ─────────────────────────────────────────► INITIALIZING
       ▲                                                   │   │
       │ logout / restart                  ready (auth)    │   │ QR emitted (no valid session)
       │                                                   │   ▼
       │                                         CONNECTED ◄┘   (QR mode: stays INITIALIZING,
       │                                            │            waits for a phone scan)
       │                            disconnect /    │
       │                            auth_failure /  ▼
       └──────────── scheduleReconnect ◄────────── ERROR
```

- **CONNECTED** is set by `handleReady()` (and when `performInitialization` restores a valid session
  with no QR). `handleReady` also flips `messageState.clientReady = true`, clears the QR, broadcasts
  ready, and **starts the liveness heartbeat** (§7.3).
- **QR mode**: `createAndInitializeClient()` resolves `false` → state stays `INITIALIZING` and a QR is
  emitted; the client is waiting for a phone scan.
- **ERROR** → `scheduleReconnect()` unless `manualDisconnect` or `destroyInProgress` is set.

### Key timings / constants (`whatsapp.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `SESSION_RESTORATION_TIMEOUT` | 120 s | hard cap on restoring an existing session |
| `FRESH_AUTH_TIMEOUT` | 90 s | after a QR is shown, how long `createAndInitializeClient()` waits before resolving `false` (no scan yet) |
| `INITIALIZATION_TIMEOUT` | 60 s | init-lock staleness + abort-controller window |
| Session stabilization delay | 60 s | after `authenticated`, the client waits 60 s before a restart is considered "safe" (restarting earlier can lose session data) |
| Ready-watchdog delay | 75 s | §7.1 — fires *after* the 60 s stabilization, so its restart is session-safe |
| Liveness heartbeat | 60 s / 2 misses | §7.3 |
| Circuit breaker | 5 failures / 60 s | opens after 5 consecutive init failures |
| `MAX_RECONNECT_ATTEMPTS` | 10 | then a 5-min cooldown |
| `RECONNECT_BASE_DELAY` | 5 s | backoff = `5 s × 1.5^(n-1)`, capped at 60 s |
| `RECONNECT_COOLDOWN_MS` | 5 min | wait after exceeding max attempts, then reset and retry |

---

## 4. How initialization is triggered (4 paths) + the kill-switch

All **automatic** paths funnel through `initializeOnDemand()`; the **manual** path calls `initialize()`
directly.

1. **Boot** — `index.ts` at startup. Gated by `WHATSAPP_AUTO_INIT` (default `true`).
2. **On-demand (QR viewer)** — *the dominant path in practice*:
   - A browser opens the WhatsApp SSE stream (`GET /api/sse/whatsapp`) → server
     `messageState.registerQRViewer()` → `activeQRViewers > 0`.
   - The page (or `GlobalStateContext`) fetches `GET /api/wa/initial-state`; with viewers > 0 it emits
     `whatsapp_initialization_requested` → `initializeOnDemand()` → `initialize()`.
   - **`GlobalStateContext` opens this stream app-wide, for *every logged-in user on every page*** (to
     drive the global ready/QR indicator). So on-demand init fires shortly after *anyone* logs in — you
     do **not** need to visit the WhatsApp page.
3. **Manual** — `POST /api/wa/initialize` → `whatsapp.initialize()` directly. The **only** path that
   **ignores `WHATSAPP_AUTO_INIT`**, so it works even when the kill-switch is on. (A legacy
   `GET /api/wa/initialize` exists for external/fire-and-forget callers.)
4. **Reconnection** — after `ERROR`/`disconnected`, `scheduleReconnect()` re-calls `initialize()` with
   backoff. Only runs once an init has already happened.

### `WHATSAPP_AUTO_INIT` — the kill-switch

`WHATSAPP_AUTO_INIT=false` blocks **every automatic** init path (boot **and** on-demand —
`initializeOnDemand()` returns early). It does **not** block the **manual** path
(`POST /api/wa/initialize`). The health check treats this off-until-manual state as **healthy**
(status `disabled`) so it doesn't warn.

> **Nuance — why gating *only* boot is not enough.** Because `GlobalStateContext` registers a QR viewer
> for every logged-in user, a boot-only gate is defeated instantly: the on-demand path would auto-start
> WhatsApp regardless. Gating `initializeOnDemand()` is the single chokepoint. Production runs
> `WHATSAPP_AUTO_INIT=true`.

---

## 5. The initialization sequence

`performInitialization(forceRestart)` does, in order:

1. **Proactive profile-unlock (cold start only).** If there's **no client yet** *and* a stale Chrome
   **`lockfile`** exists in the profile dir, call `ensureProfileUnlocked()` *before* launching — see §7.2.
   Gated on the lockfile actually existing, so a clean boot pays one `stat()`.
2. If `forceRestart` and a client exists → `destroyClient('restart')`.
3. If first start (no client), **validate session quality** (`valid` / `corrupted` / `empty` / none):
   `valid` → reuse the LocalAuth session (fast reconnect, no QR); `corrupted` → clean it up then create a
   fresh client (will show QR); `empty`/none → create a client and let Puppeteer initialize storage / show
   QR.
4. `setState('INITIALIZING')`, arm the abort controller + `INITIALIZATION_TIMEOUT`.
5. `createAndInitializeClient()` inside the **circuit breaker**: `true` → **CONNECTED** (reset reconnect
   attempts); `false` → **QR mode** (stay INITIALIZING, wait for scan).
6. On any throw: `cleanupFailedClient()` (graceful `destroy()` → `browser.close()` → `SIGKILL` as last
   resort), then if the error looks like a lock collision (`already running`/`ProcessSingleton`)
   **self-heal** via `ensureProfileUnlocked()`, set **ERROR**, schedule reconnect.

After `ready`: clear QR, broadcast `clientReady`, start the **60 s stabilization** window, **start the
heartbeat**.

> **Nuance — `createAndInitializeClient()` returns `false` only after `FRESH_AUTH_TIMEOUT` (90 s).** When a
> QR is emitted it does not resolve immediately; it waits up to 90 s for a scan (`ready`) before resolving
> `false`. This is **why every lifecycle route is fire-and-forget** (§11): a *blocking* `await
> whatsapp.restart()` over HTTP would exceed the 30 s request timeout and 408 while the client sits in QR
> mode.

---

## 6. QR authentication flow

- QR generation is **gated on `activeQRViewers > 0`** — no one watching, no QR work.
- The raw QR string lands in `messageState.qr`. `handleQR()` renders it to a data URL and broadcasts
  `whatsapp_qr_updated` on **every rotation**.
- **The QR rotates ~every 20 s, driven by WhatsApp Web itself** (not a timer of ours): whatsapp-web.js
  subscribes to WA Web's `AuthStore.Conn` `change:ref` event and re-emits `qr` each time. We don't set
  `qrMaxRetries`, so it rotates indefinitely until scanned. Each rotation is pushed live via SSE, so the
  displayed code is always current.
- Scanning → `authenticated` → (`handleAuthenticated` clears the QR, broadcasts an `authenticated`
  progress state, arms the ready-watchdog) → `ready` → **CONNECTED**; the auth page auto-redirects to
  `/send`.

> **Nuance — the QR on screen comes from SSE, not from re-fetching state.** `useWhatsAppAuth`'s
> `requestInitialState()` (and the 30 s re-poll) only adjust `authState`; the QR *image* is owned by
> `GlobalStateContext.whatsappQrCode`, fed exclusively by the `whatsapp_qr_updated` SSE event. So
> re-fetching can never change the displayed QR. That's why **"Refresh QR Code"** can't just re-fetch — it
> calls `POST /api/wa/refresh-qr`, which force-restarts the client to *mint a new code* (the only way), and
> the new QR arrives over SSE.
> The `/qr` route's `expiryTime: now + 60000` is cosmetic metadata, not an enforced TTL.

---

## 7. The robustness machinery (the important part)

These five mechanisms exist because of the library failures in §1. **Each one has a comment explaining the
exact failure it defends against — do not remove them without understanding the bug.**

### 7.1 Ready-watchdog → manual re-link — "authenticated but never ready"

whatsapp-web.js frequently fires `authenticated` but **never `ready`** — on a **fresh QR link** (post-auth
navigation destroys Puppeteer's injected context — §1) AND on a **poisoned session restore** (an unclean
shutdown left WA Web's IndexedDB half-written, so the session loads enough to authenticate but can't finish
syncing). `validateSessionQuality()` still rates such a session `'valid'` — the corruption isn't visible on
disk, only at runtime — so the watchdog is the *only* detector.

`handleAuthenticated()` **always** arms a watchdog (`armReadyWatchdog`): if `ready` hasn't fired within
**75 s** (after the 60 s stabilization window, so the restart can't race session persistence), `restart()`
reloads the saved session — which fixes the fresh-link case in ~1 s. Bounded to **2** restarts; cleared the
instant `ready` fires and on every teardown path; the CONNECTED guard makes a late firing a no-op.

If those restarts are exhausted (it keeps authenticating but never readies → genuinely poisoned, not slow),
the watchdog **parks for a manual re-link** (`parkForRelink`) — it does **not** wipe anything. It tears the
dead browser down, sets `needsRelink`, and broadcasts a `needs_relink` SSE frame. `needsRelink` then gates off
`scheduleReconnect()` and `initializeOnDemand()`, so the server stops reload-looping the dead session instead
of thrashing forever. Cleared by a real `ready`, `restart()`, or `unlink()`.

**Recovery is manual-only and goes through the library, never our own `fs`.** `unlink()` (POST
`/api/wa/unlink`, also aliased as `/logout` — the Re-link and Logout buttons both land there) clears the
session via whatsapp-web.js's own API: a clean `client.logout()` when the page is healthy, else `destroy()` +
**`LocalAuth.logout()`** (the retained, initialized auth strategy's own `fs.rm(userDataDir, …)`) *after*
`ensureProfileUnlocked()` releases the profile lock — then a fresh init shows a new QR over SSE. We never
`fs.rm('.wwebjs_auth/…')` ourselves, and there is **no automatic session clear** (a deliberate product
decision — a human re-links). The auth page surfaces a dedicated **"Session expired — Re-link device"** state
(driven by the `needsRelink` / `restoring` flags on `/api/wa/initial-state`) instead of a forever-empty QR box.

### 7.2 `ensureProfileUnlocked()` — "browser is already running"

Puppeteer refuses to launch on a profile another Chrome still owns, throwing *"The browser is already
running for …\session-client"* — on Windows it detects a leftover **`lockfile`** plus Chrome's
ProcessSingleton mutex. A bare `destroy()` can leave the old Chrome still dying, and an **unclean shutdown**
(e.g. the Windows console/RDP disconnect → graceful-shutdown path, see [[sighup-stops-cdc-capture]]) can
orphan one entirely.

`ensureProfileUnlocked(trackedProc?)` guarantees the profile is free before relaunch:
1. Hard-kill the browser we had a handle to (`killPidAndWait` — SIGKILL then poll until the PID is gone).
2. On Windows, kill any **orphan `chrome.exe` whose command line references *this* profile dir**
   (`killWindowsChromeForProfile`, a targeted PowerShell scan) — **never** the user's own Chrome.
3. Delete the stale lock files (`lockfile`, and the Linux `Singleton*`).

It runs in three places: inside `restart()` (with the prior browser's PID, captured **before** destroy —
in QR mode `clientState.browser` is null, so the only handle is `client.pupBrowser.process()`); as a
**proactive cold-start** step in `performInitialization` (gated on `profileLockExists()`); and as a
**self-heal** in the init catch when the error matches `already running`/`ProcessSingleton`.

### 7.3 Liveness heartbeat — silent death

A plain network drop can kill the socket **without** firing `disconnected`, so the client dies quietly and
we'd only notice when a send fails. `startHeartbeat()` (started on `ready`) probes `client.getState()`
every **60 s**:
- Only probes while we *believe* we're up (`CONNECTED` + `clientReady`, not tearing down).
- `'CONNECTED'` resets the miss counter; anything else or a throw (10 s timeout) is a miss.
- **Two consecutive misses** → `restart()` (reloads the saved session, no QR). The 2-miss debounce rides
  out `getState()`'s known transient flakiness.
- Stopped on every teardown (`restart`/`destroyClient`/`disconnect`/shutdown) and `unref`'d so it never
  holds the process open.

> **Nuance — `getState()` is for liveness only.** It's documented as unreliable (it can report `CONNECTED`
> while sends silently fail). We use it to *detect death and trigger reconnect*, never as proof the client
> is usable — "usable" is gated on the real `ready` event.

### 7.4 Smart health check — no false alarms during startup

A fresh start is slow by design (up to ~2 min restoring a session, or sitting on a QR). The health check
(`HealthCheck.ts`) stays **healthy and quiet** while the client is actively `INITIALIZING` *or* within a
**3-minute startup grace window**, and only reports unhealthy once it's been not-ready *with viewers
watching* past that — i.e. genuinely stuck. See §13.

### 7.5 Circuit breaker + reconnect backoff

`createAndInitializeClient()` runs inside an `EnhancedCircuitBreaker` (opens after 5 failures / 60 s).
`scheduleReconnect()` uses exponential backoff (`5 s × 1.5^n`, cap 60 s); after `MAX_RECONNECT_ATTEMPTS`
(10) it enters a 5-min cooldown, then resets and retries.

> **Nuance — the circuit breaker is shared across all operations** (init, `send`, media, `report`). A hung
> operation can open it; individual ops carry their own timeouts (e.g. 15 s per message in `report()`) to
> keep one slow call from wedging the breaker.

---

## 8. Realtime: the SSE channel

WebSockets are retired; all server→client realtime is **Server-Sent Events**.

- **Server.** `index.ts` creates a bare `EventEmitter` (`wsEmitter`) and hands it to the broadcasters.
  Routes/handlers emit `InternalEmitterEvents.WHATSAPP_*` (in `websocket-events.ts`);
  `sse-whatsapp.ts` translates them to SSE frames (`whatsapp_qr_updated`, `whatsapp_client_ready`,
  `whatsapp_message_status`, `whatsapp_sending_started`/`progress`/`finished`).
- **Route.** `GET /api/sse/whatsapp` mounts **after** the auth gate (a 401 closes the EventSource). Every
  subscriber is registered as a **QR viewer** (`registerQRViewer`/`unregisterQRViewer`, paired exactly once
  even if the socket closes mid-registration). A module-scoped 25 s keep-alive writes comment frames to
  undercut idle proxy drops.
- **Client singleton.** `public/js/services/sse-whatsapp.ts` is refcounted (`ensureConnected()`/`release()`),
  opened on first acquire and closed at refcount zero, with liveness + forced-reconnect on tab-resume/bfcache.
  **Never `new EventSource` directly** for this channel.

> **Nuance — `activeQRViewers` is the master gate.** It gates both QR generation *and* on-demand init. It is
> driven by SSE subscriptions, and `GlobalStateContext` subscribes app-wide — so "is anyone watching?" really
> means "is anyone logged in?".

---

## 9. The frontend

- **`GlobalStateContext`** — the app-wide subscription. Holds `whatsappClientReady` + `whatsappQrCode`,
  fed by the `whatsapp_client_ready` / `whatsapp_qr_updated` SSE events (and seeded once from
  `/api/wa/initial-state`). It registers a QR viewer for every logged-in user, which is what triggers
  on-demand init. **`whatsappQrCode` is the single source of truth for the displayed QR.**
- **`useWhatsAppAuth`** (`/auth` page) — derives an `authState` (`INITIALIZING` … `QR_REQUIRED` …
  `AUTHENTICATED` …) from the SSE-driven `clientReady`/`qrCode` plus REST `initial-state`. Exposes actions:
  `handleRefreshQR` (→ `/api/wa/refresh-qr`), `handleRestart`, `handleReLink`, `handleRetry`.
  Auto-redirects to `/send` after a scan-driven `ready`.
- **`useWhatsAppSync`** (`/send` page) — `connectionStatus` (UIState), `clientReady`, `sendingProgress`
  (`{started, finished, total, sent, failed}`), and `messageStatusUpdate`, driven by the
  `whatsapp_sending_*` and `whatsapp_message_status` SSE events; primes per-date initial state via REST.
- **There is no header button.** A former `WhatsAppInitButton` in `UniversalHeader` offered a one-click
  manual start; it was removed because with `WHATSAPP_AUTO_INIT=true` init auto-starts on the first SSE
  viewer. Manual start is `POST /api/wa/initialize` (or, in dev, opening `/auth`).

> **Nuance — the send page reads some fields via a raw client, not the `core/http` funnel.** A few
> WhatsApp reads (`whatsapp-api-client.ts`) intentionally read top-level fields of the flat
> `{ success, qr, clientReady, … }` payloads rather than the unwrapped `{ data }` envelope. Likewise the
> `initialState`/`qr` contracts are deliberately `z.looseObject({})` — their fields vary across the client
> lifecycle and the UI reads the long tail.

---

## 10. Message sending & delivery tracking

### Sending

- **Batch (daily appointments):** `send(date)` → first posts the daily-appointments **PDF to the WhatsApp
  group** (`sendAppointmentsPdfToGroup`, best-effort, controlled by `group-settings`), then iterates the
  day's patients calling `sendSingleMessage` with a **2 s delay between sends**, then `markWhatsAppBatchSent(date)`.
  Route: `GET /api/wa/send?date=YYYY-MM-DD` (fire-and-forget, 5-min timeout).
- **Single messages:** `POST /api/wa/send-receipt` (work receipt) and `POST /api/wa/send-appointment`
  (confirmation) build a message and call `whatsapp.sendMessage(...)`.
- **Media:** `POST /api/wa/sendmedia` (base64 image) and `POST /api/wa/sendmedia2` (file paths, WhatsApp or
  Telegram). Low-level senders `sendImg_`/`sendXray_` (`whatsapp-api.ts`) run through the circuit breaker.

### Delivery tracking (ACKs)

`MessageSession` / `MessageSessionManager` track delivery status:
- Each **date** gets a `MessageSession` mapping `messageId → (appointmentId, date)`.
- The `message_ack` event (`handleMessageAck`) looks the messageId up across active sessions and updates the
  DB + `messageState` + broadcasts `whatsapp_message_status`.
- Sessions expire after a **24 h** ACK-tracking window; the manager periodically prunes (6 h interval, 48 h
  max age, history trimmed to the 10 most recent days). Graceful shutdown completes all sessions.

---

## 11. HTTP routes (`/api/wa/*`)

Mounted after the auth gate (`routes/api/whatsapp.routes.ts`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/initial-state` | snapshot (`clientReady`, `initializing`, `qr`, stats); triggers on-demand init if viewers > 0 |
| GET | `/qr` | current QR as a data URL (404 = not available yet) |
| GET | `/send?date=` | batch-send the day's reminders (fire-and-forget, 5-min timeout) |
| POST | `/send-receipt` | send a work receipt to a patient |
| POST | `/send-appointment` | send an appointment confirmation |
| POST | `/sendmedia`, `/sendmedia2` | send image / file(s) (WhatsApp or Telegram) |
| GET/PUT | `/group-settings` | the daily group-PDF config |
| GET | `/initialize` | background init (legacy/external callers) |
| POST | `/initialize` | **manual start** — bypasses `WHATSAPP_AUTO_INIT` |
| POST | `/restart` | `forceRestart` — destroy + unlock + recreate |
| POST | `/refresh-qr` | mint a **new** QR — fire-and-forget restart (200 immediately; new QR via SSE). Non-blocking because a QR-mode init doesn't resolve for up to `FRESH_AUTH_TIMEOUT` (90 s) |
| POST | `/logout` | log out of WhatsApp, then restart |

> **Nuance — the lifecycle ops are fire-and-forget by necessity.** `/refresh-qr` (and the manual
> `/initialize`) return 200 immediately and do the work in the background (`setImmediate`) precisely because
> a QR-mode init blocks up to 90 s — far past the 30 s request timeout. The client learns the outcome over
> SSE, not from the HTTP response. (The legacy blocking `/restart` is awaited by the "Restart Client" button
> and can therefore 408 in QR mode while the restart still succeeds in the background.)

---

## 12. Disconnect, recovery & shutdown

- **`disconnected`** → `handleDisconnected` clears the watchdog + heartbeat, sets `DISCONNECTED`, then
  `scheduleReconnect()` (unless `manualDisconnect`). Note it can fire **up to 3×**; the handler is
  state-guarded so the side effects are idempotent.
- **`auth_failure`** → `ERROR` → reconnect.
- **Heartbeat-detected silent death** → `restart()` (§7.3).
- **Graceful shutdown** (`index.ts` → `whatsappService.gracefulShutdown()`): sets `manualDisconnect`
  (suppresses reconnect), stops timers, tears the client/browser down. Puppeteer keeps its default
  SIGINT/SIGTERM/SIGHUP handlers so Chrome closes with the process.

> **Nuance — `manualDisconnect` is the reconnect kill-flag.** It's set true at the start of
> `restart()`/`gracefulShutdown()`/logout so a concurrent `disconnected` event's `scheduleReconnect()`
> skips (it checks `!manualDisconnect && !destroyInProgress`). This is what lets the heartbeat call
> `restart()` without racing the disconnect machinery.

> **⚠️ SIGHUP caveat.** A Windows console/RDP disconnect can trigger graceful shutdown and also stop CDC
> capture — see [[sighup-stops-cdc-capture]]. Unrelated to WhatsApp readiness but shares the shutdown path,
> and it's a prime source of the orphaned Chrome that §7.2 cleans up.

---

## 13. Health check

The `whatsapp` check (`HealthCheck.ts`, every 15 s) reads the real client state and is **healthy (quiet)**
when any of: client `ready`; **no viewers**; `WHATSAPP_AUTO_INIT=false`; the client is **actively
`INITIALIZING`**; or it's still within a **3-minute startup grace window** (covers
`SESSION_RESTORATION_TIMEOUT` + buffer). Only a **prolonged** not-ready-with-viewers state warns:
`WhatsApp client not ready after Ns (state: …)`.

Detail `status` values: `ready` | `idle` | `disabled` | `initializing` (preparing) | `stuck` (the only
warn).

> **Nuance — why this matters.** Before this, the check flagged `healthy:false` → `log.warn(...)` every
> 15 s through the entire normal init window, because the app-wide SSE keeps `activeViewers > 0` after every
> restart. That produced hundreds of false "Health check failed: whatsapp" lines per startup. The grace
> window distinguishes "preparing" (normal, silent) from "stuck" (real, warns).

---

## 14. Gotchas & non-obvious behavior

A consolidated list of the things that will bite you:

- **The QR image is SSE-only.** Re-fetching `/initial-state` or `/qr` cannot change the on-screen QR; only
  `whatsapp_qr_updated` does. "Refresh QR" therefore *restarts* the client (§6).
- **Lifecycle routes must be fire-and-forget.** A QR-mode init blocks up to `FRESH_AUTH_TIMEOUT` (90 s);
  awaiting `restart()` over HTTP 408s at 30 s (§11).
- **`authenticated` ≠ usable.** On a fresh link, `ready` may never come; the watchdog auto-restarts (§7.1).
  Gate "usable" on `ready`/`clientReady`, never on `authenticated`.
- **`getState()` lies.** Liveness only; never proof of usability (§7.3).
- **`disconnected` fires ~3× and NOT on internet loss.** Hence the heartbeat (§7.3) and the idempotent
  handler (§12).
- **LocalAuth owns the profile dir.** `clientId: 'client'` → `.wwebjs_auth/session-client`. **Never** pass
  your own `puppeteer.userDataDir` — LocalAuth throws on it. The Windows lock file is literally
  `…\session-client\lockfile` (what Puppeteer checks and what §7.2 removes).
- **The 60 s stabilization window is real.** Restarting before it can lose a freshly-linked session
  (→ re-scan). The watchdog respects it (75 s).
- **`activeQRViewers` = "is anyone logged in?"** because `GlobalStateContext` subscribes app-wide. On-demand
  init fires after *any* login, not just on the WhatsApp page.
- **`WHATSAPP_AUTO_INIT=false` blocks boot AND on-demand**, but never the manual `POST /api/wa/initialize`.
- **Unclean shutdown → orphan Chrome → "browser already running".** §7.2 + the proactive cold-start unlock
  handle it; the deeper cause is often the SIGHUP path ([[sighup-stops-cdc-capture]]).
- **`websocket-events.ts` is in-process only.** Not on the wire.
- **Don't pin `webVersionCache`** on 2.3000.x (§1).
- **Production deploys need a build + service restart** — source edits don't apply to the running
  `webapp.exe` service. Restarting briefly drops WhatsApp; the new build self-heals any leftover orphan on
  first init.

---

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Scanned the QR, but it stays on screen and WhatsApp is unusable | Fresh-link `ready`-never-fires (§1) | Auto-recovers via the ready-watchdog (~75 s). If it persists, `POST /api/wa/restart`. |
| `"browser is already running for …client"` | A prior Chrome (or an unclean-shutdown orphan) still owns the profile — Puppeteer's Windows `lockfile` check | Auto-handled: `restart()` + the proactive cold-start unlock + init self-heal call `ensureProfileUnlocked()`. If still stuck, `POST /api/wa/restart`. |
| `WhatsApp client not ready after Ns (state: …)` warning | Still not ready **past the 3-min grace** with a viewer connected — genuinely stuck, not just preparing | `POST /api/wa/restart`; check Chrome/session health. |
| `"Refresh QR Code"` seems to do nothing | Expecting a re-fetch to change the QR (it can't — §6) | It *does* restart to mint a new code; the new QR arrives over SSE within a few seconds. |
| `Initialization timeout - no events` then retry | Large/slow session restore; transient | Retries automatically; succeeds once Chrome restores the session. |
| `Circuit breaker … 5/5` then no init | 5 consecutive failures opened the breaker | Wait for half-open, or `POST /api/wa/restart`; check Chrome/session health. |
| QR never appears | No active QR viewers, or auto-init disabled and not manually started | Open the WhatsApp page (registers a viewer) and/or `POST /api/wa/initialize`. |
| Sends silently stop working, no error | Silent socket death | The heartbeat restarts within ~2 min; or `POST /api/wa/restart`. |
| WhatsApp won't come up despite `WHATSAPP_AUTO_INIT=true` | Circuit breaker open, or a wedged orphan Chrome | `POST /api/wa/restart` (runs the full unlock + reinit). |
