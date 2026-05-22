# CLAUDE.md

**Shwan Orthodontics Management System** — Node.js + Express + React 19 + TypeScript practice management platform for an orthodontic clinic. Patients, treatments, dental chart, aligners, appointments, multi-channel messaging (WhatsApp/SMS/Telegram), financial/expenses, document templates (GrapesJS), Stand inventory/POS, Patient Portal.

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

**Connection** (see `.env` / `.mcp.json`): server `Clinic\DOLPHIN`, db `ShwanNew`, user `Staff`.

Schema baseline: `migrations/init_script.sql` (UTF-8 snapshot of the full DB). Historical migrations live under `migrations/archive/` (gitignored). `migrations/postgresql/` is for the separate aligner-portal-external app, not the main DB.

---

## Realtime / WebSockets

**Server entry**: `utils/websocket.ts` — `setupWebSocketServer(server)` returns `wsEmitter` (Node `EventEmitter`). Routes inject the emitter via `setWebSocketEmitter()` at boot and trigger broadcasts with `wsEmitter.emit(WebSocketEvents.DATA_UPDATED, date)` or `wsEmitter.emit('broadcast_message', msg)`. All periodic timers are cleared on graceful shutdown via `teardownPeriodicCleanup()` (chained from `index.ts`).

**Client types** (registered via `?clientType=...` URL param at upgrade): `daily-appointments`, `waStatus`, `auth`, `chair-display`, `generic`. The upgrade is currently unauthenticated — internal-LAN assumption; revisit if exposed beyond the clinic network.

**Three heartbeat layers** (each catches a different failure mode):
- **TCP ping** (30 s, server-driven): terminates dead transports.
- **`SERVER_HEARTBEAT`** (15 s, server push): drives client freshness signal — receipt timestamp is what makes the indicator honest.
- **`HEARTBEAT_PING`** (60 s, client-driven, 30 s pong timeout): active probe; force-closes on missed pong.

**Freshness signal**: `wsService.getFreshness()` returns `'fresh'` if a message arrived within 30 s. Uses `performance.now()` — wall-clock-immune. `wsService.markStale()` forces stale immediately (called on recovery-fetch failure so the indicator reflects the data gap).

**"Live" indicator** (`public/js/components/react/appointments/ConnectionStatus.tsx`): states are **Live** | **Stale — Resyncing** | **Static** (non-today views) | **Offline** | **Reconnecting…** | **Connection Error**.

**Client singleton**: `public/js/services/websocket.ts` (`wsService`) + multiplexer `websocket-connection-manager.ts` (`connectionManager`). **Hooks share one physical socket** — never `new WebSocket()` directly except for the kiosk (`ChairDisplay.tsx`, intentional standalone). When a hook mounts with a new client type on an already-open socket, the manager sends `register_client_type` to the server; on unmount it sends `unregister_client_type`. This keeps the server's broadcast Sets accurate without reconnecting.

**Event constants** live in **two files that must stay in sync**: `services/messaging/websocket-events.ts` (server) and `public/js/constants/websocket-events.ts` (client). Add new events to both.

**Chair-display state**: server keeps an in-memory `chairCurrentPatient` map so a kiosk reconnect replays the current patient via the existing `patient-loaded` handler — no DB write or new endpoint needed. Lost on server restart by design.

**Don't bypass the manager**: a stray `new WebSocket(...)` in app code skips reconnect/freshness/type-registration.

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
- Graceful shutdown chains exist for all long-lived services (WhatsApp, sync, pool, WS); don't add `process.exit()` mid-flow.
