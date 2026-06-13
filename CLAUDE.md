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
- `public/js/router/routes.config.tsx` — route table; `loaders.ts` — route loaders (thin prefetchers into the React Query cache via `query/loaderQuery`)
- `public/js/query/` — the server-state layer: `client.ts` (shared `QueryClient`), `keys.ts` (`qk` key factory), `queries.ts` (`queryOptions` factories), `loaderQuery.ts`, `useApiMutation.ts`
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
Every staff-app endpoint's request **and** response shape is authored **once** as Zod in `shared/contracts/<group>.contract.ts` and imported by **both** sides — Express routes via relative `.js`, the React app via the `@shared` alias. Drift then becomes a server **compile error** *and* a client **fail-loud** runtime throw. All 5 Tier-1 groups + every other enveloped staff route are contracted (one module per group in `shared/contracts/`) — the rollout is **100% complete and locked-in** (request bodies + params/query folded → D1=0; responses modeled → D2 allowlist; client reads guarded; see **Lock-in** below). **New or changed endpoints follow this — no exceptions.** Tracker + full findings: `docs/shared-contract-progress.md`.

- **Shape:** one `export const <action> = { body?, params?, query?, response } as const` per endpoint; also export the `z.infer` types (`<Action>Response`, `<Action>Body`). Action names are natural noun-phrases; on a collision with a consumer local, alias the import `…Contract`.
- **Server:** `validate({ body/params/query })` references the **contract's** schemas (never a fresh inline one), and the handler returns via **`sendData(res, <action>.response, data)`** — NOT `sendSuccess`. `sendData` dev-parses (`NODE_ENV !== 'production'`, zero prod CPU) and types `data` to the contract, so drift is a build error.
- **Client:** `fetchJSON<Resp>(url, { schema: <action>.response })` — keep the explicit generic (`{ schema }` does **not** infer it). Route loaders carry `schema` via the `query/queries.ts` `queryOptions` factories (each factory's `queryFn` calls `fetchJSON` with the contract `.response`). **This client schema is the ONLY runtime guard in prod** (the server parse is dev-only), so **every read MUST carry `{ schema }`** — enforced by the `require-schema-on-reads` ESLint rule. A deliberately schema-less read (literal-null signal, raw passthrough, status ping, fire-and-forget) takes an inline `// eslint-disable-next-line no-restricted-syntax` with a reason.
- **NEVER hand-write a parallel `XxxBody`/response `interface` for a contracted endpoint.** Request bodies are **fully enumerated** so `z.infer<typeof <a>.body>` is the single source of truth; delete the hand-written interface and type the handler `Request<…, z.infer<typeof <a>.body>>`. (This OVERRIDES the older loose-schema-plus-interface convention, which now applies *only* to not-yet-contracted routes.) Trace every field 3 ways before enumerating — handler destructure + service input + query column writes — and make required-vs-optional match exactly what the service requires (don't 400 a field callers legitimately omit).

**Authoring rules (each one cost a gate failure to learn — respect them):**
- **Container default `z.looseObject`**, not `z.object`. `core/http` returns the *parsed* payload and Zod 4 `z.object` **strips** unknown keys, so any long-tail field the UI reads must be preserved by `looseObject`. Use plain `z.object` only for closed, fully-modeled containers. (Same reason a body's `validate()` write-back would *drop* an un-enumerated field under strict — looseObject fails safe.)
- **A `sendData` data source must be a `type` alias or inline literal, NEVER an `interface`.** `looseObject` infers a string index signature and TS won't assign an `interface`-typed value to it (`TS2345`). Flip the query/route `interface`→`type` (cheap; grep for `extends`/declaration-merge first).
- `sendData`'s `data` arg is typed **`z.input<S>`** (only matters for transform primitives).
- Primitives in `shared/validation.ts`: **`timestampString`** for PG `timestamp` columns (Date server-side / string client-side); **`anyArray`** (`z.array(z.unknown())`) and **`z.unknown()`** are the flip-free loose guards for service-bound shapes — they assert the array-vs-object class and preserve the payload without forcing an interface→type flip.
- **Leave deliberately-raw endpoints alone:** un-enveloped `null` signals (e.g. diagnosis GET), PDF/stream/`res.send` responses, and **raw whatsapp `apiClient` consumers** (they read top-level fields and don't unwrap the envelope — nesting under `data` would hide them). Always check the consumer's transport before migrating an envelope.

**Lock-in (enforced — the rollout is ratcheted, don't regress it):** `npm run gate` (= `typecheck:all` + `lint` + `contracts:check --strict` + `build`) runs locally **and** in `.github/workflows/gate.yml` on every push/PR. It fails if: a hand-written request `interface *Body|*Params|*Query|*Filters` appears in `routes/` (ESLint `no-restricted-syntax` — author it as Zod in the contract instead); a `fetchJSON` read lacks `{ schema }` (`require-schema-on-reads`; reads now flow through the `query/queries.ts` factories); or `scripts/contracts-dod.mjs` (`npm run contracts:check`) sees **D1** (request interfaces, target **0**) or **D2** (loose response markers, allowlist **37**) regress past baseline. A new loose `z.unknown()`/`anyArray` response needs an inline `// Intentionally loose:` justification + a bump to the D2 allowlist, or it trips the gate. (`anyArray` is the shared `z.array(z.unknown())` primitive in `shared/validation.ts`.)

### The HTTP funnel — `core/http.ts` only (audit H1/H2/H4/H8/M8/H11)
Every staff-app request goes through `core/http.ts` (`fetchJSON`/`postJSON`/`putJSON`/`patchJSON`/`deleteJSON`/`postFormData`); bare `fetch()` in `public/**` is an **ESLint error** (the few legit blob/stream/beacon exceptions carry an inline disable; the patient portal is its own raw Zod boundary). It unwraps the `sendSuccess` `{success,data}` envelope (so callers get the inner payload), **attaches the `x-csrf-token` header on mutations** (CSRF double-submit — `middleware/csrf.ts` server-side; a 403 `EBADCSRFTOKEN` auto-refetches the token + retries once), enforces a **30s timeout**, and accepts an optional Zod `schema` that **throws on mismatch** (fail-loud response validation — schemas live in `shared/contracts/*.contract.ts`). So: never bypass it for a mutation (you'd lose the CSRF token → 403) — and on the rare sanctioned blob/stream exception that *must* raw-`fetch` a mutation (e.g. `LabelPreviewModal`'s PDF-blob POST, the bespoke `whatsapp-api-client.ts`), you MUST attach `'x-csrf-token': await prefetchCsrfToken()` yourself, or `staffCsrfProtection` 403s the tokenless request (the GET-only blob/beacon exceptions don't need it — only POST/PUT/PATCH/DELETE are checked). Read the server's friendly error in a `catch` via `httpErrorMessage(err, fallback)`.

### React Query — the single server-state layer (`public/js/query/`)
**`@tanstack/react-query` (v5) owns all staff-app server state** (`QueryClientProvider` in `App.tsx`; the client itself lives in `query/client.ts` so loaders can import it outside React). The old sessionStorage **`loader-cache.ts` + the hand-rolled `invalidate*Cache()` contract are GONE** — don't reintroduce them.

- **Keys:** one **hierarchical** factory `qk` (`query/keys.ts`) is the SSoT for every key (replaces the old string keys). Parent keys are prefixes of their children, so `invalidateQueries({ queryKey: qk.patient.all(id) })` refreshes that patient's info + works + timepoints in one call — this is how cross-domain staleness closes. `qk.patient.info` and `qk.patient.full` are deliberately distinct (`/info` vs `/:id` are different endpoints).
- **Reads:** a `queryOptions` factory per read in `query/queries.ts` (pairs a `qk` key with `fetchJSON` + the contract `.response`), reused by **both** route loaders (prefetch via `loaderQuery` → `ensureQueryData`, so first paint is flash-free) **and** components (`useQuery(xxxQuery(id))`). Add a new read = add a factory here. `/api/patients/:id/info` is deduped to one cache entry across PatientShell/Work/View/Xrays/Diagnosis.
- **Mutations:** after a write, **`queryClient.invalidateQueries({ queryKey: qk.<domain>(id) })`** — pick the hierarchical key that covers everything the write changed (e.g. a work add/finish invalidates `qk.patient.all(personId)` so the works list refreshes app-wide). `query/useApiMutation.ts` wraps `useMutation` + this invalidation and is the **standard for new mutations**; existing handlers call `queryClient.invalidateQueries` directly (same mechanism). `isInvalidStateTransition(err)` (exported there) is the shared 400-conflict predicate for the silent-reload recovery.
- **SSE screens** (daily-appointments: `useAppointments`/`useAppointmentsSync`; WhatsApp status: `useMessageStatus`/`useWhatsAppSync`) keep their `keepPreviousData` + SSE→`invalidateQueries` + conflict-recovery shape; they now build keys via `qk.appointments.daily` / `qk.whatsapp.messages`.
- **Deliberate exceptions (loaders are the right tool, not a regression):** `PatientManagement` (URL-param search + scroll restoration; its list self-refreshes via `executeSearch`) and `PatientSets` (nested per-set batch map, self-managed `loadBatches`) keep their loader-fed / self-managed reads; both only swapped their cross-screen `invalidate*Cache` for `invalidateQueries`.

### Runtime validation (Zod) — boundaries only
Zod validates **untrusted input crossing into the app**, nowhere else: request bodies/params/query, env at boot, and `res.json()` parsing on external-facing (Patient Portal) calls. Use the shared `validate({ body?, params?, query? })` middleware (`middleware/validate.ts`) on routes — it parses, coerces, writes back, and 400s via `ErrorResponses`. The schema is the **single source of truth**: derive types with `z.infer<typeof schema>`, never hand-write a parallel `interface` beside it. The boot env schema lives in `config/config.ts` (throws on missing PG / SESSION_SECRET / MACHINE_PATH).
- **Never** validate Kysely/DB results (already typed from `types/db.d.ts` — the DB is a source we own), nor internal function calls (that's what TypeScript is for). Re-validating trusted data is wasted CPU and a second source of truth.

### CSS Modules
```typescript
import styles from './Component.module.css';
<div className={styles.container}>
```
No inline styles (except dynamic), no `!important` (except print/a11y). Use the design tokens for colors/spacing/z-index/breakpoints — don't invent values inline. Tokens are two-tier: `public/css/base/tokens-primitive.css` (fixed: raw `--palette-*` ramps, brand colors, all structural tokens) → `tokens-semantic.css` (light theme: surfaces/text/borders/hue-scales/status/shadows under their existing names) → `theme-dark.css` (dark overrides under `:root[data-theme="dark"]`, wrapped in `@media screen` so print stays light). Theme is light/dark/auto: `public/js/core/theme.ts` + `contexts/ThemeContext.tsx`, persisted per-device in `localStorage['shwan_theme']`, applied as `data-theme` on `<html>` (FOUC script in `index.html`). Chair-display kiosk is pinned light; patient portal + `login.html` are untouched.

### i18n / RTL (English + Arabic, staged rollout)

Mirrors the theme system's shape. **Languages** live in the `LANGUAGES` registry (`public/js/core/language.ts`, pure — no React); each entry carries `dir`/`locale`/`numberLocale`/labels. State + persistence: `contexts/LanguageContext.tsx` (`useLanguage()`), per-device `localStorage['shwan_language']`, applied as `<html lang>` (always the chosen language) + a **route-scoped `<html dir>`** by the **FOUC script in `index.html`** (pre-paint, no RTL-flash) and reconciled on mount + navigation (the `RootLayout` route watcher). There is **no `'auto'`** — language is always explicit `en|ar`. Western digits 0-9 in both languages (`numberLocale` is `'en-US'` for both, so the money parse round-trip holds). Kiosk (`ChairDisplay`) is pinned **LTR + light**.

**Strings**: `react-i18next` with **bundled** typed catalogs in `public/js/locales/{en,ar}/{common,dashboard}.json` (init in `public/js/i18n/`). English is the **single source of truth** — `i18next.d.ts` types `t()` keys against the EN catalog (a bogus key is a compile error), and `i18n/index.ts` asserts the AR catalog structurally COVERS EN (a missing AR key is a compile error, `returnNull:false`). Use `const { t } = useTranslation('<ns>')` + **bare** keys (`t('nav.dashboard')`, `t(\`cards.${k}.title\`)`); the typed `t` does **not** accept the `ns:key` prefix form. Never hardcode a user-facing string in a translated file.

**RTL CSS is automatic**: `postcss.config.js` runs **postcss-rtlcss in `Mode.override`** — LTR output is byte-identical (unscoped) and `[dir="rtl"]` overrides are *appended*, so dir-less pages (login/portal/kiosk) stay inert. **New CSS prefers logical properties** (`margin-inline-start` etc. — the plugin leaves them alone); `/*rtl:ignore*/` is the escape hatch for deliberately-physical declarations; hand-written `[dir="rtl"]` rules are **skipped** (`ignorePrefixedRules`) so vendor/CDN CSS (Font Awesome arrows) is flipped by hand. **Never** set Vite `css.transformer: 'lightningcss'` (skips PostCSS). The Arabic webfont (`css/base/fonts.css`, unicode-range-confined) leads `--font-primary` via `var(--font-arabic)` and is **per-device configurable** — 3 self-hosted faces (default **Cairo**; also IBM Plex Sans Arabic, Almarai), selected in Settings → General. Mirrors the theme/language shape: registry `core/font.ts`, `contexts/FontContext.tsx` (`useArabicFont()`), persisted `localStorage['shwan_arabic_font']`, applied as `<html data-arabic-font>` (FOUC script). Only the selected face downloads (unicode-range scoping). Adding a font = `ARABIC_FONTS` (core/font.ts) + `@font-face`/`:root[data-arabic-font]` (fonts.css) + FOUC whitelist (index.html) + woff2.

**Rollout is ratcheted + RTL is route-scoped**: only Dashboard + UniversalHeader + the Settings picker are translated so far. RTL is **opt-in per route** — `<html dir>` flips to `rtl` only when the language is Arabic AND the current route is in the **`RTL_ROUTES` allowlist** (`core/language.ts`); untranslated pages stay LTR even in Arabic (so English content is never mirrored). It must be opt-in, not opt-out: postcss-rtlcss emits `[dir="rtl"] .x` descendant selectors that match via any rtl ancestor, so a nested `dir="ltr"` can't cancel a document-level `dir="rtl"`. **When you translate a screen, add its file to the `eslint.config.js` `i18next/no-literal-string` list AND its path to `RTL_ROUTES` (and the FOUC route check in `index.html`)** — three lists kept in sync, all currently = Dashboard. The legacy `[dir="rtl"]` rules in `rtl-support.css` are dormant and pruned per-surface as each screen is QA'd. **Adding Kurdish (`ku`)** = one `LANGUAGES` entry + `locales/ku/` catalogs + the FOUC language whitelist in `index.html`.

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

**Connection** (see `.env`): `localhost:5432`, db `shwan`, role `shwan_app` (Windows service `postgresql-x64-18`). `PG_HOST`/`DATABASE_URL` are **per-machine** (`.env` is gitignored): use `127.0.0.1` on Windows-native (prod) — NOT the WSL NAT gateway `172.20.0.1`, whose vEthernet adapter drops intermittently and silently kills the CDC sinks; from a WSL dev box `127.0.0.1` is WSL itself, so point at the host gateway IP (or enable WSL2 mirrored networking) instead.

**Sessions live in PostgreSQL** (`express-session` via **`connect-pg-simple`**, wired in `index.ts`). Two tables — `staff_sessions` (cookie `shwan.sid`) and `portal_sessions` (cookie `shwan.portal`) — owned by `migrations/pg` (store runs `createTableIfMissing: false`, never issues DDL) and sharing the `pg` pool via `getPgPool()`. **The only remaining SQLite is `services/archform/archform-db.ts`** — reads the external Archform aligner software's own SQLite file via `better-sqlite3` (intentional, third-party integration).

**mssql on disk**: the Postgres cutover is **complete**; the one-off migration/parity scripts are removed. The `mssql` package + `services/database/pool.ts` survive **only** for the temporary Dolphin sink (see Sync), connect only when explicitly enabled, and both go when that sink is deleted.

Schema reference: `migrations/init_script.sql` is a historical T-SQL dump of the old schema, kept as authoring reference. The live schema is `migrations/pg/`. `migrations/postgresql/` is for the separate aligner-portal-external app, not the main DB.

---

## Sync (unified CDC)

**Full design + runbook: `docs/sync-cdc.md`** — read it BEFORE touching `services/sync/`, CDC triggers/migrations, or the Supabase mirror. One change feed per direction, one Supabase database: DB triggers capture row changes into a coalescing `change_log`; the engine (`services/sync/cdc/`) drains each sink's slice. Three sinks:
- **failover** — raw 1:1 mirror, local → Supabase. The **primary mirror, not a fallback** (name is historical); the aligner portal's future serving source. `FAILOVER_SYNC_ENABLED`.
- **reverse** — two-way path, Supabase → local; its `change_log`/`cdc_sink_control` live **on Supabase**. Whole-row LWW by `updated_at` (forward `>=`, reverse `>` → ties to local). `REVERSE_SYNC_ENABLED`.
- **dolphin** — temporary one-way sink into the legacy Dolphin Imaging SQL Server; the sole reason `mssql` + `services/database/pool.ts` still exist; meant to be deleted. `DOLPHIN_SYNC_ENABLED`.

**Invariants that bite in ordinary work (procedures + full detail in the doc):**
- **Any local DDL (`migrations/pg/*.sql`) must be mirrored to Supabase in the same change** — CDC replicates row DATA only, never DDL; a missing mirror column silently drops that field on upsert. The mirror must stay 100% identical to local except the documented sync-infra asymmetries (each side's own feed tables/triggers, and the odd/even identity split: reverse-set sequences `INCREMENT BY 2` — local ODD, Supabase EVEN — so sync inserts never collide).
- **Add a captured table** = a `cdc_capture('<PKcol>', 'failover')` trigger in a migration (single-column PK; no app code) + matching Supabase DDL + one-time row load. A table with `updated_at` **auto-enrolls in reverse sync** — denylist it in the discovery query if it must stay forward-only.
- **Never delete an origin-guard branch:** local `cdc_capture()`/`set_updated_at()` skip under `app.cdc_origin='reverse'`; Supabase `cdc_capture_remote()`/`set_updated_at_remote()` skip under `'failover'`. The guard both breaks the echo loop AND preserves `updated_at` verbatim — the LWW keystone.
- Kill switch without restart: `UPDATE cdc_sink_control SET enabled=false WHERE sink='…';` — on LOCAL for `failover`/`dolphin`, on SUPABASE for `reverse`.
- Bulk loads/reloads are **user-run** (harness blocks them) and must carry `app.cdc_origin='failover'`; web writes to the mirror must use the `mirror_rw` role, never the owner URL. Small additive DDL may go directly via `SUPABASE_FAILOVER_DB_URL`.
- **Retired — don't reintroduce:** the old portal projection (`portal-sink.ts`/`sync-fetch.ts`) and old reverse path (`sync-engine.ts`/`reverse-sync-poller.ts`/`POST /api/sync/webhook`); reverse v2 is a different implementation. Not logical replication, not nightly reloads.

Sink status UI: `SupabaseStatusSettings.tsx` → `GET /api/sync/supabase-status` (reports `failover` + `reverse`).

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
- **Patient data volume — server access is LOCAL, not SMB.** The Node server reads/writes patient files on the local disk: `MACHINE_PATH=C:` → `pathResolver('clinic1/…')` → `C:\clinic1\…` via direct NTFS. **There is no SMB redirector in the server's I/O path.** The `\\CLINIC\Clinic1\` UNC is a *separate, client-facing* pointer — the `PatientsFolder` DB option is served to the browser, which opens it via the `explorer:` protocol handler **on the user's own LAN PC** (`Navigation.tsx`); that machine isn't the server and can only reach the folder over the share, so `PatientsFolder` must stay UNC (as must `ARCHFORM_DB_PATH = \\WORK_PC\…`, a different host). LAN PCs can reach the share, phones can't. **`VideosPath` is the exception:** the `ovideos` folder was moved under `clinic1` (`VideosPath = C:\clinic1\ovideos\`), and educational videos stream *through* the server (`/api/videos/:id/stream`) — never opened client-side — so it stays a LOCAL path like patient-file I/O, not a UNC share.
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

### Browser / Playwright E2E (the ONLY supported way — don't hand-roll login each time)

Reusable harness: **`scripts/e2e/auth.mjs`** + smoke runner **`scripts/e2e/smoke-aligner.mjs`**.

```bash
node scripts/e2e/smoke-aligner.mjs            # desktop viewport
node scripts/e2e/smoke-aligner.mjs --mobile   # 412×915 (≈ Galaxy S23 Ultra)
```

In a script: `import { authedContext, gotoSpa, findHorizontalOverflow, E2E_BASE } from './auth.mjs'` →
`const { browser, context } = await authedContext({ mobile: true })`. Defaults target the **dev server `http://localhost:5273`** (override via `E2E_BASE`/`E2E_USER`/`E2E_PASS`).

**Five gotchas the harness already handles — re-read before "fixing" testing:**
- **Login is rate-limited 15 min/IP** (`routes/auth.ts` loginLimiter). NEVER log in per-run — `auth.mjs` logs in once and caches Playwright `storageState` (`scripts/e2e/.auth-state.json`, gitignored, 20-min TTL). If you somehow hit **HTTP 429**, the in-memory limiter resets on a **dev-server restart**.
- **Prod (:3000) drops the session cookie over plain http** — express-session `cookie.secure` + trust-proxy only emits Set-Cookie when the request looks HTTPS. The helper always sends `X-Forwarded-Proto: https`. Dev (:5273) is `secure=false`. Prefer testing against **dev** (also gives HMR, so source edits are live without a build).
- **`networkidle` never fires** (the SPA holds open SSE streams) — `gotoSpa()` uses `domcontentloaded` + an explicit `waitForSelector`. Never `waitUntil:'networkidle'`.
- **The sticky universal header / patient banner intercept clicks** on in-card buttons — click with `{ force: true }`.
- **For CSS/layout checks don't set `deviceScaleFactor` + `isMobile`** together — it distorts `window.innerWidth`. A plain `viewport` gives true CSS-px widths. Use `findHorizontalOverflow(page)` to catch "looks wide" bugs (an element wider than the viewport).

Prod build note: the phone hits the **built** bundle on `:3000`/the tunnel; source CSS/JS edits only appear there after `npm run build` **and** a hard refresh (hashed assets + cached `index.html`). Test on dev to avoid this.

---

## Conventions worth remembering

- ES Modules (`"type": "module"`); `.js` extensions on relative imports even in TS source.
- React Compiler (`babel-plugin-react-compiler`) is enabled — don't manually memoize unless profiling proves a need.
- Cross-platform path handling lives in `utils/path-resolver.ts` (auto Windows/WSL conversion).
- RTL support for Kurdish/Arabic; check `rtl-support.css` before adding directional styles.
- Graceful shutdown chains exist for all long-lived services (WhatsApp, sync, pool, SSE broadcasters); don't add `process.exit()` mid-flow.
- After using Playwright, delete every screenshot it left behind before finishing.
