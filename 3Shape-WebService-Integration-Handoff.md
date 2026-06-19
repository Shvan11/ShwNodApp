# 3Shape Unite Web Service — Integration Implementation Handoff

> **Audience:** Claude Code running **on the Windows Server machine** that hosts the
> `dolphnode` app (repo: `ShwNodApp`, served at `https://local.shwan-orthodontics.com`,
> Node on `localhost:3000` behind Caddy).
> **Task:** Implement a 3Shape Unite Web Service integration into the app: OAuth 2.0 (PKCE)
> sign-in, token storage + refresh, and a client that calls the Unite `/v3` API on the
> workstation across the LAN.
> **Status:** ✅ **Unblocked.** OAuth Client ID issued by 3Shape and the registration is
> validated (client_id recognized, both redirect URIs accepted, scopes accepted, PKCE S256
> supported). What remains is to build it into the app.
> **Last updated:** 2026-06-17.

---

## 0. TL;DR for the implementer

1. Build an **OAuth 2.0 Authorization Code + PKCE** flow against `https://identity.3shape.com`
   (it is a public client — **no client secret**).
2. Add two routes under the **pre-auth** `/api/auth` mount (so the browser redirect lands
   outside the staff/admin gate):
   - `GET /api/auth/3shape/login` — start the flow (generate PKCE, stash in session, 302 to 3Shape).
   - `GET /api/auth/3shape/callback` — receive `?code`, exchange for tokens, persist, redirect to a success page.
3. Persist `{access_token, refresh_token, expires_at, scope}` (PostgreSQL table recommended;
   the repo already has `migrations/`). Auto-refresh with the `refresh_token` (you requested
   `offline_access`, so you get one).
4. Build a **3Shape API client service** that calls the Web Service on the **workstation
   Host Device** at `https://<workstation-LAN-IP>:5492/v3/...` with `Authorization: Bearer <access_token>`.
   The cert is self-signed → use a dedicated HTTPS agent for that host.
5. Wire `dolphnode` patient/case actions to the v3 verbs in §6.

The legacy `/DentalDesktop/WebService` + **Basic auth** API (§7) still works and needs **no
OAuth** — keep it as a zero-setup fallback / for verbs v3 lacks.

---

## 1. Architecture (READ THIS — it determines where calls go)

```
┌─────────────────────────── Clinic LAN ───────────────────────────┐
│                                                                   │
│  Windows SERVER machine                 WORKSTATION machine       │
│  ┌─────────────────────────┐            ┌──────────────────────┐  │
│  │ dolphnode (this app)     │  HTTPS     │ 3Shape Unite +       │  │
│  │ Node :3000 + Caddy       │  :5492     │ Web Service module   │  │
│  │ local.shwan-orthodontics │ ─────────► │ (the "Host Device")  │  │
│  └─────────────┬───────────┘            └──────────────────────┘  │
│                │ browser OAuth redirect                            │
└────────────────┼──────────────────────────────────────────────────┘
                 │ (token issuance only)
                 ▼
        https://identity.3shape.com   (3Shape cloud identity / OIDC)
```

- **The app and Unite are on DIFFERENT machines on the same LAN.** Therefore the API base
  URL is the **workstation's LAN address** — **NOT** `127.0.0.1`. **Verified 2026‑06‑17 on
  the workstation (`WORK_PC`):** Ethernet `192.168.100.66`, Wi‑Fi `192.168.100.86` (and a
  ZeroTier overlay `10.147.20.230`). Use the **Ethernet** address `https://192.168.100.66:5492`
  if the workstation is wired. ⚠️ These are **DHCP** addresses and can change — for a stable
  integration set a **static IP / DHCP reservation**, or use the **hostname** (`https://WORK_PC:5492`,
  resolvable on the LAN). The self‑signed cert CN is `3Shape Web Service` (won't match either
  way), so the self‑signed‑tolerant agent in §5 is required regardless. (The old
  `192.168.100.57` from the 2026‑06‑12 investigation is **stale — do not use**.)
