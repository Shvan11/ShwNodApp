# 3Shape Unite integration — design & runbook

> Full mechanics, setup, and reference for the **3Shape Unite Web Service** integration (OAuth 2.0 PKCE + the `/v3` REST API). This replaces the legacy `tshape:` protocol-handler launch with server-side API calls. The OAuth credentials, endpoint catalog, and investigation history live in `3Shape-WebService-Integration-Handoff.md` (repo root); this doc is the implementation behind it. Read this before touching anything under `services/threeshape/`, the 3Shape routes, or the token table.

## Overview

The clinic uses **3Shape Unite / Dental Desktop** (an intraoral-scanner suite). The app integrates with it two ways:

- **Legacy (still installed, now dormant):** a `tshape:` custom-URL-scheme protocol handler that launched Unite on the user's PC with the patient pre-filled. Push-only, needs a per-client install (`protocol-handlers/`), pulls nothing back. **Left in place** as a fallback — not removed.
- **Current:** the **native Web Service**. The app server calls Unite's on-prem REST API over the LAN with an OAuth bearer token. No per-client install; works from any browser; and it can **pull finished scans/cases/media back** + receive **webhooks**.

What the integration does today, by phase:

| Phase | Capability | Entry point |
|---|---|---|
| 0 | Connect / status / disconnect the clinic 3Shape account | Settings → Integrations |
| 1 | Push a patient + start a scan workflow | Patient sidebar → More Actions → "3Shape" |
| 2 | Pull a patient's cases + media (live, read-through) | Patient sidebar → More Actions → "3D Scans" (`/patient/:id/scans`) |
| 3 | Receive scan-lifecycle webhooks; manage the subscription | `POST /api/integrations/3shape/webhook` + admin endpoints |

## Architecture (where calls go)

```
┌─────────────────────────── Clinic LAN ───────────────────────────┐
│  Windows SERVER (this app)              WORKSTATION (WORK_PC)      │
│  ┌─────────────────────────┐   HTTPS    ┌──────────────────────┐  │
│  │ Node :3000 + Caddy       │   :5492    │ 3Shape Unite +       │  │
│  │ local.shwan-orthodontics │ ─────────► │ Web Service          │  │
│  └─────────────┬───────────┘  /v3 + Bearer (Host Device)        │  │
│                │ browser OAuth redirect    ▲ webhooks (callback) │  │
└────────────────┼──────────────────────────┼─────────────────────┘
                 ▼ (token issuance only)     │
        https://identity.3shape.com          └── POST back to the server
```

- **Unite + the Web Service run on WORK_PC, NOT on the app server.** Every `/v3` call is **server-side** (Node → `https://WORK_PC:5492`); the browser never calls 3Shape. So the base URL is the workstation's LAN address/hostname, never `127.0.0.1`.
- The Web Service cert is **self-signed** (CN `3Shape Web Service`), so the client uses a dedicated `https.Agent({ rejectUnauthorized: false })` **scoped to this client only** — never a global TLS bypass.
- The **only** cloud touch is token issuance: the admin's browser redirects to `identity.3shape.com` and back. All data calls stay on the LAN. No CORS is needed (server-side calls).
- Webhooks flow WORK_PC → the server's public LAN URL (`local.shwan-orthodontics.com`).

## Code map

**Backend service** — `services/threeshape/`:
- `oauth.ts` — all `identity.3shape.com` HTTP + the token lifecycle: `buildAuthorizeUrl`, `exchangeCode`, refresh, `getValidAccessToken` (single-flighted), `getStatus`, `disconnect`, PKCE helpers.
- `client.ts` — the `/v3` Web Service client (self-signed agent + bearer). `version`, `initiateWorkflow`, `getCases`, `getMedia`, `fetch{Media,Case}Thumbnail`, `fetchMediaDownload`, `registerWebhook`/`listWebhooks`/`deleteWebhook`.
- `dtos.ts` — Zod schemas for **untrusted** 3Shape responses (token endpoint + `/v3` items). Lenient (`safeParse` + skip); **not** app contracts.
- `errors.ts` — `ThreeShapeError { code, status }`. Codes: `not_configured · not_connected · reconnect_required · invalid_grant · unreachable · api_error · http_<n>`.
- `route-helpers.ts` — `sendThreeShapeError(res, err, fallback)`: maps codes → an HTTP response whose `error` carries the friendly message.

