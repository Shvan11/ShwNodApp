# CLAUDE.md

**Shwan Orthodontics Management System** — Node.js + Express + React 19 + TypeScript practice management platform for an orthodontic clinic. Patients, treatments, dental chart, aligners, appointments, multi-channel messaging (WhatsApp/SMS/Telegram), financial/expenses, document templates (GrapesJS), Stand inventory/POS, Patient Portal.

> ⚠️ **This is a SANDBOX CLONE of the main app, used for testing only.** It does **not** connect to the production database — it points at a **cloned/sandbox database** (`ShwanNew_Test`) so experiments can't touch live clinic data. Changes here are for safe testing; the production app and its `ShwanNew` database are separate.

---

## Commands

```bash
npm run dev              # Vite (5173) + Express (3001) concurrently
npm run build            # Client (/dist) + server (/dist-server)
npm start                # Serve from /dist-server (3000)

npm run typecheck:all    # Both frontend + backend
npm run lint:fix
npm run css:types        # Regenerate .module.css.d.ts
```

---

## Architecture (where to look)

**Backend** — Express 5, ESM, strict TS. Entry: `index.ts`.
- `routes/` — root-level routes (admin/auth/portal/calendar/sync-webhook/template-api/user-management/web/email-api) + `routes/api/*.routes.ts` for feature endpoints
- `services/` — 17 subdirs, business logic by domain (`business/`, `database/`, `messaging/`, `sync/`, `pdf/`, `templates/`, `webceph/`, `google-drive/`, `state/`, `monitoring/`, …)
- `services/database/queries/` — one query module per domain
- `middleware/`, `utils/`, `config/`, `types/`

**Frontend** — React 19, React Router v7 Data Router, Vite 7. Entry: `public/js/App.tsx`.
- `public/js/router/routes.config.tsx` — route table
- `public/js/router/loaders.ts` — route loaders (5-min sessionStorage cache)
- `public/js/routes/`, `public/js/pages/` — top-level screens (Stand*, Patient Portal, ChairDisplay live here)
- `public/js/components/react/` — shared components, organized by feature subfolder
- `public/js/contexts/`, `public/js/hooks/`, `public/js/services/`

**CSS** — CSS Modules (`*.module.css`) for components; globals under `public/css/` (variables, reset, layout, shared component styles).

---

## Critical patterns (these override defaults)

### Navigation — React Router ONLY
```typescript
// CORRECT
const navigate = useNavigate();
navigate('/patient/123/works');

// WRONG — causes full page reload
window.location.href = '/patient/123/works';
```
Exceptions: external URLs, system protocols (`explorer:`, `csimaging:`), security logout, route-loader 401 redirects.

### Toast, not alert()
```typescript
const toast = useToast();
toast.success('Saved!');
// Non-React: window.toast?.success('Done!')
```

### Winston, not console.log
```typescript
import { log } from '../utils/logger';
log.info('Completed', { userId: 123 });
log.error('Failed', { error: err.message });
```

### Shared `<Modal>` only
All overlay modals render via `public/js/components/react/Modal.tsx` (portal into `#modal-root`, focus trap, scroll lock, Escape + backdrop dismiss, `aria-modal`). **Never write a raw `.modal-overlay` / `styles.modalOverlay` wrapper** — it won't escape stacking/clipping ancestors.

### Frontend API contract types
Shared API request/response types live in `public/js/types/api.types.ts`. Use `ApiResponse<T>` (`{ success, data?, error? }`) for new endpoints. Don't redefine inline shapes.

- Import as `import type { ApiResponse } from '@/types/api.types'` — the `@types/*` alias works in tsconfig but **not** in Vite, so it breaks value exports at build.
- Aligner-domain types stay in `pages/aligner/aligner.types.ts`.
- UI form state and hook return types stay inline; only API boundary shapes go in `api.types.ts`.

### CSS Modules
```typescript
import styles from './Component.module.css';
<div className={styles.container}>
```
No inline styles (except dynamic), no `!important` (except print/a11y). For colors, spacing, z-index, breakpoints — use the design tokens in `public/css/base/variables.css`; don't invent new values inline.

---

## Database

SQL Server via **mssql v12** with tarn connection pooling (max 10, 30s timeouts).

**Facade**: `services/database/index.ts` exposes `withRequest(fn)` / `withTransaction(fn)`. All query modules use this.

