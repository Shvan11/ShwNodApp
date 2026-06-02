# CLAUDE.md

**Shwan Orthodontics Management System** — Node.js + Express + React 19 + TypeScript practice management platform for an orthodontic clinic. Patients, treatments, dental chart, aligners, appointments, multi-channel messaging (WhatsApp/SMS/Telegram), financial/expenses, document templates (GrapesJS), Stand inventory/POS, Patient Portal.

> ⚠️ **This is the PRODUCTION deployment.** It connects to the **live PostgreSQL database** (`shwan` on `localhost:5432`) and serves on **port 3000** — changes here touch real clinic data. The separate **sandbox/test** environment lives at `C:\ShwNodApp-dolphin` (port 3100, database `shwan_test`) — do experiments there, not here.

---

## Commands

```bash
npm run dev              # Vite (5173) + Express (3001) concurrently
npm run build            # Client (/dist) + server (/dist-server)
npm start                # Serve from /dist-server (3000)

npm run typecheck:all    # Both frontend + backend
npm run lint:fix
npm run css:types        # Regenerate .module.css.d.ts
npm run db:migrate       # Apply migrations (also :down, :new-migration)
npm run db:codegen       # Regenerate types/db.d.ts after schema change
```

---

## Architecture (where to look)

**Backend** — Express 5, ESM, strict TS. Entry: `index.ts`.
- `routes/` — root-level routes (admin/auth/portal/calendar/sync-webhook/template-api/user-management/web/email-api) + `routes/api/*.routes.ts` for feature endpoints
- `services/` — ~17 subdirs, business logic by domain (`business/`, `database/`, `messaging/`, `sync/`, `pdf/`, `templates/`, `webceph/`, `google-drive/`, `state/`, `monitoring/`, …)
- `services/database/queries/` — one query module per domain (~24 modules)
- `middleware/`, `utils/`, `config/`, `types/`

**Frontend** — React 19, React Router v7 Data Router, Vite 7. Entry: `public/js/App.tsx`.
- `public/js/router/routes.config.tsx` — route table; `loaders.ts` — route loaders (5-min sessionStorage cache)
- `public/js/routes/`, `public/js/pages/` — top-level screens (Stand*, Patient Portal, ChairDisplay)
- `public/js/components/react/` — shared components by feature subfolder; plus `contexts/`, `hooks/`, `services/`

**CSS** — CSS Modules (`*.module.css`) for components; globals under `public/css/` (variables, reset, layout).

---

## Critical patterns (these override defaults)

### Navigation — React Router ONLY
```typescript
const navigate = useNavigate();
navigate('/patient/123/works');   // CORRECT
// window.location.href = ...      // WRONG — full page reload
```
Exceptions: external URLs, system protocols (`explorer:`, `csimaging:`), security logout, route-loader 401 redirects.

### Toast, not alert()
```typescript
const toast = useToast(); toast.success('Saved!');
// Non-React: window.toast?.success('Done!')
```

### Winston, not console.log
```typescript
import { log } from '../utils/logger';
log.info('Completed', { userId: 123 });
log.error('Failed', { error: err.message });
```

### Shared `<Modal>` only
All overlay modals render via `public/js/components/react/Modal.tsx` (portal into `#modal-root`, focus trap, scroll lock, Escape + backdrop dismiss). **Never write a raw `.modal-overlay` / `styles.modalOverlay` wrapper** — it won't escape stacking/clipping ancestors.

### Frontend API contract types
Shared API request/response types live in `public/js/types/api.types.ts`. Use `ApiResponse<T>` (`{ success, data?, error? }`) for new endpoints; don't redefine inline shapes.
- Import as `import type { ApiResponse } from '@/types/api.types'` — the `@types/*` alias works in tsconfig but **not** Vite, so it breaks value exports at build.
- Aligner-domain types stay in `pages/aligner/aligner.types.ts`. UI form/hook state stays inline; only API boundary shapes go in `api.types.ts`.

