# CLAUDE.md

**Shwan Orthodontics Management System** — Node.js + Express 5 + React 19 + TypeScript practice-management platform for an orthodontic clinic. Patients, treatments, dental chart, aligners, appointments, multi-channel messaging (WhatsApp/SMS/Telegram), finance/expenses, document templates (GrapesJS), Stand inventory/POS, Patient Portal.

> **Product direction — this is a COMMERCIAL, multi-deployment product, not a single-clinic app.** It began bespoke for one clinic but is being built to sell to **many independent dental/orthodontic centers, each running its own instance + database** (the Windows-service deployment model). Two implications shape every design call: **(1) Don't tune schema/indexes/queries/assumptions to *this* clinic's data profile** (e.g. only 5 doctors, `dr_id` ~94% NULL) — design for the general case, including doctor-heavy centers where per-doctor views matter. **(2) But every center is its own bounded single-clinic DB, and the absolute ceiling is known.** The biggest center that can realistically exist — ~20 doctors × ~20 appts/day = 400/day × ~247 working days/yr (after Fri+Sat weekends + ~14 holidays) × a ~20-year lifetime ≈ **~2M appointments** (~100–150K patients); most centers far smaller. So the busiest table (`appointments`) tops out around **~2M rows, everything else in the hundreds of thousands** — NOT web-scale (no billions, no sharding/partitioning), but big enough that **hot access paths a multi-doctor center runs repeatedly must be properly indexed.** E.g. the per-doctor calendar over a date range warrants a partial `(dr_id, app_date)` index (at ~2M rows a per-doctor month view touches ~415 of its ~8,300 rows), even though *this* clinic's data (5 doctors, `dr_id` 94% NULL) wouldn't reveal the need. Net: design for the ~2M-row ceiling — index the real access paths a busy multi-doctor center hits, but don't engineer beyond that, and never tune to one clinic's skew.

---

## Commands

```bash
npm run dev              # Vite (:5273 WSL / :5173 Windows) + Express (:3001), concurrent
npm run build            # client → /dist, server → /dist-server
npm start                # serve built /dist-server (:3000)

npm run typecheck:all    # frontend + backend
npm run lint:fix
npm run css:types        # regenerate *.module.css.d.ts
npm run db:migrate       # apply migrations (also :down, :new-migration)
npm run db:codegen       # regenerate types/db.d.ts after a schema change
npm run gate             # CI gate: typecheck:all + lint + test + contracts:check --strict + build
```

---

## Architecture (where to look)

**Backend** — Express 5, ESM, strict TS. Entry: `index.ts`.
- `routes/` — root routes (admin/auth/portal/calendar/sync-webhook/template-api/user-management/web/email-api) + `routes/api/*.routes.ts` per feature
- `services/` — ~18 domain subdirs (`business/`, `database/`, `messaging/`, `sync/`, `pdf/`, `templates/`, `webceph/`, `google-drive/`, `files/`, `imaging/`, `state/`, `monitoring/`, …)
- `services/database/queries/` — one query module per domain (~24)
- `middleware/`, `utils/`, `config/`, `types/`; `shared/` — cross-boundary Zod contracts

**Frontend** — React 19, React Router v7 Data Router, Vite 7. Entry: `public/js/App.tsx`.
- `public/js/router/` — `routes.config.tsx` (route table), `loaders.ts` (thin prefetchers into the React Query cache)
- `public/js/query/` — server-state layer: `client.ts` (shared `QueryClient`), `keys.ts` (`qk` factory), `queries.ts` (`queryOptions` factories), `loaderQuery.ts`, `useApiMutation.ts`
- `public/js/routes/`, `public/js/pages/` — top-level screens (Stand*, ChairDisplay); `public/js/portal/` — Patient Portal (separate bundle)
- `public/js/components/react/` — shared components by feature; `public/js/{contexts,hooks,services}/`

**CSS** — CSS Modules (`*.module.css`) per component; globals under `public/css/`.

---

## Critical patterns (these override defaults)

### Navigation — React Router only
```typescript
const navigate = useNavigate();
navigate('/patient/123/works');   // CORRECT — never window.location.href (full reload)
```
Exceptions: external URLs, system protocols (`explorer:`, `csimaging:`), security logout, route-loader 401 redirects.

### Toast, not alert()
`const toast = useToast(); toast.success('Saved!')` — non-React: `window.toast?.success('Done!')`.

### Winston, not console.log
`import { log } from '@utils/logger'` → `log.info(msg, { meta })` / `log.error(msg, { error: err.message })`.