**Gotchas — do not regress:**
- `TYPES` is re-exported from the facade. **Import `TYPES` from `'../index.js'`, NOT from `'tedious'`** — tedious TYPES silently produce `param.type = undefined` and crash mssql's validator.
- mssql v12 ships default-export only — use `import sql from 'mssql'`, NOT `import * as sql from 'mssql'`.
- TVPs auto-convert inside `applyInputs(req, params)`; TVP column types need explicit lengths (e.g. `TYPES.NVarChar(50)`).
- Output params: pass `outputs: SqlOutputParam[]` (the old `beforeExec` hook is gone).
- Non-SELECT queries return `recordset === undefined`; the facade null-checks it.
- `result.rowsAffected` is an array in mssql; the facade reduces to a single number.
- **Date-only columns must leave the server as a `YYYY-MM-DD` string** — pool runs `useUTC: false`, so a raw `datetime` serializes via `toISOString()` to UTC and shifts midnight values back a day on the client. Use SQL `CONVERT(varchar, col, 23)` (inline queries) or `toDateOnly()` from `utils/date.ts` (stored-proc/mapper results). Never `(col as Date).toISOString().split('T')[0]`.

**Connection** (see `.env` / `.mcp.json`): server `Clinic\DOLPHIN`, db `ShwanNew_Test`, user `Staff`. This is the **cloned sandbox database**, not production `ShwanNew` — see the banner at the top. Keep it that way; never repoint this clone at the live `ShwanNew` DB.

Schema baseline: `migrations/init_script.sql` (UTF-8 snapshot of the full DB). Historical migrations live under `migrations/archive/` (gitignored). `migrations/postgresql/` is for the separate aligner-portal-external app, not the main DB.

---

## Realtime / SSE

WebSockets have been retired. All server→client realtime now flows over **Server-Sent Events**. The legacy `utils/websocket.ts`, `wsService`, `connectionManager`, and `public/js/constants/websocket-events.ts` are gone — don't restore them.

**Server entry**: `index.ts` creates a bare `new EventEmitter()` (kept under the name `wsEmitter` for symmetry with existing emit sites) and hands it to the SSE broadcasters at boot:
- `services/messaging/sse-broadcaster.ts` — appointments + chair-display channels
- `services/messaging/sse-whatsapp.ts` — WhatsApp channel (QR, client-ready, message-status, sending-progress/finished)

Routes/services still emit the same internal events (`wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, date)`, `CHAIR_PATIENT_LOAD`, `WHATSAPP_*`); the broadcasters translate them to SSE frames at the boundary. Add new internal events to `services/messaging/websocket-events.ts` (the filename is legacy — the constants are now in-process emitter names only, never on the wire) and wire them in the relevant broadcaster's `ensureInitialized()`.

**Routes**:
- `GET /sse/chair-display/:chairId` — **public** (kiosk has no session — internal-LAN assumption, matches the legacy WS posture).
- `GET /api/sse/appointments` and `GET /api/sse/whatsapp` — mounted **after** the auth gate; a 401 closes the EventSource (browser sets `readyState=CLOSED` and stops auto-retrying).