**Token store** — `services/database/queries/threeshape-queries.ts` + table `integration_oauth_tokens` (migration `migrations/pg/1781900000000_integration-oauth-tokens.sql`).

**Routes:**
- `routes/auth.ts` — `GET /api/auth/3shape/login` (admin) + `/callback` (state-validated). Mounted **pre-gate** at `/api/auth`.
- `routes/api/threeshape.routes.ts` — per-patient actions (`/api/threeshape/*`). **Post-gate** (staff session).
- `routes/api/threeshape-webhook.routes.ts` — the webhook **receiver**. Mounted **pre-gate** in `index.ts`.
- `routes/api/integrations.routes.ts` — status / disconnect / webhook-admin (admin-gated).

**Contracts** — `shared/contracts/threeshape.contract.ts` (patient actions) + the `threeshape*` exports in `shared/contracts/integrations.contract.ts` (status/disconnect/webhook-admin). All closed `z.object` (D2 baseline unchanged).

**Config** — `config/config.ts` `threeshape` block + `types/config.types.ts#ThreeShapeConfig`. Session PKCE state: `types/express-session.d.ts#SessionData.threeshape`. CSRF skip for the webhook: `middleware/csrf.ts`.

**Frontend:**
- `public/js/components/react/IntegrationsSettings.tsx` — the **3Shape card** (connect/reconnect/disconnect + status).
- `public/js/components/react/Navigation.tsx` — the "3Shape" action (push + start scan) and the "3D Scans" flyout entry.
- `public/js/components/react/ThreeShapeScansView.tsx` (+ `.module.css`) — the live cases/media view; routed via `ContentRenderer.tsx` `case 'scans'` at `/patient/:id/scans`.
- `public/js/query/keys.ts` (`qk.threeshape`, `qk.settings.integrationsThreeShapeStatus`) + `queries.ts` (`integrationsThreeShapeStatusQuery`, `threeShapeCasesQuery`, `threeShapeMediaQuery`).

## Configuration (env)

All optional — blank `THREESHAPE_CLIENT_ID` / `THREESHAPE_WEBSERVICE_BASE` disables the integration (status reports "Not configured"). Documented in `.env.example`.

```
THREESHAPE_CLIENT_ID        = ShwanOrtho.UPIP.PMS.Production.AS   # public PKCE client, NO secret
THREESHAPE_AUTHORITY        = https://identity.3shape.com
THREESHAPE_SCOPES           = openid api profile api.workflow.init api.media.read api.media.download api.cases.read license.read offline_access
THREESHAPE_REDIRECT_URI     = https://local.shwan-orthodontics.com/api/auth/3shape/callback
THREESHAPE_WEBSERVICE_BASE  = https://WORK_PC:5492     # prefer the hostname (DHCP-stable) over the IP
THREESHAPE_WEBHOOK_SECRET   =                          # optional; enables the webhook receiver + registration
THREESHAPE_WEBHOOK_URL      =                          # optional; defaults to the redirect URI origin + /api/integrations/3shape/webhook
```

- `THREESHAPE_REDIRECT_URI` **must exactly match** a redirect URI registered with 3Shape (`local.shwan-orthodontics.com/api/auth/3shape/callback` or `http://localhost:3000/...`). To add more, email the 3Shape TAM (see the handoff doc).
- `THREESHAPE_WEBSERVICE_BASE` — if WORK_PC's IP is DHCP, prefer the hostname or set a DHCP reservation; the self-signed cert won't match either way, so the tolerant agent is required regardless.

## OAuth flow (connect)

Authorization Code + PKCE, public client (no secret). All of this is server-driven; the browser only follows redirects.

1. Admin clicks **Connect** in Settings → Integrations → full-page nav to `GET /api/auth/3shape/login` (admin-guarded).
2. Server generates `code_verifier`, `code_challenge` (S256), and `state`; stashes `{state, verifier, createdAt}` in the **session** (`req.session.threeshape`); `req.session.save()`; 302 → `…/connect/authorize`.
3. Admin signs in at 3Shape → browser is redirected back to `…/api/auth/3shape/callback?code=…&state=…`. The staff cookie is `sameSite:'lax'`, so the session (with the verifier) rides along.
4. Callback validates `state` against the session, checks the 10-min TTL, exchanges the code at `…/connect/token` (no auth header), persists tokens, clears the PKCE state, and redirects to `/settings/integrations?threeshape=connected` (or `…=error&reason=<code>`). The card reads the flag, toasts, refreshes status, and strips it from the URL.