### Shared `<Modal>` + `<ModalHeader>` only
- **`<Modal>`** (`public/js/components/react/Modal.tsx`) — all overlay modals render through it: portal into `#modal-root`, focus trap, scroll lock, Escape + backdrop dismiss. **Never hand-roll a `.modal-overlay` / `styles.modalOverlay` wrapper** — it won't escape stacking/clipping ancestors.
- **`<ModalHeader>`** (`public/js/components/react/ModalHeader.tsx`) — the SSoT for modal title bars: standardizes layout, the close button, aria wiring, and is the drag grip (`data-modal-drag-handle`) that makes the modal draggable. Use it for new headers via the `title`/`icon`/`subtitle`/`actions` props (`variant`: default|danger|warning|success|info; `dense` for compact). Pass its `titleId` as the `<Modal>` `ariaLabelledBy`.

### Edit-lookup-from-dropdown — `useLookupManager`
Right-click any reference `<select>` → "Edit values" → manage that lookup table inline (modal-hosted `LookupEditor`). To add it to a dropdown: ensure the table is in `LOOKUP_TABLE_CONFIG` (`services/database/queries/lookup-admin-queries.ts`), then `const x = useLookupManager({ tableKey, invalidateKeys: [qk.lookups.<feed>()] })`, spread `x.onContextMenu` onto the `<select>`, and render `{x.overlay}` — no per-table component. `invalidateKeys` refreshes the live dropdown after an edit. First wired for labs (work-item + expense). Infra: `hooks/useLookupManager.tsx` + `LookupContextMenu`/`LookupManagerModal`.

### Shared API contracts — `shared/contracts/*.contract.ts` (cross-boundary SSoT) — MANDATORY for new/changed endpoints
Every enveloped staff-app endpoint's request **and** response is authored once as Zod in `shared/contracts/<group>.contract.ts` and imported by both sides — Express via relative `.js`, React via the `@shared` alias. Drift becomes a server compile error *and* a client fail-loud runtime throw.