**Transport hygiene** (each SSE handler does this — copy the pattern, don't reinvent):
- `req.setTimeout(0); res.setTimeout(0)` — bypasses the global 30 s `requestTimeout` middleware, otherwise every stream 408s at exactly 30 s.
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Initial frame: `retry: ${2500 + jitter}\n\n` so a server restart doesn't trigger a thundering-herd reconnect.
- **One** module-scoped 25 s `setInterval` writes `:\n\n` comment frames to every open stream — undercuts Caddy's ~30 s idle drop and proves transport health without per-connection timers.

**Freshness signal**: `sseAppointments.getFreshness()` / `sseWhatsapp.getFreshness()` return `'fresh'` iff `readyState === EventSource.OPEN`. No heartbeat-arrival clock — the browser's `onopen`/`onerror` transitions are authoritative. `markStale()` sets a sticky flag for the recovery-fetch-failed case (cleared on next open).

**"Live" indicator** (`public/js/components/react/appointments/ConnectionStatus.tsx`, unchanged): **Live** | **Stale — Resyncing** | **Static** (non-today views) | **Offline** | **Reconnecting…** | **Connection Error**.

**Client singletons**: `public/js/services/sse-appointments.ts` (`sseAppointments`) and `public/js/services/sse-whatsapp.ts` (`sseWhatsapp`). Refcount-based — hooks call `ensureConnected()` on mount and `release()` on unmount; the underlying `EventSource` is opened on first acquire and closed when refcount hits zero. **Never `new EventSource(...)` directly in app code** except the chair-display kiosk (`public/js/routes/ChairDisplay.tsx`, intentional standalone — no session, no shared listeners).

**Forced reconnect triggers** (built into the singletons + the kiosk):
- `visibilitychange` → hidden ≥ 2 min then visible (`VISIBILITY_RESUME_THRESHOLD_MS` in `public/js/constants/sse-liveness.ts`): close + reopen to dodge half-dead NAT/cellular transports.
- `pageshow` with `persisted === true`: iOS bfcache restore — the handle survives but the socket is dead.

**Chair-display state** (`sse-broadcaster.ts`): server keeps an in-memory `chairCurrentPatient` map with a 12 h TTL, so a kiosk reconnect replays the current patient on connect. Each chair has a monotonic `chairEpoch` counter — an async LOAD that resolves after a later CLEAR (or another LOAD) detects the bump and skips writing stale state. Lost on server restart by design.

**WhatsApp QR-viewer accounting**: every open `/api/sse/whatsapp` stream registers as a QR viewer via `messageState.registerQRViewer(viewerId)` and unregisters on close. The `messageState.activeQRViewers > 0` check still gates QR data-URL generation and on-demand WhatsApp init — don't break this on the SSE side.

**Graceful shutdown**: `teardownSseBroadcaster()` and `teardownWhatsappSseBroadcaster()` (both called from `gracefulShutdown` in `index.ts`) detach emitter listeners, clear the keep-alive interval, end all open streams, and reset the module-scoped maps.

---

## TypeScript / Path aliases

Dual config: `tsconfig.json` (backend), `tsconfig.frontend.json` (frontend), `tsconfig.build.json` (prod build). Strict mode on both.

**Backend aliases**: `@config/*`, `@services/*`, `@routes/*`, `@utils/*`, `@middleware/*`, `@types/*`
**Frontend aliases**: `@/*`, `@components/*`, `@services/*`, `@hooks/*`, `@contexts/*`, `@types/*` (tsconfig only — Vite resolves `@/*` for runtime; use it for value imports)

Use `import type { … }` for type-only imports.

---

## Environment

`.env.example` documents all vars grouped by category. Required for boot: `PORT`, `MACHINE_PATH`, `DB_SERVER`, `DB_INSTANCE`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `SESSION_SECRET`. Optional service blocks (Telegram, Twilio, Google Drive, WebCeph, Gemini, Supabase sync) can be left blank to disable.

---

## Deployment & environments

- **Dev = WSL (Linux); Prod = Windows Server.** Code must run on **both**, and a future move to a Linux-based server is planned — keep everything OS-agnostic. Use `utils/path-resolver.ts` + the platform `path` module for all filesystem paths; never hardcode `/` or `\` separators or assume posix.
- **Patient data volume** is the SMB/UNC share `\\Clinic\clinic1` (`MACHINE_PATH`; `PatientsFolder` DB option), reachable from every LAN PC but **not from phones**. It is a *separate volume* from the OS temp dir on both platforms → `fs.rename` from temp to the share throws `EXDEV`; stage temp files on the same volume. Per-file `stat`/`lstat` over the share is a network round-trip — avoid bulk stat in hot paths.
- **Remote access**: two front doors to the same on-host Node app. On-LAN, **Caddy** reverse-proxies `local.shwan-orthodontics.com` (`Caddyfile`; see `middleware/index.ts` trust-proxy note). Off-LAN, a **cloudflared named tunnel** (`config_cloudflared.yml`) routes `remote.shwan-orthodontics.com` → `localhost:3000` through Cloudflare. `config.urls.publicUrl` defaults to the remote domain (`config/config.ts`). Tunnel credentials live outside the repo under the OS user's `.cloudflared/` dir — never commit or paste them.

---

## Testing credentials

```
Username: Admin
Password: Yarmok11
```

```bash
curl -c /tmp/cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Yarmok11"}'
```

---

## Conventions worth remembering

- ES Modules (`"type": "module"`); `.js` extensions on relative imports even in TS source.
- React Compiler (`babel-plugin-react-compiler`) is enabled — don't manually memoize unless profiling proves a need.
- Cross-platform path handling lives in `utils/path-resolver.ts` (auto Windows/WSL conversion).
- RTL support for Kurdish/Arabic; check `rtl-support.css` before adding directional styles.
- Graceful shutdown chains exist for all long-lived services (WhatsApp, sync, pool, SSE broadcasters); don't add `process.exit()` mid-flow.
- After using Playwright, delete every screenshot it left behind — clean up all leftover screenshot files before finishing.