- 3Shape confirmed (email, 2026‑06‑16): because the app backend is fully on‑premise and on
  the same LAN as the Unite Host Device, it **communicates directly with the Web Service —
  no cloud bridge/middleware is required.** (A bridge is only for cloud‑hosted PMS backends.)
- Only the **token issuance** (browser → `identity.3shape.com` → redirect back) touches the
  cloud. All API calls stay on the LAN.
- **CORS:** not required — all API calls are server‑side from Node (the browser never calls
  3Shape directly). 3Shape confirmed CORS config is unnecessary for this design.

### Prerequisites on the workstation (ops, do once)
1. **Unite/Dental Desktop running & signed in** (account `schwan.ortho@gmail.com`) so the Web
   Service is `Initialized` and the license lease is active.
2. **Firewall:** allow inbound TCP **5492** on the workstation from the server's IP.
3. **Host Device:** confirm the workstation is selected as the Host Device on the Unite
   settings page (this is the address the app points to).
4. **TLS:** the Web Service cert is self‑signed (`Subject = "3Shape Web Service"`). The Node
   client must trust it or skip validation for that host (see §5).

---

## 2. OAuth 2.0 (PKCE) — issued credentials & endpoints

| Item | Value |
|---|---|
| **Client ID** | `ShwanOrtho.UPIP.PMS.Production.AS` |
| **Client type** | **Public** — PKCE, **no client secret** |
| **Authority (issuer)** | `https://identity.3shape.com` |
| **Authorize endpoint** | `https://identity.3shape.com/connect/authorize` |
| **Token endpoint** | `https://identity.3shape.com/connect/token` (POST, **no client auth header**) |
| **Discovery** | `https://identity.3shape.com/.well-known/openid-configuration` |
| **PKCE method** | `S256` (supported & required-style; verified) |
| **Scopes** | `openid api profile api.workflow.init api.media.read api.media.download api.cases.read license.read offline_access` |
| **Redirect URIs (registered)** | `https://local.shwan-orthodontics.com/api/auth/3shape/callback` (primary) · `http://localhost:3000/api/auth/3shape/callback` (dev) |

Scope → capability map: `api.workflow.init` = start a scan/workflow; `api.cases.read` =
list/read cases; `api.media.read` / `api.media.download` = pull scans/images; `license.read`
= license info; `offline_access` = **refresh token** (silent renewal). To add more redirect
URIs/scopes later, email Maryna Pasynkova `maryna.pasynkova@3shape.com`.

### 2.1 Flow to implement (Authorization Code + PKCE)
1. Generate `code_verifier` = base64url(32 random bytes); `code_challenge` =
   base64url(SHA256(ascii(code_verifier))). Generate a random `state`.
2. Store `{code_verifier, state}` in the **session** (short-lived).
3. 302 the browser to:
   `…/connect/authorize?client_id=…&response_type=code&scope=<space-joined, url-encoded>&redirect_uri=<registered>&code_challenge=<challenge>&code_challenge_method=S256&response_mode=query&state=<state>`
4. User signs in at 3Shape → browser is redirected to the registered `redirect_uri?code=…&state=…`.
5. Validate returned `state` == stored `state`. Look up the matching `code_verifier`.
6. **POST** `…/connect/token`, `Content-Type: application/x-www-form-urlencoded`, **no auth header**, body:
   `grant_type=authorization_code&code=<code>&redirect_uri=<same redirect>&client_id=ShwanOrtho.UPIP.PMS.Production.AS&code_verifier=<verifier>`
   → response: `access_token`, `refresh_token`, `expires_in`, `token_type=Bearer`, `id_token`.
7. Persist tokens with `expires_at = now + expires_in` (see §4).

### 2.2 Refresh (use before the access token expires)
POST `…/connect/token`, no auth header, body:
`grant_type=refresh_token&refresh_token=<refresh>&client_id=ShwanOrtho.UPIP.PMS.Production.AS`
→ new `access_token` (+ possibly rotated `refresh_token` — persist whatever comes back).
Refresh proactively when `now >= expires_at - 60s`. On `invalid_grant`, fall back to the
`/login` flow (refresh token revoked/expired).

---

## 3. Implementation plan in the `dolphnode` repo

