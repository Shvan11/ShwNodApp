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
`public/js/types/api.types.ts` holds the **envelope/utility** types only — `ApiResponse<T>` (`{ success, data?, error? }`). Per-endpoint request/response shapes now live in the **shared contracts** (see next section), not here.
- Import as `import type { ApiResponse } from '@/types/api.types'` — the `@types/*` alias works in tsconfig but **not** Vite, so it breaks value exports at build.
- UI form/hook state stays inline. `pages/aligner/aligner.types.ts` keeps UI-only aligner types but **re-exports** its 6 canonical row types from `shared/contracts/aligner.contract.ts` (folded — the contract is the single source of truth).

### Shared API contracts — `shared/contracts/*.contract.ts` (cross-boundary SSoT) — **MANDATORY for new endpoints**
Every staff-app endpoint's request **and** response shape is authored **once** as Zod in `shared/contracts/<group>.contract.ts` and imported by **both** sides — Express routes via relative `.js`, the React app via the `@shared` alias. Drift then becomes a server **compile error** *and* a client **fail-loud** runtime throw. All 5 Tier-1 groups + every other enveloped staff route are contracted (**29 contracts**) — the rollout is **100% complete and locked-in** (request bodies + params/query folded → D1=0; responses modeled → D2 allowlist; client reads guarded; see **Lock-in** below). **New or changed endpoints follow this — no exceptions.** Tracker + full findings: `docs/shared-contract-progress.md`.

