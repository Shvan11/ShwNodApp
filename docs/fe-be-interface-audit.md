# Frontend ↔ Backend API Seam — Audit & Remediation Tracker

> **Living document.** This is the canonical tracker for the third major audit (the FE↔BE
> *interface*, after the standalone frontend and backend audits). We work it **item by item
> across sessions**. When you act on an item: flip its status box, fill in the **Done:** note
> with the commit/date and what changed, and add anything new you discover to
> [§5 New findings](#5-new-findings-discovered-during-remediation) and the
> [§6 Progress log](#6-progress-log).

**Method:** 10-dimension multi-agent audit (83 agents); every finding adversarially verified
against the actual code before landing here. 70 findings confirmed; refuted findings dropped.
**Audit date:** 2026-06-04.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` won't-fix / not-an-issue (explain in note)

**Scope note:** This tracker covers only the *seam* — the HTTP/SSE contract between the React
staff/portal frontends and the Express backend. Backend-internal and frontend-internal quality
were covered by the two earlier audits.

---

## 1. Executive summary

The seam is **functionally working but structurally fragile**. Verified-clean: endpoint
reachability (every sampled method/path pair matches, no hardcoded URLs), SSE event naming, and
the PG type-parser strategy (`date`→`'YYYY-MM-DD'` string, `numeric`/`bigint`→number,
`bit`→boolean). The core problem is **there is no enforced contract at the boundary**:

- The backend emits at least **three** response shapes — raw data, the `sendSuccess` envelope,
  and per-endpoint custom objects.
- The hand-maintained FE/BE types have **drifted** (phantom root-level `code`, missing `timestamp`).
- **310 raw `fetch()` calls across 85 files bypass `public/js/core/http.ts`**, so error handling,
  credential transmission, and response validation are all per-component.
- Only the Patient Portal validates responses (Zod at the fetch boundary); the staff app trusts
  the wire.

Net effect: a broken query or renamed field surfaces as `undefined` in the UI instead of a caught
error.

**Only two findings are currently user-visible bugs:** H7 (dates render a day early) and H8
(chair-display visit date never renders). M1 is degraded-but-not-silent UX. Everything else is
structural risk that hasn't bitten yet.

---

## 2. Recommended remediation sequence

Work top-down — later phases assume earlier ones landed.

1. **Quick wins** (§4) — the user-visible bugs (H7, H8, M1) + cheap type/mount fixes. Do first.
2. **Standardize the backend envelope** — every route on `sendSuccess`/`ErrorResponses`; unify
   `code` location; always emit `timestamp`. Items: **H4, H9, M1, M2, M5**.
3. **Fix FE types** to match the now-stable contract. Items: **M2, M3**.
4. **Introduce `@tanstack/react-query` + an ESLint ban on bare `fetch`**, migrating high-traffic
   components first. Items: **H1, H3, M4, M7, M8**.
5. **Add Zod validation** — response validation at the staff fetch boundary (**H11**) and
   `validate()` on mutations (**H10**).
6. **CSRF** protection on mutations (**H2**) — best layered in once everything routes through one
   client (step 4).
7. **Optional / last:** `ts-rest` or zod-openapi codegen to make the contract self-enforcing
   (only after the envelope is stable).

---

## 3. Findings

Severity reflects the verifier's adjusted rating.

### High

#### [ ] H1 — 310 raw `fetch()` bypass `core/http.ts`
- **Where:** `AddPatientForm.tsx:113`, `AppointmentCalendar.tsx:253`, `AlignerDoctorsSettings.tsx:40`, `hooks/useStand.ts`, `hooks/useExpenses.ts`, `pages/aligner/*.tsx`, +~270 more. Only ~39 of 310 sites use `fetchJSON/postJSON/putJSON/deleteJSON`.
- **Problem:** `core/http.ts` throws `HttpError` on `!ok` and defaults `credentials:'same-origin'`, but most components call bare `fetch()`.
- **Impact:** Inconsistent error UX (some toast, some `console.error`, some fail silently e.g. `GridComponent.tsx:214`); no abort-on-unmount → setState-after-unmount / stale races; an envelope change touches 85 files.
- **Fix:** Funnel all calls through `core/http.ts`; add an ESLint rule banning bare `fetch()` in `public/js/components`. **Keystone fix** — most other items dissolve once done. Pairs with React Query (step 4).
- **Done:** _(pending)_

#### [ ] H2 — No CSRF protection on any state-changing endpoint
- **Where:** `routes/auth.ts:63-141`, `routes/portal.ts:40-87`, `routes/api/cost-preset.routes.ts:75,113,150`, `middleware/validate.ts`.
- **Problem:** All POST/PUT/DELETE rely solely on the HTTPOnly session cookie; no token, no `X-CSRF-Token` check.
- **Impact:** A cross-site form can forge appointment create/delete, patient edits, settings changes (browser auto-attaches `shwan.sid`). `SameSite=lax` mitigates → High not Critical, but insufficient for older browsers / GET-triggered side-effects.
- **Fix:** CSRF token minted on session creation, required header on mutations, injected via `core/http.ts`. Suggested pkg: `csrf-csrf` (double-submit) or `tiny-csrf`.
- **Done:** _(pending)_

#### [ ] H3 — Raw fetches omit `credentials`, dropping the session cookie on mutations
- **Where:** `AddPatientForm.tsx:113-116`, `AppointmentCalendar.tsx:253-254`, `CalendarTimesSettings.tsx:267-270`, +130 raw mutation sites.
- **Problem:** Bare `fetch()` without `credentials:'same-origin'` doesn't send `shwan.sid` → backend sees empty `req.session.userId` → 401, with no FE 401 handler.
- **Impact:** State-changing ops can 401 with no feedback/redirect.
- **Fix:** Subsumed by H1's fix; until then audit every mutation `fetch` for `credentials`.
- **Done:** _(pending)_

#### [ ] H4 — ~80% of GET routes return raw data, not `sendSuccess`
- **Where:** `lookup.routes.ts:31,45,59,73,87,101`, `appointment.routes.ts:112,140,171,303,635`, `patient.routes.ts:184,212,241,276,318,834`, `expense.routes.ts:118,138,162,291`, `cost-preset.routes.ts:63`, `health.routes.ts:40`, `payment.routes.ts:163`, `visit.routes.ts:131-132`.
- **Problem:** Three live response shapes: `{success,data,timestamp}` envelope, bare array/object, and custom domain shapes.
- **Impact:** Generic response handling is impossible; a query that breaks and returns `null`/`[]` is delivered as valid because `response.ok===true` and nobody checks `success`.
- **Fix:** Standardize every route on `sendSuccess(res, data)` / `sendError`. **BE-side keystone**, pairs with H1.
- **Done:** _(pending)_

#### [x] H5 — Appointment payload mixes PascalCase + snake_case; `HasVisit` asymmetric
- **Where:** `services/database/queries/appointment-queries.ts:282-291` (`allAppointments`) vs `297-312` (`checkedInAppointments`); FE `appointments/AppointmentCard.tsx:6-26`.
- **Problem:** `checkedInAppointments` carries `appointment_id, person_id, app_detail` (snake) **plus** `PresentTime, SeatedTime, DismissedTime, IsOrthoVisit, HasVisit` (Pascal); `allAppointments` omits `HasVisit` entirely.
- **Impact:** Any case-normalization pass silently breaks the Pascal fields; callers can't rely on `HasVisit` in `allAppointments`.
- **Fix:** Rename to `present_time/seated_time/dismissed_time/is_ortho_visit/has_visit`; project `has_visit` in **both** result sets; update the `DailyAppointment` type.
- **Done:** _2026-06-04._ Renamed all five Pascal fields → snake_case in `checkedInAppointments` and projected `has_visit` in `allAppointments` too (`getDailyAppointmentsOptimized`). Updated the FE `DailyAppointment` interface + all reads in `AppointmentCard.tsx` (lines 109-111 state times, 149-151 undo flags, 272-278 visit-notes badge) and the stale `AppointmentsList.tsx` comment. The function is `getDailyAppointmentsOptimized` (not `getDailyAppointments`); backend result sets are loosely typed `Record<string,unknown>[]`, so `AppointmentCard.tsx` was the sole consumer (verified by repo-wide grep). The separate `/api/getWebApps` (`AppointmentRow` / `services/appointment.ts`) keeps its own `HasVisit` — out of scope. Typecheck clean.

#### [ ] H6 — Photo-editor `/prepare` returns 3 un-enveloped custom shapes
- **Where:** `routes/api/photo-editor.routes.ts:174-179` (`{success:false, needsName:true, message}`), `206-214` (`{success:false, conflict:true, conflictType,...}`), `234` (`{success:true, tp_code}`); FE `PhotoSessionDialog.tsx:139-167` vs `api.types.ts:128-134`.
- **Problem:** FE branches on `conflict` vs `needsName` vs `tp_code`; a new outcome won't be type-caught.
- **Fix:** Return `ApiResponse<PhotoPrepareResult>` where `PhotoPrepareResult` is a discriminated union `{conflict:true,...} | {needsName:true,...} | {tp_code:number}`.
- **Done:** _(pending)_

#### [x] H7 — FE date day-shift hazard: `new Date(str).toISOString().split('T')[0]` 🐞 user-visible
- **Where:** `NewVisitComponent.tsx:150`, `EditPatientComponent.tsx:194`, `NewWorkComponent.tsx:~213-218` (start_date/debond_date/f_photo_date/i_photo_date/notes_date), `LookupEditorModal.tsx`, `EditAppointmentForm.tsx:119`.
- **Problem:** In clinic UTC+3, `toISOString()` re-converts to UTC; a bare `'YYYY-MM-DD'` fed to the `Date` constructor is read as UTC midnight.
- **Impact:** Dates render **one day early** (DOB, visit, payment, work-status dates).
- **Fix:** Mechanical replace with the existing `formatISODate(...)` from `public/js/core/utils.ts` (handles both date-only and full-ISO via local getters).
- **Done:** _2026-06-04._ Replaced the hazardous pattern in all real sites: `NewVisitComponent.tsx:150` (visit_date), `EditPatientComponent.tsx:194` (date_of_birth), `NewWorkComponent.tsx` (discount/start/debond/f_photo/i_photo/notes dates — 6 sites), `LookupEditorModal.tsx:297-303` (date cell renderer, added the `formatISODate` import). **`EditAppointmentForm.tsx:119` was a false positive** — it already uses local getters (`getFullYear/getMonth/getDate`), not `toISOString`, so no day-shift; left unchanged. Typecheck clean.

#### [x] H8 — Chair-display latest-visit date never renders 🐞 user-visible *(independently re-confirmed)*
- **Where:** server `services/messaging/chair-payload-builder.ts:55-69` → `services/database/queries/visit-queries.ts:281` returns `{ visit_date, Summary }`; FE `routes/ChairDisplay.tsx:11-14` interface `LatestVisit` expects `VisitDate`, read at `:150-158`.
- **Problem:** Field-name casing mismatch — server `visit_date` vs FE `VisitDate`.
- **Impact:** `patient.latestVisit.VisitDate` is always `undefined` → the kiosk visit date never shows.
- **Fix:** Alias `visit_date as VisitDate` in the payload builder (keeps FE consistent with the snake_case sweep) **or** rename the FE field to `visit_date`.
- **Done:** _2026-06-04._ Chose the FE rename (consistent with the snake_case sweep — aliasing back to Pascal would fight it). `ChairDisplay.tsx`: `LatestVisit.VisitDate` → `visit_date` and the read at `:151`. The payload builder already returns `visit_date`, so no server change needed. Typecheck clean.

#### [ ] H9 — Some hand-rolled 400s omit `success:false`
- **Where:** custom 400s near `patient.routes.ts:1054-1062`; contrast the correct `ErrorResponses`-based 409/503 at `cost-preset.routes.ts:80-93`, `lookup-admin.routes.ts:135`, `aligner.routes.ts` (503).
- **Problem:** Some custom 400 responses send only `{error, code, details}` — no `success:false` — breaking the `ApiErrorResponse` contract.
- **Impact:** FE relying on `data.success` gets `undefined` on those 400s.
- **Fix:** Route every error through `ErrorResponses.*`; never hand-roll a 400 without `success:false` + `timestamp`.
- **Done:** _(pending)_

#### [~] H10 — ~100 of ~110 mutation endpoints have no Zod `validate()`
- **Where:** zero in `aligner` (24 mutations), `patient` (13), `appointment` (6), `payment` (3), `expense` (3), `stand` (11), `settings` (5), `file-explorer` (5), `lookup-admin`, `employee`, `cost-preset`. Only `photo-editor.routes.ts` + part of `work.routes.ts` validate.
- **Sub-issues:**
  - Unvalidated `parseInt` route params (NaN matches wrong/zero rows): `aligner.routes.ts:1026,1077`, `cost-preset.routes.ts:115`, `expense.routes.ts:160`.
  - Query coercion silently `NaN`: `expense.routes.ts:98-105` (`limit='abc'`).
  - Body over-posting (no `.strict()`): `appointment.routes.ts:201-267`, `patient.routes.ts:960-1072`, `work.routes.ts:670-741`.
  - Weak date input: `patient.routes.ts:362` accepts `2024-02-30`; **zero** date validation in `payment.routes.ts:313+,368+` and `expense.routes.ts:177+`.
- **Impact:** Arbitrary payloads accepted; business errors escalate to 500 instead of 400; invalid dates stored.
- **Fix:** `validate({body,params,query})` on all mutations; `z.coerce.number().int()` for IDs/query; `.strict()` bodies; shared date schema `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)`.
- **Done:** _Starter done 2026-06-04._ Added `Number.isInteger(id) && id > 0` guards (with `ErrorResponses.badRequest`) on the 4 unguarded `parseInt` ID params: `aligner.routes.ts:1026` (upload-pdf setId), `:1077` (delete pdf setId), `cost-preset.routes.ts:115` (preset id), `expense.routes.ts:160` (categoryId); also added the missing radix `10` to each. **Full fix still pending** — the broad `validate({body,params,query})` rollout + `.strict()` bodies + shared date schema across ~100 mutations (Phase 5).

#### [ ] H11 — No response validation on staff endpoints (only Portal validates)
- **Where:** `public/js/portal/portal.schemas.ts` validates every portal response; staff has no equivalent (`GridComponent.tsx:206`, `EditPatientComponent.tsx:159-163` assume shape).
- **Problem:** A renamed field or backend bug silently corrupts state; the portal would catch it, staff won't.
- **Fix:** Zod (or generated) schemas at the staff fetch boundary for at least list/search/appointment/payment endpoints.
- **Done:** _(pending)_

### Medium

#### [~] M1 — Error `code` split: top-level vs `details.code` (breaks conflict UX) *(independently re-confirmed)*
- **Where:** patient conflicts send `code` at **root** (`patient.routes.ts:409,421,1059`); appointment/work nest it via `ErrorResponses.conflict(res, msg, error.details)` → `details.code` (`appointment.routes.ts:388`). FE `AppointmentForm.tsx:226-233` checks `errorData.code` (root) for `HOLIDAY_CONFLICT`/`APPOINTMENT_CONFLICT`.
- **Impact:** Those codes arrive at `errorData.details.code` → the friendly holiday/conflict messages are skipped (falls through to a generic error — degraded, not silent). `AddPatientForm.tsx:411` reads root `result.code` and works only because the patient route is the outlier.
- **Fix:** Pick one location. Recommended: `sendError` gains an optional top-level `code` param; route everything through it; FE reads `response.code`. Update `api.types.ts:34,48`. **Quick interim fix:** make `AppointmentForm.tsx:226,233` read `errorData.details?.code`.
- **Done:** _Interim done 2026-06-04._ `AppointmentForm.tsx` now reads `errorData.code ?? errorData.details?.code` (handles both the patient-route root `code` and the appointment/work-route nested `details.code`); added `code?` to the local `ApiErrorResponse.details` type. Verified the other conflict-code readers are already correct for their routes: `useAppointments.ts:149` reads `details.code` (appointment route ✓), `AddPatientForm.tsx:195` + `EditPatientComponent.tsx:397` read root `code` (patient route ✓), and `EditAppointmentForm.tsx` has no conflict handling. **Full fix still pending** (unify the BE `code` location in `sendError`/`ErrorResponses` — Phase 2).

#### [x] M2 — `timestamp` sent by backend, absent from FE types
- **Where:** `utils/error-response.ts:52,88` always emit `timestamp`; `public/js/types/api.types.ts:29-36` omits it.
- **Fix:** Add `timestamp?: string` to `ApiResponse`/`ApiErrorResponse` (becomes non-optional once H4 lands).
- **Done:** _2026-06-04._ Added `timestamp?: string` (JSDoc'd) to both `ApiResponse` and `ApiErrorResponse` in `api.types.ts`. Kept optional for now; flip to required once H4 standardizes every route on the envelope. Typecheck clean.

#### [ ] M3 — Phantom `code` field & date-format ambiguity in FE types
- **Where:** `api.types.ts:34,48` declare `code?: string` as if universal; date fields (e.g. `FileEntry.modified:231`) typed as bare `string` with no ISO-vs-`YYYY-MM-DD` distinction.
- **Fix:** After M1, keep `code` only where real; add JSDoc / branded `DateOnly` vs ISO aliases.
- **Done:** _(pending)_

#### [x] M4 — `credentials:'include'` used inconsistently instead of `'same-origin'`
- **Where:** `AdminUserManagement.tsx:62-63,84-85`, `GlobalStateContext.tsx:152`, `hooks/useWhatsAppAuth.ts:128,142,258,284,307`, `useWhatsAppWebSocket.ts:102`.
- **Impact:** Both work same-origin, but `include` widens cookie scope and muddies audits.
- **Fix:** Standardize on `'same-origin'` (or migrate to `core/http.ts`); document any flow that genuinely needs `include`.
- **Done:** _2026-06-04._ Swapped all 21 `credentials: 'include'` → `'same-origin'` across 10 files (the report's list was incomplete — also found `whatsapp-api-client.ts`, `AlertModal.tsx`, `WhatsAppAuth.tsx`, `SettingsComponent.tsx`, `SupabaseStatusSettings.tsx`, `UserManagement.tsx`). All targets are relative same-origin `/api/...` URLs, so behavior is unchanged. ⚠️ **Tooling note:** the first scripted pass used PS 5.1 `Get-Content -Raw` + `Set-Content -Encoding utf8`, which mis-decoded UTF-8 as Windows-1252 (corrupting `→`/`—`) **and** added a BOM; caught via `git diff`, reverted all 10, and redid with `[System.IO.File]::ReadAllText(p, UTF8)` + `WriteAllText` (no-BOM). Final diff verified **100% clean**: `git diff --unified=0` shows 42 changed lines (21+/21−), **all** credential lines, 0 others, and no BOM on any file. Typecheck + eslint clean.

#### [ ] M5 — Messaging routes spread query results into responses (non-conformant shape)
- **Where:** `routes/api/messaging.routes.ts:95-102` (`/status/:date` spreads `...result`, no `success`/`timestamp`) vs correct envelopes at `150-153`, `176-181`.
- **Fix:** Wrap in `sendSuccess`; never spread raw query results.
- **Done:** _(pending)_

#### [ ] M6 — Patient `/info` mixes PascalCase lookup labels with snake_case core
- **Where:** `patient-queries.ts:216-221,247-283` (`g.gender as GenderDisplay`, `a.zone as Address`, `r.referral as ReferralSource`, `AlertType` alongside `patient_name`); `/patients/:id` (`getPatientById`) returns snake-only. FE `PatientService.ts:34-38` documents the drift.
- **Impact:** Two divergent shapes for "a patient."
- **Fix:** Rename lookup aliases to snake (`gender_display`, `address_name`, `referral_source`, `patient_type_name`, `tag_name`); align the two endpoints.
- **Done:** _(pending)_

#### [ ] M7 — Loaders/components lack AbortController; 5-min cache races SSE
- **Where:** `loaders.ts:129,23`, `AppointmentCalendar.tsx`; `hooks/useWebSocketSync.ts:6` invalidates `daily-appointments:${date}` cache keys that are **never populated** → SSE invalidation is a no-op for appointments.
- **Fix:** AbortController on unmount; wire SSE events to clear the right loader cache keys (or move to React Query `invalidateQueries`).
- **Done:** _(pending)_

#### [ ] M8 — `core/http.ts` has no timeout / no retry
- **Where:** `public/js/core/http.ts`.
- **Impact:** A `fetch()` can hang indefinitely; transient failures fail immediately.
- **Fix:** AbortController-based ~30s timeout; optional exponential-backoff retry for idempotent GETs (free with React Query).
- **Done:** _(pending)_

### Low / Nit

#### [ ] L3 — Aligner routes mounted twice
- **Where:** `routes/api/index.ts:94-95` (serves `/aligner/*` and `/aligner-doctors`); FE calls both inconsistently.
- **Fix:** Consolidate to one canonical path.
- **Done:** _(pending)_

#### [x] L4 — Dead duplicate expense root-mount  ⚠️ *report had the dead line backwards*
- **Where:** `routes/api/index.ts:99-100` — all 8 routes are already `/expenses`-prefixed; line 100's root mount is dead/duplicate with a misleading comment.
- **Fix:** Remove line 100 + fix the comment. **Cheap.**
- **Done:** _2026-06-04._ ⚠️ **The report's diagnosis was inverted.** All 8 expense routes define their own internal `/expenses*` prefix, so the **root mount (line 100)** produces the correct `/api/expenses*` (which the FE calls — verified in `hooks/useExpenses.ts`), while the **`/expenses` mount (line 99)** produces the dead `/api/expenses/expenses`. Removing line 100 as written would have **broken all expense functionality in production.** Removed the actually-dead line 99 instead and kept line 100, with a corrected comment. (This is what first proved the report is not 100% accurate.)

#### [ ] L5 — Pre-auth route boundaries under-documented
- **Where:** `routes/api/index.ts:48-49`; `lookup.routes.ts` unlabeled public; `cost-preset.routes.ts` mutations rely on inline `authenticate/authorize` at `:75,113,150`.
- **Fix:** Add `@public`/`@protected` JSDoc; split GET-public vs mutation-protected.
- **Done:** _(pending)_

#### [-] L1 — `TotalPaid` PascalCase aggregate
- `work-queries.ts:281`, `payment-queries.ts:111`; FE `NewWorkComponent.tsx:87`, `PaymentModal.tsx:16`. Verifier: consistent with other aliased fields (`WorkStatus`, `Keyword1-5`) — **alias convention, not a contract breach.** Optional rename to `total_paid` for uniformity only.

#### [-] L2 — `app_date` latent 3h-early bug
- `appointment-queries.ts` `getDailyAppointments`; `types/db.d.ts:131`. Raw `app_date` serializes ISO-`Z` and *would* display 3h early, but FE shows the pre-formatted `apptime` → **latent, not active.** Fix opportunistically when touched (send `app_date`+`app_time` split).

#### [-] L6 — Portal vs staff session cookie confusion
- `index.ts:204-224`, `routes/portal.ts:14`, `middleware/patientAuth.ts:15-28`. Architecturally separated (separate SPAs, no shared imports) — low risk. Optional: add an import-boundary lint + doc.

#### [-] Nits (no action / intentional)
- Portal schemas separate from `api.types.ts` — **intentional** untrusted-input boundary; schemas currently match BE. Add JSDoc cross-links only.
- `null` vs `undefined` omission (`error-response.ts:86` omits `data` when null/undefined) — documentation gap only.
- SSE reconnect jitter (`sse-broadcaster.ts:132-135`, `sse-whatsapp.ts:87`) — per verifier the per-client jitter **does** prevent thundering herd. Comment-clarity nit only.
- ChairDisplay direct `EventSource` (`ChairDisplay.tsx:71`) — **intentional** standalone kiosk; already implements visibility/bfcache recovery inline (`:103-121`).

#### Confirmed healthy (no action)
Numeric/money serialization (`kysely.ts:27-28` → JS `number`), boolean (bit→boolean), `date`→`'YYYY-MM-DD'` string, all HTTP method/path pairs, no hardcoded URLs, SSE event naming.

---

## 4. Quick wins (<1hr each) — do first

- [x] Add `timestamp?: string` to `ApiResponse`/`ApiErrorResponse` (`api.types.ts:29-50`) — **M2**
- [x] Fix `AppointmentForm.tsx:226,233` to read `errorData.details?.code` so holiday/conflict UX works again — **M1 interim** (used `code ?? details?.code`)
- [x] ~~Alias `visit_date as VisitDate`~~ → renamed FE `LatestVisit.VisitDate` → `visit_date` (builder already returns `visit_date`) so the chair-display date renders — **H8** 🐞
- [x] Replace `new Date(x).toISOString().split('T')[0]` with `formatISODate(x)` in the real sites (`EditAppointmentForm:119` was a false positive) — **H7** 🐞
- [x] Project `has_visit` in `allAppointments` too (`appointment-queries.ts:282`) — **H5** (did the full snake_case rename)
- [x] ~~Delete root-mount line 100~~ → removed the **actually-dead line 99** (`/expenses` mount); line 100 root-mount is the live one — **L4** ⚠️ *report inverted*
- [x] Add `credentials:'same-origin'` in the `include` call sites (21 across 10 files) — **M4**
- [x] Add NaN guards on the 4 unguarded `parseInt` ID params (`aligner.routes.ts:1026,1077`, `cost-preset.routes.ts:115`, `expense.routes.ts:160`) — **H10 starter, security**

---

## 5. New findings (discovered during remediation)

> Append here as we work. Format: `### N1 — <title>` with the same fields as §3, plus the date/session noted.

### N1 — L4 diagnosis was inverted in the report (2026-06-04)
- The report said line 100 (root mount) was the dead duplicate. It is the opposite: expense routes self-prefix with `/expenses`, so the root mount is the **live** one (`/api/expenses*`) and the `/expenses` mount (line 99) is the dead `/api/expenses/expenses`. Following the report verbatim would have broken expenses in production. **Lesson: verify every route-mount/deletion against the actual prefix + the FE call site before acting.** Fixed correctly; see L4.

### N2 — H7 included a false positive (2026-06-04)
- `EditAppointmentForm.tsx:119` was listed as a day-shift site but already extracts the date with local getters (`getFullYear/getMonth/getDate`), not `toISOString()`. No bug; left as-is. Net real H7 sites: 4 files (NewVisit, EditPatient, NewWork ×6, LookupEditorModal).

### N3 — M4's `include` list was incomplete (2026-06-04)
- The report named ~6 sites; a fresh grep found **21 occurrences across 10 files** (added `whatsapp-api-client.ts`, `AlertModal.tsx`, `WhatsAppAuth.tsx`, `SettingsComponent.tsx`, `SupabaseStatusSettings.tsx`, `UserManagement.tsx`). All fixed.

### N4 — Tooling hazard: PS 5.1 bulk text edits corrupt UTF-8 + add BOM (2026-06-04)
- `Get-Content -Raw` / `Set-Content -Encoding utf8` in Windows PowerShell 5.1 mis-decodes UTF-8 source as Windows-1252 (mangles `→`, `—`, em-dashes) **and** writes a UTF-8 BOM. For any scripted multi-file string replacement, use `[System.IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)` + `WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`, and always `git diff` to confirm only intended lines changed.

---

## 6. Progress log

> One line per work session. Newest at top. Note the date, what items moved, commits, and any
> follow-ups created.

- **2026-06-04 (session 2)** — Cleared all 8 quick wins (§4) + the full H5 rename. **Done:** H5 (full), H7, H8, M2, M4 → `[x]`; L4 → `[x]` (corrected report's inverted diagnosis); M1 + H10 → `[~]` (interim/starter done, full pending). Verified every change against source per the "report not 100% accurate" caveat — surfaced 4 new findings (N1–N4): L4 inversion, H7 false positive, M4 incomplete list, and a PS-5.1 UTF-8/BOM corruption hazard (caught + fully recovered via git). `npm run typecheck:all` clean. **Next up (Phase 2):** H4 (envelope standardization) → unblocks the full M1/M2/M3; then H1/H3 keystone (route everything through `core/http.ts` + ESLint ban on bare `fetch`).
- **2026-06-04** — Audit completed (10-dimension, 83-agent multi-agent run; 70 confirmed findings). Tracker created. H8 and M1 independently re-confirmed against source. Nothing remediated yet.