> Follow existing repo conventions — don't invent new patterns. Observed conventions:
> Express + **ESM** (import paths end `.js` even for `.ts` sources), TypeScript, route
> modules in `routes/` and `routes/api/`, the **shared-contract** pattern
> (`shared/contracts/*.contract.ts` + `validate({...})` middleware + `sendData(res, …)` +
> `ErrorResponses` from `utils/error-response.js`), logging via `utils/logger.js` (`log.*`),
> auth middleware in `middleware/auth.js` (`authorize(['admin'])`), PostgreSQL with SQL
> files in `migrations/`. Mirror the **Telegram integration** (`routes/api/integrations.routes.ts`
> + `services/messaging/telegram-auth.ts`) as the closest existing example.

### 3.1 Routes — split by auth tier (IMPORTANT)
An OAuth callback is a **top-level browser navigation**, so it must be reachable **outside**
the staff/admin gate and the CSRF check. The repo already mounts gate-exempt routers
**pre-gate in `index.ts`** (e.g. `app.use('/api/auth', authRoutes)`, `/api/portal`,
`lookupRoutes`). Put the 3Shape browser-facing routes there too. (GET requests are CSRF-safe,
so the GET callback passes the existing `staffCsrfProtection`.)

Create `routes/3shape-auth.ts` (or extend the existing `/api/auth` router) and mount it
**pre-gate** in `index.ts` next to `authRoutes`:

```
GET /api/auth/3shape/login
    - inline-guard with admin auth (only an admin should connect the clinic account)
      using the same authenticate/authorize used elsewhere; this route IS allowed to
      require a session because the admin starts it from inside the app.
    - generate verifier/challenge/state, store in req.session, 302 to authorize URL.

GET /api/auth/3shape/callback        (NO gate; validate via `state` + session)
    - read code/state/error from query; if error -> render/redirect to an error page.
    - verify state matches session; exchange code -> tokens (§2.1 step 6); persist (§4);
      clear PKCE session fields; redirect to a small success page (e.g. /settings or
      /integrations with a success flag).
```

Management/status endpoints (connect status, disconnect) belong under the **admin-gated**
`routes/api/integrations.routes.ts` (mounted at `/api/integrations`), mirroring Telegram:
```
GET    /api/integrations/3shape/status    -> { connected, expiresAt, scopes }
POST   /api/integrations/3shape/disconnect-> clear stored tokens
```

### 3.2 Service layer
- `services/threeshape/oauth.ts` — `buildAuthorizeUrl()`, `exchangeCode()`, `refresh()`,
  `getValidAccessToken()` (returns a live token, refreshing if needed). Keep all
  `identity.3shape.com` HTTP here.
- `services/threeshape/client.ts` — typed wrapper over the **Web Service `/v3`** API
  (base URL from config = workstation `:5492`). Each method calls `getValidAccessToken()`,
  sends `Authorization: Bearer`, uses the self-signed-tolerant HTTPS agent (§5), maps to the
  endpoints/DTOs in §6.
- `shared/contracts/threeshape.contract.ts` — request/response schemas for the new
  endpoints, consistent with the other `*.contract.ts` files.

### 3.3 Config / env vars (add to the app's config + `.env`, never commit secrets)
```
THREESHAPE_CLIENT_ID       = ShwanOrtho.UPIP.PMS.Production.AS
THREESHAPE_AUTHORITY       = https://identity.3shape.com
THREESHAPE_SCOPES          = openid api profile api.workflow.init api.media.read api.media.download api.cases.read license.read offline_access
THREESHAPE_REDIRECT_URI    = https://local.shwan-orthodontics.com/api/auth/3shape/callback
THREESHAPE_WEBSERVICE_BASE = https://192.168.100.66:5492     # WORK_PC Ethernet (verified 2026-06-17; DHCP — prefer static/reservation or https://WORK_PC:5492)
# no client secret (public PKCE client)
```

---

## 4. Token storage

Recommended: a PostgreSQL table (add a migration in `migrations/`), one row per provider:
```sql
CREATE TABLE IF NOT EXISTS integration_oauth_tokens (
  provider       text PRIMARY KEY,          -- '3shape'
  access_token   text NOT NULL,
  refresh_token  text,
  token_type     text NOT NULL DEFAULT 'Bearer',
  scope          text,
  expires_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```