- **Shape:** one `export const <action> = { body?, params?, query?, response } as const` per endpoint; also export the `z.infer` types (`<Action>Response`, `<Action>Body`). Action names are natural noun-phrases; on a collision with a consumer local, alias the import `…Contract`.
- **Server:** `validate({ body/params/query })` references the **contract's** schemas (never a fresh inline one), and the handler returns via **`sendData(res, <action>.response, data)`** — NOT `sendSuccess`. `sendData` dev-parses (`NODE_ENV !== 'production'`, zero prod CPU) and types `data` to the contract, so drift is a build error.
- **Client:** `fetchJSON<Resp>(url, { schema: <action>.response })` — keep the explicit generic (`{ schema }` does **not** infer it). Route loaders forward `schema` through `apiLoader`. **This client schema is the ONLY runtime guard in prod** (the server parse is dev-only), so **every read MUST carry `{ schema }`** — enforced by the `require-schema-on-reads` ESLint rule. A deliberately schema-less read (literal-null signal, raw passthrough, status ping, fire-and-forget) takes an inline `// eslint-disable-next-line no-restricted-syntax` with a reason.
- **NEVER hand-write a parallel `XxxBody`/response `interface` for a contracted endpoint.** Request bodies are **fully enumerated** so `z.infer<typeof <a>.body>` is the single source of truth; delete the hand-written interface and type the handler `Request<…, z.infer<typeof <a>.body>>`. (This OVERRIDES the older loose-schema-plus-interface convention, which now applies *only* to not-yet-contracted routes.) Trace every field 3 ways before enumerating — handler destructure + service input + query column writes — and make required-vs-optional match exactly what the service requires (don't 400 a field callers legitimately omit).

**Authoring rules (each one cost a gate failure to learn — respect them):**
- **Container default `z.looseObject`**, not `z.object`. `core/http` returns the *parsed* payload and Zod 4 `z.object` **strips** unknown keys, so any long-tail field the UI reads must be preserved by `looseObject`. Use plain `z.object` only for closed, fully-modeled containers. (Same reason a body's `validate()` write-back would *drop* an un-enumerated field under strict — looseObject fails safe.)
- **A `sendData` data source must be a `type` alias or inline literal, NEVER an `interface`.** `looseObject` infers a string index signature and TS won't assign an `interface`-typed value to it (`TS2345`). Flip the query/route `interface`→`type` (cheap; grep for `extends`/declaration-merge first).
- `sendData`'s `data` arg is typed **`z.input<S>`** (only matters for transform primitives).
- Primitives in `shared/validation.ts`: **`timestampString`** for PG `timestamp` columns (Date server-side / string client-side); **`anyArray`** (`z.array(z.unknown())`) and **`z.unknown()`** are the flip-free loose guards for service-bound shapes — they assert the array-vs-object class and preserve the payload without forcing an interface→type flip.
- **Leave deliberately-raw endpoints alone:** un-enveloped `null` signals (e.g. diagnosis GET), PDF/stream/`res.send` responses, and **raw whatsapp `apiClient` consumers** (they read top-level fields and don't unwrap the envelope — nesting under `data` would hide them). Always check the consumer's transport before migrating an envelope.

**Lock-in (enforced — the rollout is ratcheted, don't regress it):** `npm run gate` (= `typecheck:all` + `lint` + `contracts:check --strict` + `build`) runs locally **and** in `.github/workflows/gate.yml` on every push/PR. It fails if: a hand-written request `interface *Body|*Params|*Query|*Filters` appears in `routes/` (ESLint `no-restricted-syntax` — author it as Zod in the contract instead); a `fetchJSON`/`apiLoader` read lacks `{ schema }` (`require-schema-on-reads`); or `scripts/contracts-dod.mjs` (`npm run contracts:check`) sees **D1** (request interfaces, target **0**) or **D2** (loose response markers, allowlist **37**) regress past baseline. A new loose `z.unknown()`/`anyArray` response needs an inline `// Intentionally loose:` justification + a bump to the D2 allowlist, or it trips the gate. (`anyArray` is the shared `z.array(z.unknown())` primitive in `shared/validation.ts`.)

### The HTTP funnel — `core/http.ts` only (audit H1/H2/H4/H8/M8/H11)
Every staff-app request goes through `core/http.ts` (`fetchJSON`/`postJSON`/`putJSON`/`patchJSON`/`deleteJSON`/`postFormData`); bare `fetch()` in `public/**` is an **ESLint error** (the few legit blob/stream/beacon exceptions carry an inline disable; the patient portal is its own raw Zod boundary). It unwraps the `sendSuccess` `{success,data}` envelope (so callers get the inner payload), **attaches the `x-csrf-token` header on mutations** (CSRF double-submit — `middleware/csrf.ts` server-side; a 403 `EBADCSRFTOKEN` auto-refetches the token + retries once), enforces a **30s timeout**, and accepts an optional Zod `schema` that **throws on mismatch** (fail-loud response validation — schemas live in the shared contracts `shared/contracts/*.contract.ts`; the old `core/api.schemas.ts` was deleted, see the Shared API contracts section). So: never bypass it for a mutation (you'd lose the CSRF token → 403) — and on the rare sanctioned blob/stream exception that *must* raw-`fetch` a mutation (e.g. `LabelPreviewModal`'s PDF-blob POST, the bespoke `whatsapp-api-client.ts`), you MUST attach `'x-csrf-token': await prefetchCsrfToken()` yourself, or `staffCsrfProtection` 403s the tokenless request (the GET-only blob/beacon exceptions don't need it — only POST/PUT/PATCH/DELETE are checked). Read the server's friendly error in a `catch` via `httpErrorMessage(err, fallback)`.

### React Query — live-invalidated reads only
Two screens run on `@tanstack/react-query` (`QueryClientProvider` in `App.tsx`), both keyed by date with SSE → `invalidateQueries`: the **daily-appointments** screen (`useAppointments`/`useAppointmentsSync`/`DailyAppointments`, reconnect/periodic-driven) and the **WhatsApp message-status table** (`useMessageStatus`, refetched by the `whatsapp_message_status` SSE tick that `useWhatsAppSync` surfaces). RQ is reserved for exactly this shape — a parameterized read refetched by real-time / multi-trigger invalidation. Everywhere else still uses **route loaders** (`router/loaders.ts`, `apiLoader`) + the funnel — RQ was adopted as a staged layer, not an app-wide rewrite. Don't migrate other screens to RQ without that justification.

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
- **`Database` type** is generated by `npm run db:codegen` → `types/db.d.ts` — the single source of truth for table/column names. The schema is **all lowercase `snake_case`**: tables `patients`, `works`, `appointments`, `time_points`, `aligner_sets`; columns `person_id`, `city_id`, `aligner_set_id`. The SQL-Server-era `tbl*`/PascalCase names (`tblPatients`, `"PersonID"`) and the `dbo.` schema prefix are **gone** — a raw `sql` string using them fails (`relation does not exist`). Match the generated casing; since every identifier is already lowercase, quoting is rarely needed.
- **Collation**: text columns are `citext` (case-insensitive `=`/`LIKE`/unique, accent-sensitive) to reproduce SQL Server's `Arabic_CI_AS`. The two image-type codes (`image_types.image_type_code`, `time_point_images.image_type`) stay `char(2)`.
- **Dates**: columns are `timestamp`/`date` **WITHOUT** time zone (single-clinic wall-clock; `timestamptz` would reintroduce the UTC-midnight-shift bug). The `pg` parsers in `kysely.ts` return `date`→`'YYYY-MM-DD'` **string**, `timestamp`→local `Date`, `numeric`/`bigint`→`number`. `db:codegen` runs with `--date-parser string`, so the generated `Database` types match this at the boundary: `date` columns are typed **`string`**, `timestamp` columns stay `Date`. Generated types are the single source of truth — **don't** add a `$castTo<string>()` to read a `date` column (it's already `string`), and bind `date` params/inserts as `'YYYY-MM-DD'` strings (use `sql<string>` for raw date expressions, not `sql<Date>`). `utils/date.ts#toDateOnly` normalizes any `Date|string` to the date-only string. Don't `(col as Date).toISOString()` a `date` column — it's already a string.
- **Booleans**: `bit`→`boolean`; flags compare/insert JS `true|false`, not `0|1`.
- **NULL ordering**: PG sorts NULLs LAST on ASC (SQL Server sorted FIRST); add `NULLS FIRST` where exact order matters.
- **Identity**: PK columns are `GENERATED BY DEFAULT AS IDENTITY`; FK-violation detection uses PG SQLSTATE `23503` (was mssql `547`).

**Migrations**: schema is owned by **node-pg-migrate** — `migrations/pg/*.sql` (plain SQL up/down). Kysely is the runtime query builder, **not** the DDL owner. Regenerate `types/db.d.ts` after any schema change.

**Connection** (see `.env`): `localhost:5432`, db `shwan`, role `shwan_app` (Windows service `postgresql-x64-18`).

**Sessions live in PostgreSQL** (`express-session` via **`connect-pg-simple`**, wired in `index.ts`; the old `connect-sqlite3` store is retired). Two tables — `staff_sessions` (cookie `shwan.sid`) and `portal_sessions` (cookie `shwan.portal`) — owned by `migrations/pg` (store runs `createTableIfMissing: false`, never issues DDL) and sharing the `pg` pool via `getPgPool()`. **The only remaining SQLite is `services/archform/archform-db.ts`** — reads the external Archform aligner software's own SQLite file via `better-sqlite3` (intentional, third-party integration).

**mssql on disk**: the Postgres cutover is **complete**, and the one-off migration/parity scripts that read the live SQL Server (`etl-mssql-to-pg`, `parity-*`, `check-pg-*`, `probe-*`, `check-schema-parity`, `diff-sandbox-vs-prod`, `schema-rename/*`) have been **removed**. The `mssql` package + `services/database/pool.ts` now survive **only** for the temporary Dolphin sink (see Sync) — the sole app-runtime importer of `pool.ts`, which reads the legacy `DolphinPlatform`/`ShwanNew` SQL Server and connects only when explicitly enabled. When the Dolphin sink is deleted, `pool.ts` + the `mssql` dependency can go with it.

Schema reference: `migrations/init_script.sql` is a historical T-SQL dump of the old schema, kept as authoring reference. The live schema is `migrations/pg/`. `migrations/postgresql/` is for the separate aligner-portal-external app, not the main DB.

---

## Sync (unified CDC)

**One change feed per direction, one Supabase database.** DB triggers capture every row change *once* into a coalescing `change_log`, and an engine replicates each sink's slice to its destination:
- **failover** — raw 1:1 mirror of the full DB into the **single** Supabase database (local → Supabase). This is the primary Supabase sink and the aligner portal's **future serving source** (the portal will read the raw tables directly). The sink keeps the name `failover` for its live `cdc_sink_control`/`change_log` rows, but it's the **primary mirror, not a fallback**. Runs permanently; must stay complete/live.
- **reverse** — the **two-way** path (Supabase → local), the symmetric mirror image of `failover`. A web/portal edit on Supabase is captured into a `change_log` that lives **on Supabase** and applied back to local through a dedicated max-2 pool. **Whole-row last-write-wins** by `updated_at` (forward `>=`, reverse `>` → ties to local); deletes propagate both ways. Off by default (`REVERSE_SYNC_ENABLED`). See the reverse-sync subsection.
- **dolphin** — temporary, see below.

> **Retired (the OLD reverse path, not reverse v2):** the curated snake_case **portal** projection (`portal-sink.ts` + `sync-fetch.ts`) and the **old** reverse path (`sync-engine.ts`, `reverse-sync-poller.ts`, `POST /api/sync/webhook`) were removed when consolidating to one database. The current **reverse v2** above is a *different* implementation — same CDC engine, a `change_log` on Supabase — not those files; don't reintroduce them or the app-level `SyncQueue` enqueue. `aligner-portal-external` is deprecated until rewritten against the raw schema. This is *not* logical replication and *not* nightly reloads.

**Code:** `services/sync/cdc/` — `engine.ts` (generic per-sink drain: batched, coalescing, version-guarded delete, anti-bloat breaker; `EngineOpts.source` selects the feed DB — local default, Supabase for reverse), `cdc-schema.ts` (shared PK/generated/`updated_at` discovery + the LWW `ON CONFLICT` clause builder), `supabase-pool.ts` (the two SHARED Supabase pools — forward-write tagged `app.cdc_origin='failover'`, plain reverse-read — + `teardownSupabasePools()`), `failover-sink.ts` (raw `pg` upsert, LWW on `updated_at` tables), `reverse-sink.ts` (Supabase→local apply under `origin='reverse'`), `index.ts` (`startCdc`/`stopCdc`/`drainCdcNow`, wired into boot + `gracefulShutdown`).

**On/off (per sink):** `FAILOVER_SYNC_ENABLED` (mirror), `DOLPHIN_SYNC_ENABLED` (dolphin), `REVERSE_SYNC_ENABLED` (two-way) — default off in sandbox. Immediate kill switch without restart: `UPDATE cdc_sink_control SET enabled=false WHERE sink='failover';` (`cdc_capture()` then skips that sink). **The `reverse` sink's `cdc_sink_control`/`change_log` live on SUPABASE**, so its kill switch runs THERE: `UPDATE cdc_sink_control SET enabled=false WHERE sink='reverse';`.

**Don't regress:**
- Migrations `*_add-failover-cdc.sql` + `*_failover-cdc-fanout.sql` install a generic `cdc_capture()` trigger (`TG_ARGV = (pk_col, sink, …)`); `*_drop-portal-cdc-sink.sql` then removed the dead `portal` fanout. Now **all ~65 captured tables feed `failover` only**.
- **Dual origin guard (NOW ACTIVE — reverse v2 uses it; do not delete either branch):** the loop is broken by tagging each side's sync-writes so the *other* side's triggers ignore them, and the guard covers **both** the capture trigger **and** the version (`updated_at`) trigger on each side. **Local:** `cdc_capture()` AND `set_updated_at()` both `RETURN` early under `SET LOCAL app.cdc_origin='reverse'` (the reverse sink sets this per apply txn) — no forward echo, and the incoming Supabase `updated_at` is preserved verbatim (the LWW keystone — re-stamping would make reverse applies always win). **Supabase:** the mirror-only `cdc_capture_remote()` AND `set_updated_at_remote()` skip under `app.cdc_origin='failover'` (the forward-write pool tags every connection) — no reverse echo, and the mirrored local `updated_at` is preserved. **Ordering hazard:** the forward-write GUC code MUST be live before `set_updated_at_remote` exists on Supabase, or live forward writes clobber every mirrored `updated_at`.
- **Add a table** = add a `cdc_capture('<PKcol>', 'failover')` trigger in a migration — no app code (`failover` auto-discovers table→PK from `pg_trigger`, requiring a **single-column** PK). **Not captured:** sessions, sync/migration infra (`change_log`, `cdc_sink_control`, `pgmigrations`). (`private_photos` was composite-PK and excluded; it now carries a surrogate identity PK `id` (natural key kept as `UNIQUE`) and **is** captured — its Supabase mirror needs the matching `id`-PK schema + a one-time row load.)
- **Schema/DDL parity is manual — CDC replicates row DATA only, never DDL.** The Supabase mirror must stay **100% identical to local `shwan`** (the live PG), excepting only the deliberate sync-infra asymmetries: (a) each side's own feed tables (`change_log` + `cdc_sink_control` exist on **both** now — local drains `failover`/`dolphin`, Supabase drains `reverse`; `dolphin_sync_map` is local-only); (b) the triggers/functions are each side's own — local `cdc_capture()`/`set_updated_at()`, Supabase `cdc_capture_remote()`/`set_updated_at_remote()` (the reverse-set capture/version triggers, mirror-only); and (c) **the ONE intentional column divergence: identity sequences on the reverse set run `INCREMENT BY 2` — local ODD, Supabase EVEN — so sync inserts never collide** (see reverse-sync subsection). **Everything else — every table, column, type, nullability, default/identity, PK/FK/unique/check constraint, and index — must match exactly.** So *any* DDL applied to local (`migrations/pg/*.sql` — add/drop/alter column, type change, new constraint/index, new captured table, identity change) **must be mirrored to Supabase in the same change**, or the mirror silently drifts (a missing column = that field is dropped on upsert; a missing identity = the bug we hit with `private_photos.id`). New captured tables also need their one-time row load on Supabase. (Session tables `staff_sessions`/`portal_sessions` + `pgmigrations` happen to exist on the mirror today — harmless; not load-bearing for parity.) Verify with the column/constraint/index/content-hash diff against both DBs; note the **PG-version artifact** — local is PG 18 (catalogs `NOT NULL` as named `pg_constraint` rows), Supabase is PG 17 (doesn't), so ignore `contype='n'` rows when diffing constraints. **The bulk push / full reload is run by the user** (harness blocks it), but small additive DDL can be applied directly via the `SUPABASE_FAILOVER_DB_URL`.
- **Circuit breaker:** backlog past `FAILOVER_SYNC_MAX_BACKLOG` disables capture and sets `cdc_sink_control.stale` (→ full reload needed). An outage is a non-event — deltas coalesce and the engine retries.
- The mirror is **RLS-locked** (server-side only) until the portal is rewritten to read it via RLS/views. The initial full load / any full reload are **run by the user** (`C:\pg18-migration\`), as are prod-schema migrations — Claude's harness blocks the bulk push.

Live sink status surfaces in Settings via `public/js/components/react/SupabaseStatusSettings.tsx` (polls `GET /api/sync/supabase-status`, which reports **both** `failover` and `reverse` cards).

### Reverse sync (two-way) — Supabase → local

The symmetric mirror image of forward CDC: the same `engine.ts` drains a `change_log` that lives **on Supabase** and `reverse-sink.ts` applies each change to local. Off by default (`REVERSE_SYNC_ENABLED`). Local hot path is untouched — **no new local triggers, no new local columns** (`db.d.ts` unchanged); all reverse *detection* is on Supabase, and reverse applies go through a dedicated **max-2** local pool that can't contend with the app's 10-conn pool.

- **Scope = the reverse set:** captured tables that already carry an `updated_at` column (the 25 from `…_unified-updated-at-and-cleanup.sql`; lookup tables have none → forward-only). Auto-discovered both sides, so a new `updated_at` table auto-enrolls — add a denylist to the discovery query if a sensitive table (e.g. `patient_portal_auth`) must stay forward-only.
- **Conflict = whole-row LWW by `updated_at`** via the `ON CONFLICT … WHERE` clause (`cdc-schema.ts#lwwUpdateClause`): forward `>=` (local wins ties), reverse `>` (Supabase overwrites only when strictly newer). Deletes are **unconditional both ways** (delete-vs-edit race is an accepted limitation — no tombstones yet). The keystone: the **version trigger honours the origin guard** on each side, so `updated_at` travels verbatim with the row (see the dual-origin-guard bullet).
- **Odd/even identity sequences** keep the two DBs' mints disjoint: local `INCREMENT BY 2` ODD, Supabase EVEN (identity is `BY DEFAULT`, so explicit sync inserts don't advance the receiving sequence). Re-base in a **quiet window with forward backlog 0** (so `max(id)` agrees) — the local odd half is `migrations/pg/…_reverse-sync-version-guard-and-odd-pk.sql`, the Supabase even half is `migrations/supabase/reverse-cdc.sql §5`. Text-PK (`options`) / shared-PK (`patient_portal_auth`) tables have no own sequence → auto-skipped, still LWW-reverse-writable.
- **Supabase-only infra** (`migrations/supabase/reverse-cdc.sql`, committed; applied via `SUPABASE_FAILOVER_DB_URL`, NOT a node-pg-migrate file): `change_log` + `cdc_sink_control('reverse')`, `set_updated_at_remote()` + `cdc_capture_remote()` (both skip `origin='failover'`), attached to the reverse set. **Ordering:** deploy the forward-write-GUC code **before** applying this, or live mirror writes clobber `updated_at`.
- **Full reload now needs the origin flag:** a bulk reload not carrying `app.cdc_origin='failover'` will hit `set_updated_at_remote` and stamp fresh timestamps over every reloaded `updated_at` (gated by the flag, NOT by `cdc_sink_control`, so disabling the reverse sink alone is not enough). Run reloads with `PGOPTIONS=-c app.cdc_origin=failover` (or `DISABLE TRIGGER` the two `*_remote` triggers), then re-apply the even sequences. Still user-run.
- **Read-only web role** (`migrations/supabase/mirror-grants.sql`, committed, idempotent — prepping a full web app): a dedicated `mirror_rw LOGIN BYPASSRLS` role (creation + password **user-run/secret, never committed**) gets `SELECT` on all tables + `INSERT/UPDATE/DELETE` only on the reverse set (+ sequence `USAGE`), so "writable on Supabase ⟺ in the reverse set" holds even for a raw password connection. Caveat by design: connecting as the owner bypasses it (the forward sync/reload use the owner URL) — web writes MUST use `mirror_rw`.

### Dolphin sync (temporary)
A **third CDC sink** (`dolphin`) one-way-syncs the app's native timepoint/image rows into the legacy **Dolphin Imaging SQL Server DB** (`DolphinPlatform.dbo.Patients`/`TimePoints`/`TimePointImages`). The app already crops photos (`routes/api/photo-editor.routes.ts`) into the shared `working/` dir under Dolphin's `{personId}0{tpCode}.I{NN}` naming + local `time_points`/`time_point_images` rows; this sink fills the Dolphin **DB tables** (no files copied) so Dolphin Imaging can see them. **Meant to be deleted** once the native pipeline is trusted — remove `services/sync/cdc/dolphin-sink.ts`, its `index.ts` entry, the `DOLPHIN_SYNC_*` env block, and migration `*_add-dolphin-cdc-sink.sql`.
- **Off by default** (`DOLPHIN_SYNC_ENABLED`); kill switch `UPDATE cdc_sink_control SET enabled=false WHERE sink='dolphin';`.
- **Reuses the surviving mssql pool** (`services/database/pool.ts`, `ShwanNew`; Dolphin via three-part `DolphinPlatform.dbo.*` names) — the one runtime mssql dependency, and only when enabled.
- **Mapping table** `dolphin_sync_map(local_table, local_pk) → dolphin_id` (un-triggered ⇒ no feedback loop) recovers the Dolphin GUID on delete, since the change feed carries no payload. The reserved `dolphin_tp_id`/`dolphin_pat_id`/`dolphin_tpi_id` columns are deliberately **not** written (those tables are captured — writing them would re-trigger the sink).
- Resolution/adoption mechanics (patient by Dolphin's `patOtherID` = app `person_id`, itypID lookup, natural-key adoption) live in `dolphin-sink.ts`. **Going-forward only — no backfill.** Timepoint delete = **cascade**.

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

`.env.example` documents all vars by category. Required for boot: `PORT`, `MACHINE_PATH`, the PostgreSQL block (`PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD`, or `DATABASE_URL`), and `SESSION_SECRET`. Legacy `DB_*` (SQL Server) vars are used only by the Dolphin sink (see Sync), not app boot. Optional service blocks (Telegram, Twilio, Google Drive, WebCeph, Gemini, Supabase sync) can be left blank to disable.

---

## Deployment & environments

- **Dev = WSL (Linux); Prod = Windows Server.** Code must run on both, and a future Linux server is planned — keep everything OS-agnostic. Use `utils/path-resolver.ts` + the platform `path` module for all filesystem paths; never hardcode `/` or `\`.
- **Patient data volume — server access is LOCAL, not SMB.** The Node server reads/writes patient files on the local disk: `MACHINE_PATH=C:` → `pathResolver('clinic1/…')` → `C:\clinic1\…` via direct NTFS. **There is no SMB redirector in the server's I/O path.** The `\\CLINIC\Clinic1\` UNC is a *separate, client-facing* pointer — the `PatientsFolder` DB option is served to the browser, which opens it via the `explorer:` protocol handler **on the user's own LAN PC** (`Navigation.tsx`); that machine isn't the server and can only reach the folder over the share, so this value must stay UNC (same for `VideosPath = \\CLINIC\ovideos\` and `ARCHFORM_DB_PATH = \\WORK_PC\…`, a different host). LAN PCs can reach the share, phones can't.
- **Filesystem discipline — portability insurance, not a current-prod cost.** On prod-as-wired everything is on local `C:`, so `stat`/`lstat` is cheap and `fs.rename` never crosses volumes. Keep two habits anyway, because they *do* bite on **WSL dev** (`/mnt/c` drvfs) and a planned **network-mounted Linux server**: (1) avoid bulk per-file `stat`/`lstat` in hot paths — take type from `readdir`'s `Dirent` instead (see `walkFlat` vs the metadata `lstat` in `listDirectory`); (2) stage temp files on the **same volume as their destination** and `rename` into place — the `${dest}.tmp-${pid}-${ts}` pattern, and multer staging in `clinic1/.uploads/{id}` — so a genuinely-remote volume can never throw `EXDEV`.
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