- **Shape:** one `export const <action> = { body?, params?, query?, response } as const` per endpoint; also export the `z.infer` types. On a name collision with a consumer local, alias the import `…Contract`.
- **Server:** `validate({ body/params/query })` references the **contract's** schemas (never a fresh inline one); the handler returns via **`sendData(res, <action>.response, data)`** (not `sendSuccess`). `sendData` dev-parses (`NODE_ENV !== 'production'`, zero prod cost) and types `data` to the contract.
- **Client:** `fetchJSON<Resp>(url, { schema: <action>.response })` — keep the explicit generic (`{ schema }` doesn't infer it). Loaders carry the schema via the `query/queries.ts` factories. **This client schema is the only runtime guard in prod**, so every read must carry `{ schema }` (ESLint `require-schema-on-reads`). A deliberately schema-less read takes an inline disable + reason.
- **Never** bridge a parsed read into a view-model with an `as`/`as unknown` cast, nor re-wrap it in a hand-written response `interface` — it defeats the fail-loud guard on the render path. Fix the view-model's types to match the contract (widen nullability, coalesce `null`→`undefined` at the real sinks) so data flows in cast-free.
- **Never** hand-write a parallel `XxxBody`/response `interface` for a contracted endpoint — request bodies are fully enumerated so `z.infer<typeof <a>.body>` is the SSoT; type the handler `Request<…, z.infer<typeof <a>.body>>`. (The loose-schema-plus-interface convention applies only to not-yet-contracted routes.)

**Authoring rules:**
- Containers default to **`z.looseObject`**, not `z.object` — `core/http` returns the *parsed* payload and Zod 4 `z.object` strips unknown keys, dropping long-tail fields the UI reads. Use plain `z.object` only for closed, fully-modeled containers.
- A `sendData` data source must be a **`type` alias or inline literal, never an `interface`** — `looseObject` infers a string index signature TS won't assign an interface to (`TS2345`). Flip the query/route `interface`→`type`.
- Loose-but-safe primitives in `shared/validation.ts`: **`timestampString`** (PG `timestamp`: Date server / string client), **`anyArray`** (`z.array(z.unknown())`), **`z.unknown()`** — preserve the payload without forcing an interface→type flip.
- Leave deliberately-raw endpoints alone: un-enveloped `null` signals, PDF/stream/`res.send` responses, and raw whatsapp `apiClient` consumers (they read top-level fields; nesting under `data` would hide them). Always check the consumer's transport before migrating an envelope.

**Gate (enforced on every push/PR — `.github/workflows/gate.yml`):** `npm run gate` fails if a hand-written request `interface *Body|*Params|*Query|*Filters` appears in `routes/` (ESLint), a `fetchJSON` read lacks `{ schema }`, or `scripts/contracts-dod.mjs` sees D1 (request interfaces, target 0) or D2 (loose response markers, baseline **9**) regress. A new loose response needs an inline `// Intentionally loose:` + a D2 baseline bump.

Envelope type: `public/js/types/api.types.ts` holds only `ApiResponse<T>` (`{ success, data?, error? }`). Import it as `import type { ApiResponse } from '@/types/api.types'` — the `@types/*` alias resolves in tsconfig but **not** Vite, so use `@/` for value imports.

### The HTTP funnel — `core/http.ts` only
Every staff-app request goes through `public/js/core/http.ts` (`fetchJSON`/`postJSON`/`putJSON`/`patchJSON`/`deleteJSON`/`postFormData`); bare `fetch()` in `public/**` is an ESLint error (rare blob/stream/beacon exceptions carry an inline disable; the Patient Portal is its own raw Zod boundary). The funnel unwraps the `{success,data}` envelope, attaches `x-csrf-token` on mutations (a 403 `EBADCSRFTOKEN` auto-refetches the token + retries once), enforces a 30s timeout, and validates against an optional Zod `schema` (throws on mismatch). Read the server's friendly error in a `catch` via `httpErrorMessage(err, fallback)`.
- Never bypass it for a mutation (you'd lose the CSRF token → 403). On a sanctioned raw-`fetch` mutation (blob/stream POST, e.g. `LabelPreviewModal`, `whatsapp-api-client.ts`) you must attach `'x-csrf-token': await prefetchCsrfToken()` yourself. Server-side CSRF: `middleware/csrf.ts`.

### React Query — the single server-state layer (`public/js/query/`)
`@tanstack/react-query` v5 owns all staff-app server state (`QueryClientProvider` in `App.tsx`; client in `query/client.ts` so loaders can use it outside React). No staff screen holds server state in local `useState`.
- **Keys:** the hierarchical `qk` factory (`query/keys.ts`) is the SSoT. Parent keys are prefixes of children, so `invalidateQueries({ queryKey: qk.patient.all(id) })` refreshes that patient's info + works + timepoints at once. `qk.patient.info` and `qk.patient.full` are distinct (`/info` vs `/:id`).
- **Reads:** one `queryOptions` factory per read in `query/queries.ts` (pairs a `qk` key with `fetchJSON` + the contract `.response`), reused by route loaders (`loaderQuery` → `ensureQueryData`, flash-free first paint) and components (`useQuery(xxxQuery(id))`).
- **Mutations:** after a write, `queryClient.invalidateQueries({ queryKey: qk.<domain>(id) })` — pick the key covering everything the write changed. `query/useApiMutation.ts` (wraps `useMutation` + invalidation) is the standard for new mutations; it exports `isInvalidStateTransition(err)`, the shared 400-conflict predicate for silent-reload recovery.
- **SSE screens** (daily-appointments: `useAppointments`/`useAppointmentsSync`; WhatsApp: `useMessageStatus`/`useWhatsAppSync`) keep `keepPreviousData` + SSE→`invalidateQueries` + conflict recovery, keyed via `qk.appointments.daily` / `qk.whatsapp.messages`.
- **Deliberate loader exceptions** (not regressions): `PatientManagement` (URL-param search + scroll restoration, self-refreshes via `executeSearch`) and `PatientSets` (self-managed `loadBatches`).

### Runtime validation (Zod) — boundaries only
Validate **untrusted input crossing into the app**, nowhere else: request body/params/query, env at boot, and `res.json()` parsing on external (Patient Portal) calls. Use the shared `validate({ body?, params?, query? })` middleware (`middleware/validate.ts`) — it parses, coerces, writes back, and 400s via `ErrorResponses`. The schema is the SSoT: derive types with `z.infer`, never a parallel interface. Boot env schema: `config/config.ts`.
- **Never** validate Kysely/DB results (already typed from `types/db.d.ts`) or internal calls (that's TypeScript's job).

### CSS Modules + design tokens
`import styles from './X.module.css'`. No inline styles (except dynamic), no `!important` (except print/a11y). Use the design tokens for color/spacing/z-index/breakpoints — don't invent values inline. Tokens cascade: `public/css/base/tokens-primitive.css` (raw `--palette-*` ramps, brand, structural) → `tokens-semantic.css` (light theme: surfaces/text/borders/status/shadows) → `theme-dark.css` (dark overrides under `:root[data-theme="dark"]`, wrapped in `@media screen` so print stays light). Theme is light/dark/auto: `core/theme.ts` + `contexts/ThemeContext.tsx`, persisted per-device in `localStorage['shwan_theme']`, applied as `data-theme` on `<html>` (FOUC script in `index.html`). Chair-display kiosk is pinned light; patient portal + `login.html` are untouched.

### i18n / RTL (English + Arabic, staged)
> **Translating a module? Read `docs/i18n-translation-playbook.md` first — it's the do-it-now checklist (9 steps + snippets + gotchas) so you start coding immediately instead of re-deriving the architecture below.**
- **Languages:** `LANGUAGES` registry in `core/language.ts` (pure; `dir`/`locale`/`numberLocale`/labels). State: `contexts/LanguageContext.tsx` (`useLanguage()`), `localStorage['shwan_language']`, applied as `<html lang>` + route-scoped `<html dir>` (FOUC script in `index.html` + `RootLayout` watcher). No `'auto'` — always explicit `en|ar`. Western digits in both (`numberLocale='en-US'`, so the money round-trip holds). Kiosk pinned LTR.
- **Strings:** `react-i18next`, bundled typed catalogs `public/js/locales/{en,ar}/{common,dashboard,expenses,appointments,works,payments}.json` (init in `public/js/i18n/`). English is the SSoT — `i18next.d.ts` types `t()` keys against EN, `i18n/index.ts` asserts AR covers EN (both compile-errors). Use `const { t } = useTranslation('<ns>')` + **bare** keys (`t('nav.dashboard')`); the typed `t` rejects the `ns:key` form.
- **RTL CSS is automatic:** `postcss.config.js` runs postcss-rtlcss in `Mode.override` (LTR output byte-identical; `[dir="rtl"]` overrides appended). Prefer logical properties (`margin-inline-start`); `/*rtl:ignore*/` is the escape hatch; hand-written `[dir="rtl"]` rules are skipped (flip vendor CSS by hand). **Never** set Vite `css.transformer:'lightningcss'` (skips PostCSS).
- **Arabic font is per-device configurable** (Settings → General): registry `core/font.ts` (`ARABIC_FONTS` — Cairo default, IBM Plex Sans Arabic, Almarai) + `contexts/FontContext.tsx` (`useArabicFont()`), `localStorage['shwan_arabic_font']`, `<html data-arabic-font>` (FOUC). `--font-arabic` leads `--font-primary`; faces are unicode-range-scoped in `css/base/fonts.css` so only the selected one downloads. Adding a font = `ARABIC_FONTS` + `@font-face`/`:root[data-arabic-font]` + FOUC whitelist + woff2.
- **Rollout is ratcheted + RTL is route-scoped.** Translated so far: Dashboard, UniversalHeader, the Settings General picker, Expense Management (the `/expenses` route + its 5 expense components, `expenses` namespace), Daily Appointments (the `/appointments` route + its 8 components, `appointments` namespace), the patient **Works** page (`WorkComponent` + `WorkCard`, `works` namespace — the front-desk treatment-list view), the patient **appointment-booking workflow** (`appointments` namespace, reusing it: the appointments list `PatientAppointments`, the `AppointmentForm`/`EditAppointmentForm` new/edit forms, and their shared `SimplifiedCalendarPicker` — at `/patient/:id/appointments`, `/new-appointment`, `/edit-appointment/:id`), the **Payment Modal** (`PaymentModal`, `payments` namespace — opened from the Works page, inherits its RTL route context), and the patient **demographics screens** (`patients` namespace: `ViewPatientInfo` read-only info at `/patient/:id/patient-info`, `EditPatientComponent` edit form at `/patient/:id/edit-patient` (update-only — creation lives solely in `AddPatientForm`), and `AddPatientForm` at `/patient/new/add`). Note: lookup-dropdown VALUES on those forms (gender/address/referral/patient-type/tag rows) stay in their stored form for now — only the UI chrome + the static `Select …` options + the hardcoded language/currency options are translated; extend per the `*_name_ar` recipe later if needed. The Works page is a deliberate **front-desk-only** slice: the clinical treatment-items panel (`WorkDetailsPanel`/`WorkDetailItem`) and the visits/diagnosis destination pages stay **English** (doctor-facing), but the entry-point buttons to them on the card are translated. RTL flips to `rtl` only when language is Arabic AND the route is translated. Static translated routes live in `RTL_ROUTES` (`core/language.ts`, currently `['/dashboard', '/expenses', '/appointments']`); routes with a dynamic segment that can't be a static prefix live in `RTL_ROUTE_PATTERNS` (currently the Works page + the three booking-workflow paths + the three demographics paths `patient-info`/`edit-patient`/`add` — each matched precisely, NOT the whole `/patient/:id/*` subtree, so sibling patient pages stay LTR). **Localized day/date formatting** (the booking calendar + forms) lives in `utils/formatters.ts` — Arabic weekday names are hand-mapped SHORT forms WITHOUT the "ال" prefix (سبت/أحد; Intl yields the "ال"-prefixed "السبت"), digits stay Western, and the active `language` is passed in EXPLICITLY (not read from module state) so React Compiler re-runs the format on a live language toggle instead of serving a stale memo. Untranslated pages stay LTR so English is never mirrored. When you translate a screen, update three places in sync: the `eslint.config.js` `i18next/no-literal-string` file list (currently Dashboard + UniversalHeader + the 6 expense files + the 8 appointments files + `WorkComponent` + `WorkCard` + the 4 booking-workflow files + `PaymentModal` + `Navigation` + the 3 patient-demographics files), `RTL_ROUTES`/`RTL_ROUTE_PATTERNS`, and the FOUC route check in `index.html`. (Appointments note: `getCurrentStatus()` in `AppointmentCard` returns English logical/CSS keys that feed `data-status` selectors + `=== 'Checked In'` checks — NOT visible text — so it stays untranslated; the `patient_type` badge uses the `patient_types.patient_type_name_ar` lookup treatment (the 2nd instance after the expense lookups — column on both DBs, threaded through query + contract + Lookups admin + `useLocalizedName`, controlled-vocab rows seeded, `OPG` acronym left NULL).) That ratchet's `jsx-attributes.exclude` also allowlists the shared modal's structural/identity attrs (`titleId`/`ariaLabelledBy`/`variant`) plus the React Router `<Link>`/`<Navigate>` `to` route-path attr — all non-user-facing, so leave them as literals (user-facing attrs `title`/`label`/`placeholder`/`alt`/`aria-label` stay checked). Adding Kurdish (`ku`) = one `LANGUAGES` entry + `locales/ku/` + the FOUC language whitelist.

---

## Database

**PostgreSQL** (local native service) via **node-postgres (`pg`) + Kysely** — `pg.Pool` (max 10, ~30s timeouts). No stored procedures/triggers/functions for app logic (all in TypeScript); the only DB triggers are CDC capture (see Sync).

**Where to talk to the DB:** `services/database/kysely.ts` exposes `getKysely()` (the `Kysely<Database>`) and `withPgTransaction(cb)` — use these directly. `services/database/index.ts` is only connection diagnostics + lifecycle (`testConnection`/`testConnectionWithRetry`/`getDatabaseStats`/`healthCheck`/`shutdown`); there's no `executeQuery`/`executeStoredProcedure`. One-off raw SQL: Kysely's `sql` tag.

**Gotchas — do not regress:**
- **Names:** schema is all lowercase `snake_case` (`patients`, `time_points`, `aligner_sets`; `person_id`, `city_id`). The SQL-Server-era `tbl*`/PascalCase/`"PersonID"`/`dbo.` are gone — a raw `sql` string using them fails. `types/db.d.ts` (from `npm run db:codegen`) is the SSoT for table/column names.
- **Dates:** `date`/`timestamp` are **WITHOUT** time zone (single-clinic wall-clock; `timestamptz` reintroduces the UTC-midnight-shift bug). The `pg` parsers return `date`→`'YYYY-MM-DD'` **string**, `timestamp`→local `Date`, `numeric`/`bigint`→`number`. `db:codegen` runs `--date-parser string`, so generated types match: `date` columns are **`string`**, `timestamp` columns are `Date`. So: don't `$castTo<string>()` a `date` column (already string), bind `date` params as `'YYYY-MM-DD'` (use `sql<string>`, not `sql<Date>`), and don't `(col as Date).toISOString()` a `date`. `utils/date.ts#toDateOnly` normalizes any `Date|string` → date-only string.
- **Collation:** text columns are `citext` (case-insensitive `=`/`LIKE`/unique, accent-sensitive — reproduces SQL Server `Arabic_CI_AS`). `image_types.image_type_code` + `time_point_images.image_type` stay `char(2)`. Trigram search indexes need `::text ILIKE`, never citext `LIKE`.
- **Booleans:** `bit`→`boolean`; compare/insert `true|false`, not `0|1`.
- **NULL ordering:** PG sorts NULLs LAST on ASC (SQL Server sorted FIRST); add `NULLS FIRST` where order matters.
- **Identity:** PKs are `GENERATED BY DEFAULT AS IDENTITY`; FK-violation SQLSTATE is `23503` (`utils/pg-errors.ts`).

**Migrations:** owned by **node-pg-migrate** — `migrations/pg/*.sql` (plain SQL up/down; Kysely is the query builder, not the DDL owner). The Supabase mirror DDL lives in `migrations/supabase/`. Regenerate `types/db.d.ts` after any schema change.

**Connection** (`.env`, gitignored, per-machine): `localhost:5432`, db `shwan`, role `shwan_app`. For `PG_HOST`/`DATABASE_URL` use `127.0.0.1` on Windows-native (prod) — NOT the WSL NAT gateway `172.20.0.1` (its vEthernet adapter drops intermittently and silently kills the CDC sinks); from a WSL dev box, point at the host gateway IP (or enable WSL2 mirrored networking).

**Sessions in PostgreSQL** (`express-session` + `connect-pg-simple`, wired in `index.ts`): tables `staff_sessions` (cookie `shwan.sid`) + `portal_sessions` (cookie `shwan.portal`), owned by `migrations/pg` (store never issues DDL), sharing the pool via `getPgPool()`.

**Other DB engines:** the only remaining SQLite is `services/archform/archform-db.ts` (`better-sqlite3`, reads Archform's own file — third-party). `mssql` + `services/database/pool.ts` survive only for the temporary Dolphin sink (see Sync) and go when it's deleted.

---

## Sync (unified CDC)

**Full design + runbook: `docs/sync-cdc.md`** — read it before touching `services/sync/`, CDC triggers/migrations, or the Supabase mirror. DB triggers capture row changes into a coalescing `change_log`; the engine (`services/sync/cdc/`) drains each sink. Three sinks:
- **failover** — raw 1:1 mirror, local → Supabase. The primary mirror (name is historical), the aligner portal's serving source. `FAILOVER_SYNC_ENABLED`.
- **reverse** — two-way, Supabase → local; its `change_log`/`cdc_sink_control` live on Supabase. Whole-row LWW by `updated_at` (forward `>=`, reverse `>` → ties to local). `REVERSE_SYNC_ENABLED`.
- **dolphin** — temporary one-way sink into the legacy Dolphin Imaging SQL Server (the sole reason `mssql`/`pool.ts` still exist). `DOLPHIN_SYNC_ENABLED`.

**Invariants that bite (full procedures in the doc):**
- **Any local DDL (`migrations/pg/*.sql`) must be mirrored to Supabase in the same change** — CDC replicates row DATA only, never DDL; a missing mirror column silently drops that field on upsert. Mirror stays identical except documented sync-infra asymmetries (each side's own feed tables/triggers; reverse-set sequences `INCREMENT BY 2` — local ODD, Supabase EVEN — so inserts never collide).
- **Add a captured table** = a `cdc_capture('<PKcol>', 'failover')` trigger in a migration (single-column PK) + matching Supabase DDL + one-time row load. A table with `updated_at` auto-enrolls in reverse sync — denylist it in the discovery query to stay forward-only.
- **Never delete an origin-guard branch:** local `cdc_capture()`/`set_updated_at()` skip under `app.cdc_origin='reverse'`; Supabase `cdc_capture_remote()`/`set_updated_at_remote()` skip under `'failover'`. The guard breaks the echo loop AND preserves `updated_at` verbatim (the LWW keystone).
- **Kill switch (no restart):** `UPDATE cdc_sink_control SET enabled=false WHERE sink='…';` — on LOCAL for `failover`/`dolphin`, on SUPABASE for `reverse`.
- Bulk loads/reloads are user-run and must carry `app.cdc_origin='failover'`; web writes to the mirror use the `mirror_rw` role, never the owner URL. Small additive DDL may go directly via `SUPABASE_FAILOVER_DB_URL`.
- **Don't reintroduce** the retired portal projection (`portal-sink.ts`/`sync-fetch.ts`) or old reverse path (`sync-engine.ts`/`reverse-sync-poller.ts`/`POST /api/sync/webhook`). Not logical replication, not nightly reloads.

Sink status UI: `SupabaseStatusSettings.tsx` → `GET /api/sync/supabase-status`.

---

## Realtime / SSE

WebSockets are retired — all server→client realtime is **Server-Sent Events**. The legacy `utils/websocket.ts`, `wsService`, `connectionManager`, `constants/websocket-events.ts` are gone; don't restore them.

**Server:** `index.ts` creates a bare `new EventEmitter()` (`wsEmitter`) and hands it to the broadcasters at boot:
- `services/messaging/sse-broadcaster.ts` — appointments + chair-display channels
- `services/messaging/sse-whatsapp.ts` — WhatsApp channel (QR, client-ready, message-status, progress)

Routes/services emit internal events (`wsEmitter.emit(InternalEmitterEvents.DATA_UPDATED, …)`, `CHAIR_PATIENT_LOAD`, `WHATSAPP_*`); broadcasters translate them to SSE frames. Add new internal events to `services/messaging/websocket-events.ts` (filename is legacy — these are in-process emitter names, never on the wire) and wire them in the broadcaster's `ensureInitialized()`.

**Routes:** `GET /sse/chair-display/:chairId` is **public** (kiosk has no session, internal-LAN). `GET /api/sse/appointments` + `GET /api/sse/whatsapp` mount **after** the auth gate (a 401 closes the EventSource).

**Transport hygiene (copy the pattern in each handler):**
- `req.setTimeout(0); res.setTimeout(0)` — bypasses the global 30s `requestTimeout` (else streams 408 at 30s).
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Initial `retry: ${2500 + jitter}` frame (avoids thundering-herd reconnect on restart).
- One module-scoped 25s `setInterval` writes `:\n\n` comment frames to every open stream (undercuts Caddy's ~30s idle drop).

**Client singletons:** `public/js/services/sse-appointments.ts` + `sse-whatsapp.ts`, refcounted (`ensureConnected()`/`release()`; EventSource opened on first acquire, closed at refcount zero). **Never `new EventSource` directly** except the chair-display kiosk (`routes/ChairDisplay.tsx`). Liveness, the "Live | Stale | Offline" indicator (`appointments/ConnectionStatus.tsx`), and forced-reconnect triggers (`constants/sse-liveness.ts`) live in the singletons.

**Other invariants:** chair-display keeps an in-memory current-patient map (12h TTL, monotonic `chairEpoch` guards stale async LOADs; lost on restart by design). Every `/api/sse/whatsapp` stream registers a QR viewer via `messageState.registerQRViewer()` — `activeQRViewers > 0` gates QR generation + on-demand WhatsApp init. Graceful shutdown calls `teardownSseBroadcaster()` + `teardownWhatsappSseBroadcaster()`.

---

## TypeScript / path aliases

Three configs (all strict): `tsconfig.json` (backend), `tsconfig.frontend.json` (frontend), `tsconfig.build.json` (prod build).
- **Backend:** `@config/*`, `@services/*`, `@routes/*`, `@utils/*`, `@middleware/*`, `@types/*`
- **Frontend:** `@/*`, `@components/*`, `@services/*`, `@hooks/*`, `@contexts/*`, `@types/*`, `@shared/*` (→ repo-root `shared/`, the contracts). Vite resolves `@/*` and `@shared/*` at runtime; use `@/` for value imports (`@types/*` is tsconfig-only — breaks value exports at build).

Use `import type { … }` for type-only imports.

---

## Environment

Boot **requires** (validated in `config/config.ts`, throws if missing): `MACHINE_PATH`, `SESSION_SECRET`, and the PostgreSQL block (`PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD`, or `DATABASE_URL`). `PORT` defaults to 3000. Optional service blocks (Telegram, Twilio, Google Drive, WebCeph, Gemini, Supabase sync, LocalSend) disable when blank. Legacy `DB_*` (SQL Server) vars feed only the Dolphin sink, not boot. `.env.example` documents every block by category; per-machine WSL overrides go in `.env.development`.

---

## Deployment

- **Dev = WSL (Linux); Prod = Windows Server** (a future Linux server is planned — keep everything OS-agnostic via `utils/path-resolver.ts` + the `path` module; never hardcode `/` or `\`).
- **Patient files are LOCAL disk I/O, not SMB.** The server reads/writes via direct NTFS: `MACHINE_PATH=C:` → `pathResolver('clinic1/…')` → `C:\clinic1\…`. The `\\CLINIC\Clinic1\` UNC is a separate, *client-facing* pointer: the `PatientsFolder` DB option is served to the browser, which opens it via the `explorer:` handler on the user's own LAN PC (`Navigation.tsx`) — that machine reaches the folder only over the share, so `PatientsFolder` (and `ARCHFORM_DB_PATH = \\WORK_PC\…`) must stay UNC. **Exception:** `VideosPath` is LOCAL (`C:\clinic1\ovideos\`) — educational videos stream *through* the server (`/api/videos/:id/stream`), never client-side.
- **Filesystem discipline** (portability insurance — bites on WSL `/mnt/c` drvfs and a future network-mounted server): (1) avoid bulk per-file `stat`/`lstat` in hot paths — take type from `readdir`'s `Dirent` (cf. `walkFlat` vs the `lstat` in `listDirectory`); (2) stage temp files on the **same volume** as their destination and `rename` into place (the `${dest}.tmp-${pid}-${ts}` pattern; multer staging in `clinic1/.uploads/{id}`) so a remote volume never throws `EXDEV`.
- **Remote access:** on-LAN, **Caddy** reverse-proxies `local.shwan-orthodontics.com` (`Caddyfile`); off-LAN, a **cloudflared** named tunnel (`config_cloudflared.yml`) routes `remote.shwan-orthodontics.com` → `localhost:3000`. `config.urls.publicUrl` defaults to the remote domain. Tunnel creds live outside the repo (`~/.cloudflared/`) — never commit them.
- **Prod runs as a Windows service via node-windows** (`utils/windows-service/`; `npm run service:install`/`:uninstall`). The service **Name is `webapp.exe`** (node-windows appends `.exe`) — manage it as `Restart-Service -Name 'webapp.exe'`, NOT `webapp`. It runs compiled `dist-server/index.js` as Administrator (so Puppeteer finds Chrome), `NODE_ENV=production` + `TZ=Asia/Baghdad`. **Deploying code = `npm run build` then restart the service** — source edits never apply live.
- **Prod logs (Winston) → `<cwd>/logs/`** (= `C:\ShwNodApp\logs\` as the service): `error.log` (errors only — incl. the `[client-error]` reports) + `combined.log`, each rotated 5 MB × 5. Console transport is off in production. node-windows also keeps raw `dist-server\daemon\webapp.{out,err,wrapper}.log` for boot/crash failures.
- **Client-side error reporting:** the staff SPA ships render-boundary crashes, RQ 5xx + contract-drift throws, and uncaught window errors to `POST /api/client-error` (`routes/api/monitoring.routes.ts`, contract `monitoring.contract.ts`) → Winston `[client-error] <source>: <message>`. Client: `core/error-reporter.ts` (throttled/deduped/capped, never throws) wired into `ErrorBoundary.componentDidCatch`, the RQ `QueryCache`/`MutationCache` `onError` (`query/client.ts`, 5xx + Zod failures), and window `error`/`unhandledrejection`.

---

## Testing

```
Admin / Yarmok11
curl -c /tmp/cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"Admin","password":"Yarmok11"}'
```

**Browser / Playwright E2E** — use the reusable harness, don't hand-roll login:
```bash
node scripts/e2e/smoke-aligner.mjs            # desktop
node scripts/e2e/smoke-aligner.mjs --mobile   # 412×915
```
`import { authedContext, gotoSpa, findHorizontalOverflow, E2E_BASE } from './auth.mjs'`. Defaults target dev (`E2E_BASE`, default `http://localhost:5173` — set to `:5273` on the WSL box; override `E2E_USER`/`E2E_PASS`).

**Gotchas the harness already handles:**
- **Login is rate-limited 15 min/IP** (`loginLimiter` in `routes/auth.ts`) — `auth.mjs` logs in once and caches `storageState` (`scripts/e2e/.auth-state.json`, 20-min TTL). On HTTP 429, restart the dev server to reset the in-memory limiter.
- **Prod (:3000) drops the session cookie over plain http** (express-session `cookie.secure` + trust-proxy) — the helper sends `X-Forwarded-Proto: https`. Prefer dev (also HMR, so edits are live without a build).
- **`networkidle` never fires** (open SSE streams) — `gotoSpa()` uses `domcontentloaded` + a `waitForSelector`.
- **Sticky header/banner intercepts in-card clicks** — click with `{ force: true }`.
- **For layout checks, don't set `deviceScaleFactor` + `isMobile` together** (distorts `innerWidth`); use a plain `viewport` and `findHorizontalOverflow(page)`.
- The phone hits the **built** bundle on `:3000`/tunnel — source edits appear there only after `npm run build` + hard refresh. Test on dev.

---

## Conventions

- ES Modules (`"type": "module"`); `.js` extensions on relative imports even in TS source.
- React Compiler (`babel-plugin-react-compiler`) is on — don't manually memoize unless profiling proves a need.
- Cross-platform paths via `utils/path-resolver.ts` (auto Windows/WSL).
- Graceful shutdown chains exist for all long-lived services (WhatsApp, sync, pool, SSE) — don't add `process.exit()` mid-flow.
- After using Playwright, delete every screenshot it left behind.