**Refresh** is centralized in `getValidAccessToken()`: it refreshes when within 60 s of expiry, **single-flighted** (concurrent callers share one round-trip). On `invalid_grant` it clears tokens and surfaces `reconnect_required`.

### Token storage (local-only by design)

One row in `integration_oauth_tokens` (PK `provider='3shape'`): `access_token`, `refresh_token`, `token_type`, `scope`, `expires_at`, `updated_at` (all `timestamp` **without** time zone, per the single-clinic wall-clock convention — **not** `timestamptz`).

⚠️ **This table carries NO `cdc_capture` trigger** — it is deliberately **not** mirrored to Supabase, so the clinic's OAuth tokens never leave the on-prem server. (Contrast the `options` table, which *is* captured — that's why the Telegram session lives there but these tokens do not.) There is therefore intentionally **no** Supabase mirror DDL. Tokens are never logged and never sent to the client.

Apply (squashed-baseline state — `node-pg-migrate up` would replay the baseline; `psql -f` would also run the migration's Down):

```bash
scripts/psql.sh local -c "CREATE TABLE IF NOT EXISTS public.integration_oauth_tokens ( … );"   # Up only, LOCAL only
npm run db:codegen   # regenerate types/db.d.ts
```

## Endpoint reference

**Browser / OAuth (pre-gate, `/api/auth`)**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/3shape/login` | admin session | start PKCE flow, 302 to 3Shape |
| GET | `/api/auth/3shape/callback` | `state` + session | exchange code, store tokens, redirect to Settings |

**Management (admin-gated, `/api/integrations`)**
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/integrations/3shape/status` | `{ configured, connected, expiresAt, scopes }` (no live workstation call) |
| POST | `/api/integrations/3shape/disconnect` | clear stored tokens |
| POST | `/api/integrations/3shape/webhook/register` | subscribe WORK_PC to scan events (needs `THREESHAPE_WEBHOOK_SECRET`) |
| GET | `/api/integrations/3shape/webhooks` | list subscriptions |
| DELETE | `/api/integrations/3shape/webhooks/:subscriptionId` | remove a subscription |

**Patient actions (staff-gated, `/api/threeshape`)**
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/threeshape/patients/:personId/initiate-workflow` | push patient (IntegrationId = `person_id`) + start a scan |
| GET | `/api/threeshape/patients/:personId/cases` | list the patient's cases (live) |
| GET | `/api/threeshape/patients/:personId/media` | list the patient's media (live) |
| GET | `/api/threeshape/media/:mediaId/download` | proxy a media file (binary) |
| GET | `/api/threeshape/media/:mediaId/thumbnail` | proxy a media thumbnail (binary) |
| GET | `/api/threeshape/cases/:caseId/thumbnail` | proxy a case thumbnail (binary) |

**Webhook receiver (pre-gate, shared-secret)**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/integrations/3shape/webhook` | shared secret | receive 3Shape event callbacks |

`IntegrationId` is always the app's **`person_id`** (the legacy human `patient_id` is unused). The binary endpoints are served to `<img>`/download links (not the JSON funnel), so they carry no response contract; they buffer the upstream bytes and forward content-type/disposition.

## Frontend surfaces

- **Settings → Integrations → 3Shape card** — shows Not configured / Not connected / Connected + token expiry. "Connect"/"Reconnect" is a **full-page nav** to `/api/auth/3shape/login` (a sanctioned external-OAuth exception to the SPA-only nav rule); "Disconnect" is a funneled `postJSON`.
- **Patient sidebar → More Actions → "3Shape"** — POSTs `initiate-workflow`; toasts "Sent to 3Shape — start the scan on the scanner" (or the friendly error). Shows "Sending…" while in flight.
- **Patient sidebar → More Actions → "3D Scans"** (`/patient/:id/scans`) — `ThreeShapeScansView` reads cases + media **live** on open (`retry:false`); a not-connected/unreachable error links to Settings → Integrations. Thumbnails and downloads are proxied. **No local mirroring** — the data model has no 3D storage and we don't shoehorn scans into `time_point_images`; persistence (save-to-folder / auto-import) is a future enhancement.

## Webhooks

- **Receiver** `POST /api/integrations/3shape/webhook` is mounted **pre-gate** (WORK_PC has no session) and **CSRF-exempt** (skip list in `middleware/csrf.ts`). It authenticates via `THREESHAPE_WEBHOOK_SECRET`, accepting it as `Authorization: Bearer <secret>`, raw `Authorization`, or `x-webhook-secret` (constant-time compare). It parses the event leniently, logs `[3Shape webhook] event received { eventType, integrationId }`, and acks `200`.
- **Register** via `POST /api/integrations/3shape/webhook/register` — sends `CallbackUrl` (config or derived from the redirect origin), `AuthSchema='Bearer'`, `AuthValue=<secret>`, and a default event set (`case_created, case_updated, media_added, scan_completed`).
- **Extension point:** `integrationId === person_id`, so a future enhancement can map the event to the patient and notify staff (Tasks/SSE) or refresh an open "3D Scans" tab. The receiver currently only logs + acks.

## Setup / runbook (ops)

1. **On WORK_PC:** Unite/Dental Desktop running + signed in (account `schwan.ortho@gmail.com`) so the Web Service is initialized; the workstation is the selected **Host Device**; firewall allows inbound TCP **5492** from the server.
2. **On the server:** set the `THREESHAPE_*` env block; apply the token-table DDL (above) to the local PG; `npm run build` + restart the Windows service.
3. **Connect:** Settings → Integrations → Connect 3Shape → sign in → land on "Connected".
4. **(Optional) Webhooks:** set `THREESHAPE_WEBHOOK_SECRET`, then `POST /api/integrations/3shape/webhook/register` (as admin).

## Verification

- **Reachability (from the server):** `GET https://WORK_PC:5492/version` → **401** (exists, needs a token). With a valid token → **200** (`client.version()`).
- **Connected:** `GET /api/integrations/3shape/status` → `connected:true`, a future `expiresAt`.
- **Push:** open a patient → "3Shape" → the patient + scan workflow appear in Unite on WORK_PC.
- **Pull:** open "3D Scans" → a finished case's media lists; Download works.
- **Token smoke test (standalone):** `test-3shape-oauth.ps1` (Desktop) does the full PKCE flow without the app.

> ⚠️ The full OAuth round-trip can't complete on the WSL dev box (redirect URIs are `local.shwan-orthodontics.com` / `localhost:3000`; dev Express is `:3001`) and no `/v3` call has been made against a live WORK_PC. Do the steps above on the server.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Card shows "Not configured" | `THREESHAPE_CLIENT_ID`/`WEBSERVICE_BASE` blank | set env, restart |
| "Not connected — connect in Settings" | no stored token | Connect (admin) |
| "session is no longer valid — reconnect" (`reconnect_required`) | refresh token revoked/expired (`invalid_grant`) | Reconnect |
| "Could not reach the Web Service… port 5492" (`unreachable`) | WORK_PC off / Unite not signed in / firewall | start Unite, open 5492 |
| callback → `?threeshape=error&reason=invalid_state` | session lost between login & callback | retry; check the staff cookie is `sameSite:lax` and the session store is healthy |
| callback → `reason=redirect_uri_mismatch` (or 3Shape error page) | `THREESHAPE_REDIRECT_URI` ≠ a registered URI | align env with the registration |
| Scans list empty but connected | patient never pushed, or 3Shape JSON field names differ | push first; confirm `/v3` field casing (see below) |

## Known limitations & invariants

- **`/v3` JSON shapes are parsed leniently** (`dtos.ts` `safeParse` + `extractArray` envelope sniff) because the exact PascalCase field names/paging envelope weren't confirmable off the live workstation. If a list renders empty against real data, verify the field names in `dtos.ts` (`v3Case`/`v3Media`/`v3Webhook`) and the envelope keys in `client.ts#extractArray`.
- **Binary downloads buffer in memory** (`arrayBuffer()` → `Buffer`) — fine at clinic scale; switch to streaming if very large 3D files become common.
- **`unreachable` is returned as HTTP 400** (not 500) on purpose — a powered-off workstation is an expected operational state, so it surfaces as a toast without hitting the 5xx client-error sink.
- **The legacy `tshape:` protocol handler is intentionally left installed** (`protocol-handlers/`, the `TShapePath` INI key). It is dormant — the UI button no longer uses it — but remains a zero-dependency fallback.
- Webhook tokens / OAuth tokens are **local-only** (see Token storage). Do not add a `cdc_capture` trigger to `integration_oauth_tokens`.