### Runtime validation (Zod) — boundaries only
Zod validates **untrusted input crossing into the app**, nowhere else: request bodies/params/query, env at boot, and `res.json()` parsing on external-facing (Patient Portal) calls. Use the shared `validate({ body?, params?, query? })` middleware (`middleware/validate.ts`) on routes — it parses, coerces, writes back, and 400s via `ErrorResponses`. The schema is the **single source of truth**: derive types with `z.infer<typeof schema>`, never hand-write a parallel `interface` beside it. The boot env schema lives in `config/config.ts` (throws on missing PG / SESSION_SECRET / MACHINE_PATH).
- **Never** validate Kysely/DB results (already typed from `types/db.d.ts` — the DB is a source we own), nor internal function calls (that's what TypeScript is for). Re-validating trusted data is wasted CPU and a second source of truth.

### CSS Modules
```typescript
import styles from './Component.module.css';
<div className={styles.container}>
```
No inline styles (except dynamic), no `!important` (except print/a11y). Use the design tokens in `public/css/base/variables.css` for colors/spacing/z-index/breakpoints — don't invent values inline.

---

## Database

**PostgreSQL** (local native service) via **node-postgres (`pg`) + Kysely** typed query builder — `pg.Pool` (max 10, ~30s timeouts). The SQL Server / mssql stack was retired in the migration cutover (`docs/postgres-migration-plan.md`). There are **no stored procedures, triggers, or scalar functions for app logic** — all that lives in TypeScript (the only DB triggers are the CDC capture ones, see Sync).

**Where to talk to the DB**: `services/database/kysely.ts` exposes `getKysely()` (the `Kysely<Database>` instance) and `withPgTransaction(cb)`. All query modules + converted routes/services use these directly. `services/database/index.ts` is now *only* connection diagnostics + lifecycle (`testConnection`/`testConnectionWithRetry`/`getDatabaseStats`/`healthCheck`/`shutdown`) — no more `executeQuery`/`executeStoredProcedure`/`TYPES`. For one-off raw SQL inside a module, use Kysely's `sql` template tag (`import { sql } from 'kysely'`).

**Gotchas — do not regress:**
- **`Database` type** is generated by `npm run db:codegen` → `types/db.d.ts`. PG quotes identifiers, so CamelCase names (`"PersonID"`, `"tblpatients"`) are preserved — but unquoted identifiers fold to lowercase, so a raw `sql` string with `tblPatients`/`dbo.` fails (`relation does not exist`). Match generated casing; tables mostly lowercase (`tblpatients`, `tblwork`), columns mixed-case.
- **Collation**: text columns are `citext` (case-insensitive `=`/`LIKE`/unique, accent-sensitive) to reproduce SQL Server's `Arabic_CI_AS`. The two image-type codes (`tblImageTypes.ImageTypeCode`, `tblTimePointImages.ImageType`) stay `char(2)`.
- **Dates**: columns are `timestamp`/`date` **WITHOUT** time zone (single-clinic wall-clock; `timestamptz` would reintroduce the UTC-midnight-shift bug). The `pg` parsers in `kysely.ts` return `date`→`'YYYY-MM-DD'` **string**, `timestamp`→local `Date`, `numeric`/`bigint`→`number`. kysely-codegen types `date` as `Date`, so SELECTs needing the string use a type-only `$castTo<string>()`. `utils/date.ts#toDateOnly` is the safety net. Don't `(col as Date).toISOString()` a `date` column — it's already a string.
- **Booleans**: `bit`→`boolean`; flags compare/insert JS `true|false`, not `0|1`.
- **NULL ordering**: PG sorts NULLs LAST on ASC (SQL Server sorted FIRST); add `NULLS FIRST` where exact order matters.
- **Identity**: PK columns are `GENERATED BY DEFAULT AS IDENTITY`; FK-violation detection uses PG SQLSTATE `23503` (was mssql `547`).

**Migrations**: schema is owned by **node-pg-migrate** — `migrations/pg/*.sql` (plain SQL up/down). Kysely is the runtime query builder, **not** the DDL owner. Regenerate `types/db.d.ts` after any schema change.

**Connection** (see `.env`): `localhost:5432`, db `shwan`, role `shwan_app` (Windows service `postgresql-x64-18`).

**Sessions live in PostgreSQL** (`express-session` via **`connect-pg-simple`**, wired in `index.ts`; the old `connect-sqlite3` store is retired). Two tables — `staff_sessions` (cookie `shwan.sid`) and `portal_sessions` (cookie `shwan.portal`) — owned by `migrations/pg` (store runs `createTableIfMissing: false`, never issues DDL) and sharing the `pg` pool via `getPgPool()`. **The only remaining SQLite is `services/archform/archform-db.ts`** — reads the external Archform aligner software's own SQLite file via `better-sqlite3` (intentional, third-party integration).

**mssql on disk**: the `mssql` package + `services/database/pool.ts` survive as migration tooling (`scripts/etl-mssql-to-pg`, `parity-*`, etc., which read the live SQL Server `ShwanNew`). No app-runtime code imports `pool.ts` **except the temporary Dolphin sink** (see Sync) — which only connects when explicitly enabled.

Schema reference: `migrations/init_script.sql` is a historical T-SQL dump of the old schema, kept as authoring reference. The live schema is `migrations/pg/`. `migrations/postgresql/` is for the separate aligner-portal-external app, not the main DB.

---

## Sync (unified CDC)

**One change feed, one Supabase database.** DB triggers capture every row change *once* into the coalescing `change_log`, and an engine replicates each sink's slice to its destination:
- **failover** — raw 1:1 mirror of the full DB into the **single** Supabase database. This is the *only* Supabase sink and the aligner portal's **future serving source** (the portal will read the raw tables directly). The sink keeps the name `failover` for its live `cdc_sink_control`/`change_log` rows, but it's the **primary mirror, not a fallback**. Runs permanently; must stay complete/live.
- **dolphin** — temporary, see below.

> **Retired:** the curated snake_case **portal** projection (`portal-sink.ts` + `sync-fetch.ts`) and the entire **reverse-sync** path (`sync-engine.ts`, `reverse-sync-poller.ts`, `POST /api/sync/webhook`) were removed when consolidating to one database. `aligner-portal-external` is deprecated until rewritten against the raw schema. The older app-level `SyncQueue` enqueue is also retired — don't reintroduce any of these. This is *not* logical replication and *not* nightly reloads.

**Code:** `services/sync/cdc/` — `engine.ts` (generic per-sink drain: batched, coalescing, version-guarded delete, anti-bloat breaker), `failover-sink.ts` (raw `pg` upsert), `index.ts` (`startCdc`/`stopCdc`/`drainCdcNow`, wired into boot + `gracefulShutdown`).

**On/off (per sink):** `FAILOVER_SYNC_ENABLED` (mirror), `DOLPHIN_SYNC_ENABLED` (dolphin) — default off in sandbox. Immediate kill switch without restart: `UPDATE cdc_sink_control SET enabled=false WHERE sink='failover';` (`cdc_capture()` then skips that sink).

**Don't regress:**
- Migrations `*_add-failover-cdc.sql` + `*_failover-cdc-fanout.sql` install a generic `cdc_capture()` trigger (`TG_ARGV = (pk_col, sink, …)`); `*_drop-portal-cdc-sink.sql` then removed the dead `portal` fanout. Now **all ~65 captured tables feed `failover` only**.
- **Loop guard (preserved for future reverse sync):** `cdc_capture()` still skips writes made under `SET LOCAL app.cdc_origin='reverse'`. Nothing sets that flag today, but the branch stays so reverse sync (Doctor notes + aligner `days`) can be reintroduced loop-free — **do not delete it** from the `cdc_capture()` function. Reverse v2 also needs a Supabase-side guard (react only to genuine portal edits on portal-owned fields, idempotent apply).
- **Add a table** = add a `cdc_capture('<PKcol>', 'failover')` trigger in a migration — no app code (`failover` auto-discovers table→PK from `pg_trigger`). **Not captured:** sessions, sync/migration infra (`change_log`, `cdc_sink_control`, `pgmigrations`), composite-PK `tblPrivatePhotos`.
- **Circuit breaker:** backlog past `FAILOVER_SYNC_MAX_BACKLOG` disables capture and sets `cdc_sink_control.stale` (→ full reload needed). An outage is a non-event — deltas coalesce and the engine retries.
- The mirror is **RLS-locked** (server-side only) until the portal is rewritten to read it via RLS/views. The initial full load / any full reload are **run by the user** (`C:\pg18-migration\`), as are prod-schema migrations — Claude's harness blocks the bulk push.

Live sink status surfaces in Settings via `public/js/components/react/SupabaseStatusSettings.tsx` (polls `GET /api/sync/supabase-status`).

### Dolphin sync (temporary)
A **third CDC sink** (`dolphin`) one-way-syncs the app's native timepoint/image rows into the legacy **Dolphin Imaging SQL Server DB** (`DolphinPlatform.dbo.Patients`/`TimePoints`/`TimePointImages`). The app already crops photos (`routes/api/photo-editor.routes.ts`) into the shared `working/` dir under Dolphin's `{personId}0{tpCode}.I{NN}` naming + local `tblTimePoints`/`tblTimePointImages` rows; this sink fills the Dolphin **DB tables** (no files copied) so Dolphin Imaging can see them. **Meant to be deleted** once the native pipeline is trusted — remove `services/sync/cdc/dolphin-sink.ts`, its `index.ts` entry, the `DOLPHIN_SYNC_*` env block, and migration `*_add-dolphin-cdc-sink.sql`.
- **Off by default** (`DOLPHIN_SYNC_ENABLED`); kill switch `UPDATE cdc_sink_control SET enabled=false WHERE sink='dolphin';`.
- **Reuses the surviving mssql pool** (`services/database/pool.ts`, `ShwanNew`; Dolphin via three-part `DolphinPlatform.dbo.*` names) — the one runtime mssql dependency, and only when enabled.
- **Mapping table** `dolphin_sync_map(local_table, local_pk) → dolphin_id` (un-triggered ⇒ no feedback loop) recovers the Dolphin GUID on delete, since the change feed carries no payload. The reserved `DolphinTpID`/`DolphinPatID`/`DolphinTpiID` columns are deliberately **not** written (those tables are captured — writing them would re-trigger the sink).
- Resolution/adoption mechanics (patient by `patOtherID=PersonID`, itypID lookup, natural-key adoption) live in `dolphin-sink.ts`. **Going-forward only — no backfill.** Timepoint delete = **cascade**.

---

## Realtime / SSE

WebSockets are retired — all server→client realtime flows over **Server-Sent Events**. The legacy `utils/websocket.ts`, `wsService`, `connectionManager`, and `public/js/constants/websocket-events.ts` are gone — **don't restore them.**

**Server**: `index.ts` creates a bare `new EventEmitter()` (named `wsEmitter` for symmetry with existing emit sites) and hands it to the broadcasters at boot:
- `services/messaging/sse-broadcaster.ts` — appointments + chair-display channels
- `services/messaging/sse-whatsapp.ts` — WhatsApp channel (QR, client-ready, message-status, progress)

Routes/services still emit internal events (`wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, date)`, `CHAIR_PATIENT_LOAD`, `WHATSAPP_*`); broadcasters translate them to SSE frames. Add new internal events to `services/messaging/websocket-events.ts` (filename is legacy — these are now in-process emitter names, never on the wire) and wire them in the relevant broadcaster's `ensureInitialized()`.

**Routes**:
- `GET /sse/chair-display/:chairId` — **public** (kiosk has no session; internal-LAN assumption).
- `GET /api/sse/appointments` and `GET /api/sse/whatsapp` — mounted **after** the auth gate; a 401 closes the EventSource.

**Transport hygiene** (each SSE handler does this — copy the pattern):
- `req.setTimeout(0); res.setTimeout(0)` — bypasses the global 30 s `requestTimeout` middleware (else every stream 408s at 30 s).
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Initial frame `retry: ${2500 + jitter}\n\n` so a restart doesn't trigger a thundering-herd reconnect.
- **One** module-scoped 25 s `setInterval` writes `:\n\n` comment frames to every open stream — undercuts Caddy's ~30 s idle drop.

**Client singletons**: `public/js/services/sse-appointments.ts` and `sse-whatsapp.ts` — refcounted (`ensureConnected()` on mount, `release()` on unmount; `EventSource` opened on first acquire, closed at refcount zero). **Never `new EventSource(...)` directly in app code** except the chair-display kiosk (`public/js/routes/ChairDisplay.tsx`, intentional standalone). Liveness/freshness, the "Live | Stale | Offline…" indicator (`appointments/ConnectionStatus.tsx`), and forced-reconnect triggers (visibility/pageshow, see `constants/sse-liveness.ts`) are handled inside these singletons.

**Other invariants**: chair-display keeps an in-memory current-patient map (12 h TTL, monotonic `chairEpoch` guards stale async LOADs; lost on restart by design). Every open `/api/sse/whatsapp` stream registers a QR viewer via `messageState.registerQRViewer()` — the `activeQRViewers > 0` check gates QR generation + on-demand WhatsApp init; don't break it. Graceful shutdown calls `teardownSseBroadcaster()` + `teardownWhatsappSseBroadcaster()` from `gracefulShutdown`.

---

## TypeScript / Path aliases

Dual config: `tsconfig.json` (backend), `tsconfig.frontend.json` (frontend), `tsconfig.build.json` (prod build). Strict mode on both.

**Backend aliases**: `@config/*`, `@services/*`, `@routes/*`, `@utils/*`, `@middleware/*`, `@types/*`
**Frontend aliases**: `@/*`, `@components/*`, `@services/*`, `@hooks/*`, `@contexts/*`, `@types/*` (tsconfig only — Vite resolves `@/*` for runtime; use it for value imports)

Use `import type { … }` for type-only imports.

---

## Environment

`.env.example` documents all vars by category. Required for boot: `PORT`, `MACHINE_PATH`, the PostgreSQL block (`PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD`, or `DATABASE_URL`), and `SESSION_SECRET`. Legacy `DB_*` (SQL Server) vars are used only by `scripts/` migration tooling and the Dolphin sink, not app boot. Optional service blocks (Telegram, Twilio, Google Drive, WebCeph, Gemini, Supabase sync) can be left blank to disable.

---

## Deployment & environments

- **Dev = WSL (Linux); Prod = Windows Server.** Code must run on both, and a future Linux server is planned — keep everything OS-agnostic. Use `utils/path-resolver.ts` + the platform `path` module for all filesystem paths; never hardcode `/` or `\`.
- **Patient data volume** is the SMB/UNC share `\\Clinic\clinic1` (`MACHINE_PATH`; `PatientsFolder` DB option), reachable from LAN PCs but **not phones**. It is a *separate volume* from the OS temp dir → `fs.rename` from temp to the share throws `EXDEV`; stage temp files on the same volume. Per-file `stat`/`lstat` over the share is a network round-trip — avoid bulk stat in hot paths.
- **Remote access**: two front doors to the same on-host Node app. On-LAN, **Caddy** reverse-proxies `local.shwan-orthodontics.com` (`Caddyfile`; see `middleware/index.ts` trust-proxy note). Off-LAN, a **cloudflared named tunnel** (`config_cloudflared.yml`) routes `remote.shwan-orthodontics.com` → `localhost:3000`. `config.urls.publicUrl` defaults to the remote domain. Tunnel credentials live outside the repo under the OS user's `.cloudflared/` dir — never commit or paste them.

---

## Testing credentials

```
Username: Admin   Password: Yarmok11
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
- After using Playwright, delete every screenshot it left behind before finishing.