Store tokens encrypted at rest if the repo already has an app-secret/crypto helper; otherwise
at minimum keep them out of logs and version control. (For reference, the existing Google
integration persists to a `token.json` file — a DB row is preferable here for refresh
bookkeeping, but match whatever the codebase standard is.)

---

## 5. Calling the Web Service across the LAN (self-signed cert)

The base URL is the **workstation**, and the cert is self-signed, so create a dedicated
HTTPS agent and use it ONLY for the Web Service host:
```ts
import https from 'node:https';
// Self-signed LAN cert for the 3Shape Web Service Host Device. Scope this agent to
// THREESHAPE_WEBSERVICE_BASE only — do not disable TLS verification globally.
const threeShapeAgent = new https.Agent({ rejectUnauthorized: false });
```
(Hardening option, optional: export the workstation's Web Service cert and pin it via the
agent's `ca`/`checkServerIdentity` instead of `rejectUnauthorized:false`.)

A successful unauthenticated probe to confirm reachability/cert from the server:
`GET https://<workstation>:5492/version` → expect **401** (endpoint exists, needs Bearer).
With a valid Bearer it returns **200**.

---

## 6. API reference — `/v3` (PRIMARY; OAuth Bearer, JSON)

Base: `https://<workstation>:5492`, header `Authorization: Bearer <access_token>`, JSON.

| Verb | Path | Params | Purpose |
|---|---|---|---|
| GET | `/version` | — | service version (use as a Bearer smoke test) |
| GET | `/v3/patients` | `PatientSearchParametersDto` (query) + `offset`,`pageSize` | search patients (paged) |
| POST | `/v3/patients/initiate-workflow` | `InitiateWorkflowDto` (body) | **start a scan/workflow** |
| GET | `/v3/patients/{integrationId}/cases` | `offset`,`pageSize`,`workflowStatus?` | list a patient's cases (paged) |
| GET | `/v3/case/{caseId}/thumbnail` | path `caseId` | case thumbnail |
| GET | `/v3/patients/{integrationId}/media` | `type?`,`offset`,`pageSize` | list media for a patient |
| GET | `/v3/media/{id}/download` | `fileId?`,`format?` | download a media file |
| GET | `/v3/media/{id}/thumbnail` | `imageFormat?` | media thumbnail |
| POST | `/v3/patients/{integrationId}/media/upload` | `UploadData` (multipart `Files[]`) | upload media to a patient |
| POST | `/v3/patients/{integrationId}/media/check` | `HashData {Hashes:[…]}` (body) | verify all files uploaded |
| POST | `/v3/webhooks` | `WebhookRegistration` (body) | register/update a webhook |
| GET | `/v3/webhooks` | — | list subscriptions |
| DELETE | `/v3/webhooks/{subscriptionId}` | path | remove a subscription |
| POST | `/v3/launchUnite` | `UniteLaunchParametersDto` (body) | launch Unite/Dental Desktop |

```
PatientSearchParametersDto: FirstName, LastName, DateOfBirth(date?), PatientId,
                            IntegrationId, PhoneNumber, Email
InitiateWorkflowDto: PatientDetails { IntegrationId, FirstName, LastName, PatientId,
                            Email, PhoneNumber, DateOfBirth(date?), Gender(int?), Notes }
WebhookRegistration: SubscriptionId, CallbackUrl(uri), AuthSchema, AuthValue,
                     SubscribedEvents: EventType[], CreatedAt, UpdatedAt
UploadData (multipart): Files: IFormFile[]
HashData (body): Hashes: string[]
UniteLaunchParametersDto: (empty body)
```
Webhook event types: `case_created, case_updated, media_added, media_updated,
scan_completed, patient_created, patient_updated, patient_deleted, request_handled,
request_rejected`. Register a `CallbackUrl` on the app (e.g.
`https://local.shwan-orthodontics.com/api/integrations/3shape/webhook`) + `AuthSchema`/
`AuthValue` so 3Shape can authenticate to the app; this replaces polling.

**`IntegrationId`** is the app's own stable patient key — the join key across all
patient/case/media calls. Choose once per patient and reuse.

### Typical workflows
- **Push patient + start scan:** `POST /v3/patients/initiate-workflow` with `PatientDetails`
  (incl. `IntegrationId`) → subscribe to / receive `scan_completed` webhook (or poll cases).
- **Pull finished scans:** `GET /v3/patients/{integrationId}/cases?workflowStatus=…` → for
  each case, `GET /v3/case/{caseId}/thumbnail` and media via
  `GET /v3/patients/{integrationId}/media` → `GET /v3/media/{id}/download`.
- **Launch Unite:** `POST /v3/launchUnite`.

---

## 7. API reference — legacy `DentalDesktop/WebService` (FALLBACK; Basic auth, zero OAuth)

Still fully working with the settings-page Basic credentials — useful as a fallback or for
verbs `/v3` lacks. Decoded from `…WebService.Legacy.dll` (v1.8.16.1), cross-checked live.

- **Base URL:** `https://<workstation>:5492/DentalDesktop/WebService`
- **Auth:** `Authorization: Basic base64(<user>:<pass>)` — credentials are on the Web Service
  settings page and **rotate** via the ↻ icon (read live; do not hardcode). The pair seen
  during investigation was `mPtzYbQehWwx:aUKma1w83eVC` (may have rotated).
- Most responses are **XML** (`Accept: application/xml`); some also JSON.
- `FromQuery` DTOs bind as flat query-string keys; `FromBody` = JSON; `{caseId}` = path.

| Verb | Path | Notes |
|---|---|---|
| GET | `/serviceStatus`, `/status` | discovery (no auth) — health + endpoint catalog |
| GET | `/GetAvailableClientList`, `/GetAvailableTriosClientList` | list scanner clients (`ClientInfo[]`) |
| GET | `/CreatePatient`, `/UpdatePatient`, `/SelectPatient` | patient push/select (query-param DTOs) |
| GET | `/v2/patient` | read patient |
| POST | `/RequestProcessPatient` | request workflow (JSON `ProcessPatientRequest`) |
| GET | `/GetCasesForPatient`, `/GetCasesInformation`, `/CreateCase`, `/SelectCase` | cases |
| GET/POST | `/v2/case/{caseId}`, `/v2/case` | read / create case (v2) |
| GET | `/GetScan`, `/GetAttachedImage` | pull scan output / media (binary) |
| GET | `/GetUnhandledRequests`, `/GetRequestStatusById`, `/RemoveRequestById` | async request queue |
| GET | `/GetAuthenticationKey` | mints a Branca token (alt auth) — not needed with Basic |

```
CreatePatientRequestDto: FirstName, LastName, DateOfBirth(date), SSN, IntegrationId, MergePatient(bool)
PatientClientControlRequestDto: IntegrationId           (SelectPatient / CreateCase)
CaseClientControlRequestDto: CaseId(Guid)               (SelectCase)
CaseSearchArguments: IntegrationId, IsCreated, IsScanned, IsModelled, CreationDateFrom/To, DeliveryDateFrom/To
ProcessPatientRequest (JSON): CaseId(Guid), ClientId(Guid), RequestId(Guid),
    RequestType(CreateCase|OpenCase|CreatePatient|UpdatePatient|ActivatePatient),
    ShouldMergePatient(bool), MultiClientRequest(bool),
    Patient { FirstName, LastName, DateOfBirth(date), PatientId, SSN }
CaseDto: Id, Name, WorkflowId, ItemNames, IsScanned(bool), IsModelled(bool)
```
Legacy push+scan: `CreatePatient` → pick `ClientId` from `GetAvailableClientList` →
`POST /RequestProcessPatient (RequestType=CreateCase)` → poll `GetRequestStatusById?id=<RequestId>` →
`GetScan?caseId=<id>`.

---

## 8. Testing & verification

1. **Token (manual, one-off):** [`test-3shape-oauth.ps1`](C:/Users/Shwan/Desktop/test-3shape-oauth.ps1)
   on the Desktop does the full PKCE flow (generates PKCE, opens browser, catches the
   `localhost:3000` redirect, exchanges code, prints/saves tokens). Run where port 3000 is
   free (stop the app first, or run on the workstation). Sign in as `schwan.ortho@gmail.com`.
2. **Registration is already verified** (2026‑06‑17): authorize with each registered redirect
   → `302 /Account/Login` (accepted); authorize with an unregistered redirect → `302 /home/error`
   (rejected). So client_id, redirect URIs, scopes, and S256 are all good.
3. **Bearer smoke test:** with a token, `GET https://<workstation>:5492/version` → **200**.
4. **App flow:** hit `/api/auth/3shape/login` as admin → sign in → land on success page →
   `GET /api/integrations/3shape/status` shows `connected:true` → a `/v3/patients` search returns data.

---

## 9. Security / correctness checklist for the implementation
- [ ] `state` generated, stored in session, and **validated** on callback (CSRF for OAuth).
- [ ] PKCE `code_verifier` kept server-side (session), never sent to the browser.
- [ ] Callback route is gate-exempt but **only** acts on a valid `state`; `/login` is admin-only.
- [ ] Tokens stored server-side (DB), never logged, never sent to the client; refresh handled
      centrally in `getValidAccessToken()`.
- [ ] Self-signed-cert HTTPS agent scoped to the Web Service host only (no global TLS bypass).
- [ ] No client secret in code/config (public client). No hardcoded Basic credentials (they rotate).
- [ ] Workstation IP/Host Device + firewall :5492 confirmed before first call.
- [ ] Graceful handling of `invalid_grant` on refresh → prompt re-login.

---

## Appendix A — investigation history (condensed background)

The original multi-session investigation (2026‑06‑12) established, on the workstation:
- The Web Service exposes **two** API surfaces on port **5492** (HTTPS, no-client-cert port;
  5491 is the mutual-TLS port; 5490 is an internal HTTP listener): modern **`/v3`** and legacy
  **`/DentalDesktop/WebService`**.
- **Basic auth works on legacy** (verified `GET /GetAvailableClientList` → 200 with real
  client data, operator "Shwan Abdulkareem") but is **silently ignored on `/v3`** (401 with no
  `WWW-Authenticate`, identical to no-auth). `/v3` accepts **Bearer/OAuth only** (a bogus
  Bearer returns `WWW-Authenticate: Bearer error="invalid_token"`, proving the OAuth handler
  is the live one). Dead ends ruled out along the way: license gate, a Basic-auth toggle, and
  Branca pairing — none are required.
- Prerequisite for any API use: **Unite/Dental Desktop running & signed in** (service
  `Initialized`, license lease 200 from `client.license.3shape.com`).

Then (2026‑06‑15/16/17): contacted 3Shape (`pms@3shape.com`, TAM Maryna Pasynkova), chose the
existing‑clinic‑license + internal‑use path, and received the **Client ID + redirect URI
registration** in §2. Architecture clarified to **app‑on‑server / Unite‑on‑workstation, same
LAN, direct calls, no bridge, no CORS** (§1). Unite Store app to be created internally as
"Shwan Orthodontics – Unite Integration".

## Appendix B — service facts (workstation)
| Item | Value |
|---|---|
| Web Service process | `ThreeShape.Integrations.PracticeManagement.WebService.exe` |
| Install dir | `C:\Program Files\3Shape\3Shape Web Service` |
| ProgramData / Logs | `C:\ProgramData\3Shape\PracticeManagement.WebService\Logs\log-<date>.txt` |
| Client port (Basic/Bearer) | **5492** (HTTPS, self-signed `Subject="3Shape Web Service"`) |
| Mutual-TLS port | 5491 (client cert) |
| Identity / KMS | `identity.3shape.com` (OIDC), `kms.3shape.com` (license) |
| Workstation (verified 2026‑06‑17) | hostname `WORK_PC`; Ethernet `192.168.100.66`, Wi‑Fi `192.168.100.86`, ZeroTier `10.147.20.230`. Web Service confirmed listening on 5492. (`192.168.100.57` is stale.) DHCP → prefer static/reservation or hostname. |
