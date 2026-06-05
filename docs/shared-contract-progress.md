# Shared API Contract — Progress Tracker

> **Authoritative design / plan:** `/home/administrator/.claude/plans/make-a-comprehensive-well-distributed-codd.md`
> *(Plan title: "`shared/` API contract — end-to-end type safety for Tier-1 route groups".)*
> That plan is the **source of truth** for the design, decisions, and rationale. **This** file
> tracks *execution state* across sessions: what is done, what's next, and any new findings.

This is a **multi-session** task. At the end of every work session, update:
1. the **Status at a glance** table,
2. the relevant **Phase checklist**,
3. the **Findings & decisions log** (append-only, dated) with anything learned,
4. the **Verification log** (gate results),
5. the **Session log**.

---

## Goal (one-paragraph recap — see plan for full context)

The app has strong *per-segment* type safety but **no compile-time link across the network
boundary**. Build a single source of truth — `shared/contracts/*` — for each endpoint's request
**and** response shapes, authored as Zod, imported by **both** sides. Drift becomes a server
**compile error** *and* a client **fail-loud** runtime error. Roll out across the 5 highest-risk
groups (**payment, stand, work, patient, aligner**), foundation first, then one group per phase
behind a `typecheck:all` + `build` gate.

**Locked decisions (do not relitigate without the user):**
- **Server enforcement = compile-time typing + dev-only parse.** Payload typed to the contract
  (drift = build error); `schema.parse` runs only when `NODE_ENV !== 'production'` (zero prod CPU).
  Client *always* runtime-validates via `fetchJSON({ schema })`.
- **Each contract holds request + response.** The ~61 inline `validate()` request schemas **move**
  into the contract (mechanical relocation); response schemas are net-new.
- **No `#imports`/runtime alias resolver.** Backend imports `shared/` via relative `.js`; frontend
  via a new `@shared` Vite/tsconfig alias.
- **Schema tightness:** assert the container + stable identifiers; stay `z.looseObject({})` on
  long-tail optional row fields. Tighten per-row later, runtime-verified.

---

## Status at a glance

| Phase | Scope | Status | Gate (`typecheck:all` + `build`) |
|------:|-------|--------|----------------------------------|
| **0** | Foundation (`shared/validation.ts`, `shared/contracts/`, `sendData`, aliases, migrate 4 existing schemas, delete `api.schemas.ts`) | ✅ Done & gated | ✅ typecheck:all + build (client+server) + lint green — 2026-06-05 |
| **1** | payment (smallest Tier-1; reference conversion) | ✅ Done & gated | ✅ **final gate run 2026-06-05** (typecheck:all + build + lint green; runtime read smoke — see below) |
| **2** | stand (self-contained POS; N13 victim) | ✅ Done & gated | ✅ **final gate 2026-06-05**; runtime smoke ✅ (categories/items/low-stock/dashboard 200 — `timestampString`+`z.input` validated live) |
| **3** | work | ✅ Done & gated | ✅ **final gate 2026-06-05**; runtime smoke ✅ (getworktypes/getworkkeywords 200) |
| **4** | patient (tighten `search`) | ✅ Done & gated | ✅ **final gate 2026-06-05**; runtime smoke ✅ (search `q=92` → 200, **100 tightened rows** parsed) |
| **5** | aligner (largest; fold `aligner.types.ts`) | ✅ Done & gated | ✅ **final gate 2026-06-05**; runtime smoke ✅ (all 11 GET reads 200 on real data) |

Legend: ⬜ Not started · 🚧 In progress · ✅ Done & gated · ⚠️ Blocked/needs attention

### Wave 2 ("everything remaining") — plan `~/.claude/plans/continue-planing-pure-engelbart.md`

| Phase | Scope | Status | Gate |
|------:|-------|--------|------|
| **6** | lookup (Group B, 6 pre-auth GET dropdown reads) | ✅ Code + gated | ✅ part of the 6–10 gate (below) |
| **7** | appointment (Group A; extend contract, 10 endpoints) | ✅ Code + gated | ✅ |
| **8** | expense (Group A, financial) | ✅ Code + gated | ✅ |
| **9** | employee + staff (Group A + B) | ✅ Code + gated | ✅ |
| **10** | visit (Group A, clinical) | ✅ Code + gated | ✅ |
| **11** | settings + cost-preset (Group A + B) | ✅ Done & gated | ✅ part of the Wave-2 final gate (below) |
| **12** | file-explorer + photo-editor (Group A; exclude streams + /render) | ✅ Done & gated | ✅ |
| **13** | Group-B remainder (messaging, holiday, reports, video, media, utility, lookup-admin) | ✅ Done & gated | ✅ |
| **14** | ROOT migration (user-management, email-api, calendar) | ✅ Done & gated | ✅ |
| **15** | FINAL GATE (typecheck:all + build + lint + runtime read-smoke) | ✅ Done | ✅ **green 2026-06-05** |

**🎉 WAVE 2 COMPLETE (2026-06-05):** all 20 in-scope enveloped route files + the 3 root routes are
contracted. **Final gate green:** `npm run typecheck:all` ✅ (backend `tsc` + frontend `tsc -p
tsconfig.frontend.json`, both EXIT 0), `npm run build` ✅ (Vite client + `build:server`; all 14 new
Wave-2 contracts emitted to `dist-server/shared/contracts/`), `npm run lint` ✅ (0 errors; 2 pre-existing
`exhaustive-deps` warnings in aligner files, unrelated). **Runtime read-smoke** (NODE_ENV=development,
dev-parse active, port 3101) — every read across Phases 11–14 returned **200** on real DB data
(options/cost-presets/db-config, videos/categories, holidays, statistics, messaging status, files/
working-files/photo-dates, webceph photo-types, `/api/users`, calendar week/month/stats/available-slots/
month-availability, email/config). **Root-migration envelope verified live:** `/api/users` →
`{success,data:{users}}` and `/api/calendar/week` → `{success,data:{days,…,timeSlots}}` (funnel unwraps
`data` → consumer key access intact). Excluded `/api/email/test` confirmed still raw top-level. **Owed
before merge:** the write-path mutation runtime checks (same deferral as Wave 1).

**Phases 6–10 gate (2026-06-05):** `npm run typecheck:all` ✅ **green** (backend `tsc -p tsconfig.json`
EXIT 0 + frontend `tsc -p tsconfig.frontend.json` EXIT 0). Unlike Wave-1's deferred gate, this ran clean
first try — the `sendData` `z.input` fix is already in place and the interface→type flips were applied
proactively. `build`/`lint` + runtime smoke still owed (deferred to the Wave-2 final gate, Phase 15).

**🎉 ROLLOUT COMPLETE (2026-06-05):** all 5 Tier-1 groups + foundation are contracted, and the
**deferred final gate has been run green** — `npm run typecheck:all` ✅ (backend `tsc` + frontend
`tsc -p tsconfig.frontend.json`), `npm run build` ✅ (Vite client bundle + `build:server` exit=0,
all 6 contracts emitted to `dist-server/shared/contracts/`), `npm run lint` ✅ (0 errors; 2 pre-existing
`exhaustive-deps` warnings unrelated to this work). Runtime read-smoke across all phases passed (see
Verification log). **Still owed before merge** (per the deferral): the full critical-business
*mutation* runtime checks (add-invoice / POS sale / work CRUD / patient CRUD / aligner set+batch+payment
create-update-delete) — the read path + `sendData` dev-parse are verified, the write path is not yet
exercised end-to-end on real data.

---

## Tier completion (Wave 3 — "100% rollout")

> **Plan:** `~/.claude/plans/here-is-a-draft-toasty-shannon.md` — *"Finish the shared-contract rollout
> to 100% — client wiring, response modeling, params/query, lock-in."* Delivery is **plan-only / user-driven
> sessions**: Phase 0 (this scaffold) landed; Phases 1–5 each run in their own gated session.

The body tier is done (zero `interface *Body` in `routes/`). Three tiers remain open across the full
request+response surface, now measured by `npm run contracts:check` (`scripts/contracts-dod.mjs`,
report-only until Phase 5 flips `STRICT`):

| Tier | DoD | Phase-0 baseline (2026-06-05) | Target |
|------|-----|-------------------------------|--------|
| **D1** — hand-written request interfaces (`*Body\|*Params\|*Query\|*Filters`) in `routes/` | grep = 0 | **33** | 0 |
| **D2** — loose response markers (`z.unknown()` / `anyArray` / `z.array(z.unknown`) in `shared/contracts/` | allowlist only | **103** lines | allowlist only |
| **D3** — staff-app reads without a client `{ schema }` guard | `require-schema-on-reads` ESLint passes | **178** read call sites · **120** `schema:` usages · **~58** unguarded (heuristic) | every read guarded |

**Phases:** 1 = client `{schema}` on reads · 2 = client `{schema}` on meaningful mutations · 3 = full
response modeling + per-read runtime verify (heaviest: aligner 16 / patient 10 / file-explorer·expense 9 /
video·reports 7 / calendar 6) · 4 = full params/query fold (delete the 33 D1 interfaces) · 5 = lock-in
(extend ESLint `routes/**` selector to `*Params|*Query|*Filters`; add `require-schema-on-reads`; flip
`STRICT`; `npm run gate`; net-new `.github/workflows/gate.yml`).

**Session 9 — 2026-06-05 — Phase 0 (measurement scaffold).** Added `scripts/contracts-dod.mjs` +
`npm run contracts:check` (report-only, exits 0; `STRICT=1`/`--strict` will fail on regression past the
baselines above — for Phase 5). `scripts/**` is eslint-ignored so the script isn't linted. Baselines
recorded above. No ESLint rule / CI workflow added yet (deferred to Phase 5 so they don't break before the
work lands). **Next: Phase 1 (client `{schema}` on reads).**

**Session 10 — 2026-06-05 — Phase 1 (client `{schema}` on reads) — COMPLETE.** Wired the client
fail-loud guard on every **contracted** staff-app read; **D3 unguarded ~58 → ~3** (the by-design raw set).
Gate green after each batch: `typecheck:all` (backend + frontend EXIT 0), `build` (client + `build:server`
EXIT 0), `lint` (0 errors; the 2 pre-existing aligner `exhaustive-deps` warnings). **No runtime smoke** —
no PostgreSQL in the fresh container; safe because adding `{schema}` against schemas the server already
dev-parsed on real data (prior sessions) is a no-op guard that only fail-louds on genuine drift.
- **Convention:** namespace imports (`import * as <group>Contract`), explicit generic kept + `{ schema }`
  passed (the option does NOT infer the generic). 4 committed batches: patient-cluster (25 reads) →
  lookup/file/appointment/loaders → auth-me/templates → whatsapp/raw-docs.
- **2 new flat reads authored** (response-only, server unchanged): `auth.contract.me`
  (`looseObject{success,user}`) and `whatsapp.contract.initialState`/`qr` (`looseObject{}` — realtime
  fields preserved, deliberately not tightened). Also `template.contract.getTemplates`/`documentTypes`
  (`anyArray`)/`getTemplate` (`z.unknown`).
- **By-design RAW reads (no client schema; get `require-schema-on-reads` inline-disables in Phase 5):**
  `/api/diagnosis/:workId` (literal-null signal), `/api/email/test` (raw semantic-success at 200),
  `/api/wa/initialize` (fire-and-forget), `/api/auth/verify` (session ping),
  `/api/sync/supabase-status` (out-of-surface sync read). Each carries an inline comment.
- **`public/js/services/appointment.ts` is DEAD CODE** (not imported anywhere; `/getTimePointImgs` &
  `/getLatestVisitsSum` no longer exist as routes) — left untouched; **delete or disable in Phase 5**.
- **Pre-existing latent bug noted (NOT fixed — out of scope):** `templateListLoader` types `/api/templates`
  as `{ templates? }` but the route returns the bare array (funnel-unwrapped) → `.templates` is always
  undefined. The wired `getTemplates` (`anyArray`) guard is the correct assertion; fix the generic later.

**Next: Phase 2 (client `{schema}` on meaningful mutations).**

---

## Phase 0 — Foundation

**Must be green before any group phase.** Source: plan §"Phase 0 — Foundation". **✅ COMPLETE (2026-06-05).**

- [x] 1. `shared/validation.ts` — moved full body of `middleware/validation-schemas.ts` here verbatim.
- [x] 1b. Replaced `middleware/validation-schemas.ts` with a barrel: `export * from '../shared/validation.js';`
      (all **10** existing import sites untouched; barrel compiles + resolves in `dist-server`).
- [x] 2. `shared/contracts/` — migrated the existing 4 client schemas into object-per-endpoint shape:
      `appointment.contract.ts` (`dailyAppointments`), `patient.contract.ts` (`patientPhones`, `patientSearch`),
      `payment.contract.ts` (`paymentHistory`). **Response-only** for now.
- [x] 3. `utils/error-response.ts` — added `sendData<S extends ZodType>(res, schema, data, message?, statusCode?)`,
      reusing `sendSuccess`; dev-only `schema.parse`. Also added to the default export. **Not called yet**
      (first used in Phase 1).
- [x] 4. `vite.config.js` — added `'@shared': resolve(projectRoot, 'shared')` to `resolve.alias`.
- [x] 5. `tsconfig.json` — added `"shared/**/*.ts"` to `include` (flows to `tsconfig.build.json`).
- [x] 6. `tsconfig.frontend.json` — added `"shared/**/*.ts"` to `include` **and** `"@shared/*": ["./shared/*"]` to `paths`.
- [x] 7. Updated the **3 consumers** to import from `@shared/contracts/*`, then **deleted** `public/js/core/api.schemas.ts`:
      - `public/js/router/loaders.ts` → `dailyAppointments.response`, `patientPhones.response`, `patientSearch.response`
      - `public/js/hooks/useAppointments.ts` → `dailyAppointments.response` + `DailyAppointmentsResponse` type
      - `public/js/components/react/WorkComponent.tsx` → `paymentHistoryContract.response` (**aliased** — see below)

**Gate result:** `npm run typecheck:all` ✅ · `npm run build` (client + server, `build:server exit=0`,
`dist-server/shared/*` emitted) ✅ · `npm run lint` (touched files) ✅.

**Contract naming convention adopted (this repo):** one exported `const <action> = { body?, params?,
query?, response } as const` per endpoint; each file also exports `z.infer` response types
(`DailyAppointmentsResponse`, `PatientSearchResponse`, …). Action names are natural noun-phrases
(`dailyAppointments`, `patientPhones`, `patientSearch`, `paymentHistory`).
**Collision rule (learned in Phase 0):** when an action name collides with a local identifier in a
consumer, **alias the named import** with a `…Contract` suffix — e.g. WorkComponent already has a
`paymentHistory` state var, so it imports `paymentHistory as paymentHistoryContract`. A real collision
is compiler-caught (the gate fails), so this can't silently break, but alias proactively for clarity.

---

## Phase 1 — payment

Source: plan §"Per-endpoint recipe" + representative files. 3 `validate()` schemas.
- Route: `routes/api/payment.routes.ts` ↔ consumers `WorkComponent.tsx` (history, `deleteInvoice`),
  `PaymentModal.tsx` (work-for-receipt, exchange-rate, addInvoice), `ExchangeRatesSettings.tsx`.
- **Note:** `POST /api/aligner/payments` lives in `aligner.routes.ts` → it belongs in
  `aligner.contract.ts` (Phase 5), **not** payment. (The plan's mention of `PatientSets.tsx` under payment
  was that aligner-payment call — verified, NOT a payment-group consumer.)
- [x] **Enumerated 9 payment endpoints** (route file): `getpaymenthistory` (GET, query workId),
      `getworkforreceipt/:workId` (GET), `getActiveWorkForInvoice` (GET, **no FE consumer**),
      `getCurrentExchangeRate` (GET), `getExchangeRateForDate` (GET), `exchange-rates` (GET),
      `updateExchangeRateForDate` (POST, body), `addInvoice` (POST, body), `deleteInvoice/:invoiceId` (DELETE, params).
      The 3 `validate()` schemas = `updateExchangeRate.body`, `addInvoice.body`, `deleteInvoice.params`.
- [x] Contracts authored (`shared/contracts/payment.contract.ts`): 2 request bodies **fully enumerated** via
      3-place trace → `z.infer` SSoT (`UpdateExchangeRateBody`, `AddInvoiceBody`; route interfaces deleted);
      9 responses net-new. Bodies default `z.looseObject`. GETs kept response-only (no new query `validate()`
      — avoids changing the existing manual missing-param 400/404 semantics this phase).
- [x] Backend route converted: all 9 handlers `sendSuccess → sendData(res, <a>.response, …)`; the 2 POST
      bodies + DELETE params reference the contract; handlers typed `Request<…, <Action>Body>`; the inline
      `exchangeRateBodySchema`/`addInvoiceBodySchema` + `ExchangeRateForDateBody`/`AddInvoiceBody` interfaces
      and the `z`/`idParams`/`intId`/`dateString` imports removed.
- [x] Frontend consumers converted (`{ schema: <a>.response }` + contract-inferred types):
      `WorkComponent.tsx` (history → `PaymentHistoryResponse`, deleted local `Payment` interface; deleteInvoice
      schema), `PaymentModal.tsx` (work-for-receipt schema kept local `WorkData`; `ExchangeRateForDateResponse`;
      updateExchangeRate schema; `AddInvoiceResponse`), `ExchangeRatesSettings.tsx`
      (`CurrentExchangeRateResponse`, `ExchangeRatesResponse`, updateExchangeRate schema).
- [ ] **Gate + runtime verification DEFERRED** (per user "don't type-check until all phases done" + "stop after
      phase 1"). Done instead: isolated `tsc` probe of the exact schemas + (now `type`-alias) data sources ✅.
      **Still owed before merge:** `typecheck:all` + `build` + `lint`, and runtime add-invoice / set-exchange-rate /
      delete-invoice flows (no 400 on valid payload; persisted row keeps every field/value; no fail-loud on real data).

## Phase 2 — stand

10 `validate()`. Route `routes/api/stand.routes.ts` ↔ `public/js/hooks/useStand.ts`
(~20 `core/http` calls) + 2 direct consumers (`ItemFormModal.tsx`, `POSItemSearch.tsx`). N13 victim screen.
**✅ Code complete (2026-06-05) — gate deferred.**

- [x] **New shared primitive `timestampString`** (`shared/validation.ts`): `z.union([z.string(),
      z.date().transform(d=>d.toISOString())])` for PG `timestamp` (Date-on-server / string-on-client)
      columns. Validates on BOTH the server dev-parse (`sendData`) and the client (`fetchJSON`); output
      type is `string`. (Phase 1's payment had only `date` columns — string both sides — so never hit this.)
- [x] **Contract authored** (`shared/contracts/stand.contract.ts`): 22 endpoints. Shared response row
      schemas (`standCategoryRow`/`standItemRow`/`standSaleFields`+`standSaleRow`/`standSaleItemRow`/
      `standSaleWithItemsRow`/`standMovementRow`/`salesSummaryRow`/`topItemRow`) → `z.infer` row types
      (`StandItem`, `StandSale`, …). 5 enumerated bodies (`createCategory`, `scanVision`, `createItem`,
      `restock`, `adjust`), 7 param sets, `createSale` **response-only** (cart owned by the service).
- [x] **Query row interfaces → `type` aliases** (`stand-queries.ts`): `StandCategoryRow`, `StandItemRow`,
      `StandSaleRow`, `StandSaleItemRow`, `StandMovementRow`, `SalesSummaryRow`, `TopItemRow` (the
      looseObject index-signature rule — they feed `sendData`). `DashboardKPIs` stays `interface`
      (its response is a closed `z.object`, no index sig).
- [x] **Route converted** (`stand.routes.ts`): all payload handlers `sendSuccess → sendData(res, <a>.response, …)`;
      void handlers keep `sendSuccess(res, null)`; the 10 `validate()` now reference contract `body`/`params`;
      inline `stand*BodySchema` + the `z`/`idParams` imports removed. `scanVision`/`createCategory` handlers
      typed with the contract body; `createItem`/`restock`/`adjust` left untyped-body (see TS2367 finding).
- [x] **Consumers converted**: `useStand.ts` (response interfaces → contract re-exports; `{ schema }` added to
      13 typed read/response calls; request/filter types kept local), `ItemFormModal.tsx` (local
      `VisionScanResult` → contract type + `{ schema }`), `POSItemSearch.tsx` (`{ schema }`).
- [ ] **Gate + runtime DEFERRED** (per user). Owed before merge: `typecheck:all` + `build` + `lint`, and the
      runtime POS critical-business checks (ring up a sale, restock, adjust, void) — no false 400/fail-loud,
      persisted rows intact.

## Phase 3 — work

11 `validate()`. Route `routes/api/work.routes.ts` ↔ 5 consumers. **✅ Code complete (2026-06-05) — gate deferred.**

- [x] **Contract authored** (`shared/contracts/work.contract.ts`): 19 endpoints. **Minimal responses**
      (container + stable id `work_id`/`id`/`workId`, loose long-tail) — see the scope decision below.
      Bodies: the 2 small ones (`workStatus` shared by finish/discontinue/reactivate; `deleteWork`) → `z.infer`
      SSoT; the large service-bound ones (`addWork`/`addWorkWithInvoice`/`updateWork`/`addWorkDetail`/
      `workDetailId`/`diagnosis`) keep the EXISTING loose guard relocated verbatim (the documented caveat —
      `WorkService` owns full validation; full enumeration of 22+-field financial/clinical bodies deferred).
- [x] **Query row `interface`→`type`** (`work-queries.ts`): `WorkItem`, `work_type`, `Keyword`, `tooth_number`
      (local) + `WorkRelatedCounts`, `TransferWorkResult` (exported, but imported only as `type` by
      `WorkService` + re-exported → safe). `Work`/`WorkDetails` NOT flipped — they reach `sendData` via
      `toWorkWire` whose return is an anonymous mapped+intersection type (implicit index sig).
- [x] **Route converted**: all 16 payload handlers `sendSuccess → sendData`; the 2 diagnosis `sendSuccess(res,
      null,…)` voids kept; **GET `/diagnosis/:workId` left as raw `res.json(row|null)`** (the literal-`null`
      "no diagnosis yet" signal — must not be enveloped). 11 `validate()` → contract bodies. Removed the inline
      `*BodySchema` block + `DeleteWorkBody` interface + the `z` import; `WorkStatusBody`/`DeleteWorkBody` kept
      as local aliases onto the contract types so handler signatures are untouched.
- [x] **`apiLoader` extended** (`loaders.ts`): added an optional `schema?: ResponseSchema` forwarded to
      `fetchData` (additive; benefits Phase 4 too). Wired on the 3 `getworkdetails` loaders + the
      `getworktypes`/`getworkkeywords` dropdown fetches.
- [x] **Consumers**: kept their existing generics, added `{ schema }` to the **read** calls only —
      `WorkComponent.tsx` (teeth/getworks/getworkdetailslist), `NewWorkComponent.tsx` (getworktypes/
      getworkkeywords/getworks), `Diagnosis.tsx` (getworks), `TransferWorkModal.tsx` (transfer-preview).
      Skipped mutation responses (`{rowsAffected}`/`{workId}` — unused or a pre-existing mismatched generic).
- [ ] **Gate + runtime DEFERRED**. Owed: `typecheck:all`/`build`/`lint`; runtime work create/update/finish/
      transfer + diagnosis upsert (verify the raw-`null` diagnosis-GET signal still works).

## Phase 4 — patient

13 `validate()`. Route `routes/api/patient.routes.ts` ↔ `loaders.ts` + many patient screens.
**✅ Code complete (2026-06-05) — gate deferred.**

- [x] **`patientSearch` TIGHTENED (the actual N13 fix)**: `patients` rows now assert `{ person_id,
      patient_name }` (was Phase 0's empty `looseObject({})`). The loader (`loaders.ts:701`) already passed
      `{ schema: patientSearch.response }`, so the guard auto-strengthened; also wired on `PatientManagement.tsx`
      (both search calls). `PatientSearchResult` (route interface) flipped → `type` to feed the looseObject.
- [x] **Contract authored** (`patient.contract.ts`): 28 endpoints + 3 shared param schemas (`personIdParams`/
      `alertIdParams`/`timepointParams`, exported standalone since ~10 endpoints share them). New **`anyArray =
      z.array(z.unknown())`** guard for array responses — asserts array-vs-object (N13 class) AND accepts an
      `interface[]` source with NO query-row flip (all assignable to `unknown`). Rich single objects from a
      service/query type → `z.unknown()`; inline-literal payloads → closed `z.object`/`looseObject`.
- [x] **Bodies**: `alertStatus` + `portalEnable` (fully enumerable) → `z.infer` SSoT; the rest
      (create/update patient, `alertBody`, `estimatedCost`, `photoVisibility`, `updateTimepoint`) keep the loose
      guard relocated verbatim; handlers keep their local body interfaces. `tag_options`/`patient_types` rows
      modeled `looseObject({id})` → flipped `TagOption`/`PatientTypeOption` route interfaces → `type`.
- [x] **Route converted**: ~21 payload handlers `sendSuccess → sendData`; 8 `sendSuccess(res, null)` voids kept;
      13 `validate()` → contract bodies (params kept as local aliases destructured from the contract). Removed
      the inline schema block + the `z` and `validation-schemas` imports.
- [x] **Consumers wired** (`{ schema }`, generics kept): loaders (tag/type-options; search/phones already had
      it), `PatientManagement` (search ×2), `PatientQuickSearch`/`SendMessage` (phones), `EditPatientComponent`
      (tag-options). **Long-tail screen reads** (info/patientById = `z.unknown()` no-op anyway; alerts/timepoints/
      gallery/portal `z.array(z.unknown())`/inline) left on **server-side `sendData` validation** — their many
      consumers (ViewPatientInfo, GridComponent, Navigation, CompareComponent, PatientSlideshow, PortalAccessCard,
      …) can adopt `{ schema }` incrementally; the schemas already exist. (Scoped per the "stop after Phase 4".)
- [ ] **Gate + runtime DEFERRED**. Owed: `typecheck:all`/`build`/`lint`; runtime patient create/update/delete,
      search (verify tightened rows don't false-loud on real data), alerts, portal, photo-visibility, timepoint edit.

## Phase 5 — aligner

24 `validate()` (largest). Route `routes/api/aligner.routes.ts` (30 endpoints) ↔ aligner pages;
**folded in** `public/js/pages/aligner/aligner.types.ts`. **✅ Code complete + gated + read-smoked (2026-06-05).**

- [x] **Contract authored** (`shared/contracts/aligner.contract.ts`): 30 endpoints. 5 standalone param
      schemas (`setIdParams`/`noteIdParams`/`batchIdParams`/`drIdParams`/`archformPatientIdParams`).
      Reads modeled as closed inline-literal containers (`{ <array>: anyArray, count, … }`); mutation
      responses modeled as closed `z.object` of the stable scalar ids/flags the consumers key on
      (`setId`/`noteId`/`batchId`, the deliver/manufacture idempotency flags). Bodies: `createNote`,
      `updateNote`, the shared `targetDateBody` → `z.infer` SSoT; the service-bound rest
      (`addPayment`/`createSet`/`updateSet`/`createBatch`/`updateBatch`/`doctorBody`/
      `updateArchformPatient`/`generateLabels`) keep their loose guard relocated verbatim + route keeps
      its local body interface (the documented caveat).
- [x] **`aligner.types.ts` FOLDED** (the named Phase-5 goal): the 6 canonical API row types
      (`AlignerDoctor`/`AlignerSet`/`AlignerBatch`/`AlignerNote`/`ArchformPatient`/`AlignerSetForMatch`)
      are now authored in the contract as `z.object` row schemas (`alignerDoctorRow`, …) and
      `z.infer`-exported, then **imported + re-exported** by `aligner.types.ts` (the `import type` is
      load-bearing — `export type { … } from` alone does NOT bring names into local scope, see Finding).
      UI-only types (`*WithAliases`, `*FormData`, `*ForBatch`/`*ForLabel`, hook returns) stay inline.
- [x] **Route converted**: all ~22 payload handlers `sendSuccess → sendData(res, <a>.response, …)`;
      11 `sendSuccess(res, null)` voids kept; 24 `validate()` → contract `body`/`params`; removed the
      inline `*BodySchema`/param block + the `z` and `idParams`/`intId`/`optionalDateString` imports.
      `GET … no` — left `POST /aligner/labels/generate` (raw PDF `res.send`, request-only in contract)
      and the Archform 503 "unavailable" error branches untouched.
- [x] **Consumers wired** (`{ schema }`, generics kept): loaders (`alignerDoctorsLoader`), `PatientSets`
      (doctors/sets/batches/notes), `AllSetsList`, `DoctorsList`, `PatientsList` (doctors + conditional
      all/by-doctor schema), `SearchPatient`, `ArchformMatcher` (patients + matches), `AlignerDoctorsSettings`.
      Mutation responses (deliver/manufacture results, doctor/archform writes) left unwired per the
      read-only-wiring precedent (schemas exist; adopt incrementally).
- [x] **Gate + read-smoke DONE** (final run): `typecheck:all`/`build`/`lint` green; all 11 aligner GET
      reads return 200 on real DB data (dev-parse passed). **Owed**: mutation runtime (set/batch/payment
      create-update-delete, manufacture/deliver idempotency, PDF upload, doctor + archform CRUD).

---

## Findings & decisions log (append-only, dated)

### 2026-06-05 — Plan verification against the build (Phase 0 kickoff)
- All plan assumptions confirmed on disk:
  - `public/js/core/api.schemas.ts` imported by **exactly 3** files (loaders, useAppointments, WorkComponent).
  - `middleware/validation-schemas.ts` imported by **10** route files (stand, employee, appointment,
    lookup-admin, file-explorer, patient, expense, aligner, payment, visit). Its only import is `zod`
    (frontend-safe to relocate).
  - `tsconfig.build.json` `extends` `tsconfig.json`, sets `module/moduleResolution: NodeNext`,
    `rootDir: "."` → emits `dist-server/shared/`. It does **not** redefine `include`, so adding
    `shared/**/*.ts` to `tsconfig.json` `include` flows through to the prod build automatically.
  - `zod` is `^4.4.3` (`z.looseObject`/`z.object`/`z.infer` available).
  - `PatientSearchResponse` type is currently **only self-referenced** in `api.schemas.ts`
    (no external importer) — safe to recreate in the contract; nothing breaks if renamed.

### 2026-06-05 — CRITICAL: `core/http` returns the **parsed** payload, so `looseObject` is load-bearing
- `validateResponse` (`public/js/core/http.ts:161-163`) returns `result.data` — the schema's
  **parsed** output, *not* the original JSON. In **Zod 4**, `z.object()` **strips** unknown keys;
  `z.looseObject()` **preserves** them; `z.strictObject()` **errors** on them.
- **Consequence:** any object whose *extra* (unmodeled) fields the UI actually consumes **must** be
  `z.looseObject({})`, or those fields are silently dropped from what the consumer receives.
- This is exactly why the existing schemas model **rows** as `looseObject` but **fixed containers**
  (`{ allAppointments, checkedInAppointments, stats }`, the `stats` block) as plain `z.object` —
  those containers have a known, closed key set with nothing extra to preserve.
- **Authoring rule for all later phases:** default new response *row/object* schemas to
  `z.looseObject({ <stable ids only> })`. Use plain `z.object` only for closed, fully-modeled
  containers. Tighten to `strictObject`/full row schemas later, *after* runtime verification.

### 2026-06-05 — `sendData` dev-parse vs. prod-raw: practically equivalent for the client
- Plan's `sendData` sends `schema.parse(data)` in dev, raw `data` in prod. For closed-container
  schemas (no extra top-level keys) `parse` returns the data unchanged, so there is no observable
  dev/prod payload difference. Even where it would differ, the **client re-parses with the same
  schema** (`fetchJSON({ schema })`), so the consumer's final value is identical either way. The
  server-side dev-parse's real job is **fail-loud-in-dev + compile-time typing**, not reshaping.
- Phase 0 adds `sendData` but does **not** call it yet (no backend route is converted until Phase 1);
  it will first be exercised in payment.

### 2026-06-05 — Contract action names collide with consumer locals → alias-on-collision rule
- `WorkComponent.tsx` has a `paymentHistory` **state variable** (`const [paymentHistory, setPaymentHistory]
  = useState<Payment[]>([])`, line ~149). A bare `import { paymentHistory }` does **not** error — the
  module import is *shadowed* inside the component by the state var, so `paymentHistory.response` would
  silently resolve against `Payment[]` and fail with a misleading "Property 'response' does not exist on
  type 'Payment[]'". Caught by the gate, but confusing.
- **Rule (now in the convention):** consumers use named imports of contract actions; on a local
  collision, alias with a `…Contract` suffix (`paymentHistory as paymentHistoryContract`). Keep contract
  export names as natural nouns — don't mangle them to dodge collisions. The other two consumers
  (`loaders.ts`, `useAppointments.ts`) were verified collision-free.
- **Watch for this in later phases:** stand/work/patient/aligner consumers have many domain-noun state
  vars (`patients`, `items`, `sets`, …) that may collide with same-named contract actions.

### 2026-06-05 — ✅ RESOLVED (user decision): full request-body enumeration → `z.infer` single source of truth
**Decision (user):** for *every endpoint brought into the shared contract*, **fully enumerate** the request
body so `z.infer<typeof <action>.body>` is the single source of truth and the hand-written `XxxBody`
interfaces are **deleted**. This **supersedes** the prior "keep loose schema + hand-written interface"
convention **for contracted endpoints** (non-contracted routes keep the old convention until they're
contracted — see the amended `validation-boundary-convention` memory). User framing: *incremental, slow,
done extremely properly to avoid problems in critical business values (money, works).* The plan was updated
to match (Decisions locked + Contract-file example + Per-endpoint recipe + Verification + Risks).

**How — the careful method (mandatory; this is critical-business code):**
1. **Trace every body field in 3 places** before writing the schema: (a) what the handler destructures from
   `req.body`; (b) what it forwards (`...body` / object pass) into services + query modules — read those
   input types AND the actual column writes; (c) required-vs-optional = exactly what the service requires
   (don't 400 a field callers legitimately omit — the quick-checkin lesson).
2. **Enumerate ALL of them** with the right primitives (`intId`/`dateString`/`optionalDateString`/
   `z.coerce.number()`/`.min(1)`/`.optional()`). A handler-read field that ends up typed `unknown` ⇒
   enumeration is incomplete; fix before shipping.
3. **Default container `z.looseObject`** — a *missed* field then fails safe (passes through), never silently
   stripped. (`validate.ts:59-61` deletes all keys then `Object.assign`s the parsed result, so a strict
   `z.object` would DROP an un-enumerated field → the money/works data-loss bug we must avoid.)
4. **Delete the route's hand-written interface**; type the handler `Request<…, z.infer<typeof <a>.body>>`.
   For a body forwarded wholesale to a service, confirm `z.infer<body>` is assignable to the service input
   type (compile-checked); prefer making the contract the type the service derives from (one definition).
5. **Runtime-verify the real create/update/delete flow** per endpoint (not "page loads"): no 400 on a valid
   payload (under-enumeration) AND the persisted row keeps every field/value (over-stripping / mis-coercion).
6. **Strict `z.object` tightening** (to also reject over-posting) is a *later, per-endpoint* hardening, only
   after step 5 passes. Record the runtime delta (new coercion/optionality) for the reviewer.

**Why looseObject-default, not strict:** both yield the precise `z.infer` SSoT type once enumeration is
complete; looseObject makes an enumeration *mistake* a harmless typing gap instead of a silent data-loss bug
— the safer failure mode for critical business values.

**Caveat for later groups:** the `validation-boundary-convention` memory's 3rd case (body typed as a backend
*service input type*, e.g. `addwork` → `WorkCreateData`) can't share that type to the frontend (it would drag
DB code into the bundle). For those, enumerate the body in the contract's Zod (the new SSoT) and have the
*service* consume the contract's inferred type, OR keep the service type local + a loose contract guard if
the service type can't be touched that phase. Payment (Phase 1) has no such case.

### 2026-06-05 — ⚠️ CRITICAL cross-phase finding: `z.looseObject` infer has a string index signature, so an `interface`-typed value is NOT assignable to it (`sendData` blocker)
**This bites every phase — read before authoring any `sendData` call.** `z.looseObject({...})`
infers `{ ...modeled } & { [k: string]: unknown }` (the catchall is what preserves long-tail fields for
the client — load-bearing, see the earlier Finding). But TypeScript will **not** assign a value typed by an
`interface` to a type carrying a string index signature: `error TS2345: Index signature for type 'string' is
missing in type 'PaymentRecord'`. Verified with an isolated `tsc --strict` probe. So `sendData(res,
<a>.response, data)` — whose 3rd arg is `z.infer<S>` — **fails to compile** when `data`'s type is an
`interface` *and* the response is a `looseObject` (the default). Strict `z.object` responses are unaffected
(no index signature → interfaces assign fine).
- **Why an `interface` and not a `type`:** TS only synthesizes an *implicit* index signature for **object
  `type` aliases** and inline/anonymous object literal types — **not** for `interface` (interfaces are
  open/augmentable). Probe-confirmed: the *same* shape as a `type` alias, or spread into a fresh literal
  (`{...x}` / `arr.map(r => ({...r}))`), **does** assign.
- **CHOSEN RULE (this rollout): make the data-source type a `type` alias, not an `interface`.** Zero runtime
  cost, full drift detection preserved (the modeled keys are still checked), clean call sites. Applied in
  Phase 1: converted `PaymentRecord` + `WorkForInvoice` (`payment-queries.ts`), `CreatedInvoice`
  (`PaymentService.ts`), `WorkForReceiptResult` (`payment.routes.ts`) from `interface` → `type` (each carries
  a comment pointing here; none were exported/extended, so the change is local + safe).
- **Rejected alternatives:** (a) call-site cast `data as z.infer<…>` — loses drift detection; (b) spread
  `{...x}` / `.map(r=>({...r}))` — runtime copy on every response + ugly; (c) loosen `sendData`'s `data` param
  generically (strip index sigs) — breaks on **array** responses (`keyof T[]` = array methods) and on `Date`
  fields (deep-mapping mangles built-ins). Don't reach for these unless a later phase has a return `interface`
  that's **exported/extended widely** and can't be flipped — then prefer a tiny local `type` re-alias.
- **Later-phase checklist item:** for each `sendData(res, loose.response, x)`, confirm `x`'s static type is a
  `type` alias or inline literal. If it's an `interface` from a query module, flip that `interface`→`type`
  (cheapest) and grep for `extends`/declaration-merge first.

### 2026-06-05 — Response modeling: model EXACTLY the fields the consumer reads (then loose long-tail)
- `paymentHistory` rows: the WorkComponent table reads `InvoiceID, amount_paid, date_of_payment` **and**
  `actual_amount, actual_cur, change` (lines ~1262-1266 — easy to miss). Because `core/http` returns the
  *parsed* payload, any field the consumer reads must be modeled (else it's `unknown` and the consumer won't
  type-check) **or** the row must stay loose enough to carry it. Modeled all six; kept `z.looseObject` for the
  long tail (e.g. `work_id`). The nullable DB columns (`actual_*`, `change`) are `z.<t>().nullable()` **not**
  `.optional()` — the query always returns the key (as `null`), so `.optional()` would fail-loud on parse.
- Consumer ripple: that made `actual_cur` type `string | null`, which the component's local
  `formatCurrency(amount?, currency?)` helper (`currency?: string`) rejected → widened it to
  `currency?: string | null` (it already coalesces `currency || 'USD'`). General lesson: tightening a response
  to the true (nullable) DB shape can surface latent `string`-vs-`string|null` gaps in consumers.

### 2026-06-05 — Latent bug fixed: `WorkForReceiptResult.workid` vs SQL `work_id`
- The route's `getworkforreceipt` SQL projects `w."work_id"`, but the result interface declared `workid`
  (a pure type assertion on `sql<…>`, so it never errored — the runtime row actually has `work_id`, which the
  PaymentModal consumer reads as `workData.work_id`). Authoring `workForReceipt.response = z.looseObject({
  work_id })` forced the type to match reality → renamed the field to `work_id`. Contract authoring surfaces
  these assertion-hidden mismatches.

### 2026-06-05 — `addInvoice` body: optional currency fields + client-sent `null` change are safe
- 3-place trace: handler defaults `usdReceived/iqdReceived/change` each with `?? 0` ⇒ all three are
  **optional** in the body (don't 400 a caller who omits them). The client (PaymentModal) sometimes sends
  `change: null` (same-currency). `z.coerce.number().optional()` maps `null`→`0` (`Number(null)===0`), which is
  exactly what the handler's `change ?? 0` would have produced — identical persisted row either way (and for
  same-currency the service forces `change=null` regardless). So the contract body needn't model `null`; the
  client payload is intentionally left un-typed (`postJSON`'s `data` is generic) to avoid a spurious
  `null`-vs-`undefined` friction. Required body fields = `workid, amountPaid, paymentDate` only.

---

### 2026-06-05 — Phase 2: `timestamp`(Date) columns need a dual-side primitive (`timestampString`)
**New cross-phase primitive — read before modeling any `timestamp` column in a response.** A response
schema is parsed at TWO points with DIFFERENT representations of a PG `timestamp` column: `sendData`'s
dev-parse on the **server** sees a **`Date`** (the `pg` parser returns `Date` for `timestamp`), while
`fetchJSON({ schema })` on the **client** sees a **`string`** (it crossed `JSON.stringify`). So a plain
`z.string()` throws server-side on the raw `Date`; a plain `z.date()` throws client-side on the string.
- **Fix:** `shared/validation.ts#timestampString = z.union([z.string(), z.date().transform(d=>d.toISOString())])`.
  The Date branch `.transform`s to the EXACT same ISO string `JSON.stringify` already emits in prod (where
  `sendData` skips the parse and sends the raw `Date`), so dev and prod deliver an identical wire value; the
  inferred **output type is `string`** (matching the hand-written frontend interfaces these columns fed).
- Used for `date_added`/`modified_date`/`sale_date`/`voided_date`/`movement_date`. **NOT** for `date`-typed
  columns (`expiry_date`) — those are already `string` on BOTH sides (`db:codegen --date-parser string`), so
  plain `z.string()`. Phase 1 (payment) had only `date` columns, which is why it never surfaced this.
- **Behavior preservation:** these columns ALREADY reach the client as UTC ISO strings today (raw `Date` →
  `JSON.stringify` → `toISOString`), so the transform reproduces current behavior exactly — no new TZ shift.

### 2026-06-05 — Phase 2: typing a handler body with a contract `number` field breaks an `x === undefined` guard (TS2367)
**Watch on every handler that defensively checks a required scalar.** Several stand handlers guard with
`if (costPrice === undefined)` / `unitCost === undefined` / `delta === undefined`. Those fields are typed
`number` in the enumerated contract body, so typing the handler `Request<…, CreateItemBody>` makes the guard a
**TS2367** ("types 'number' and 'undefined' have no overlap"). These routes had **no** hand-written body
interface originally (untyped `req.body: any`), so the faithful, lowest-risk choice is to **leave the body
untyped** for `createItem`/`restock`/`adjust` — the contract `validate({ body })` still enforces shape at the
boundary, and the `z.infer` body export stays the SSoT (shared with the client). Handlers WITHOUT such a guard
(`scanVision`, `createCategory`) ARE typed with the contract body. (Payment dodged this — its bodies used
`?? 0` defaults, not `=== undefined`.) **Alternative if you want the typed body:** delete the now-redundant
presence guard (validate() already 400s a missing required field) — defer to the service's nicer message.

### 2026-06-05 — Phase 2: `core/http` `{ schema }` does NOT infer the generic — keep the explicit (contract) generic
The plan's "drop the generic, inferred" is inaccurate vs. the actual `core/http`: `fetchJSON<T=unknown>`/
`postJSON<T=unknown>` type the return as the **explicit** `T`, and `FetchOptions.schema` is a non-generic
`ResponseSchema` — so `fetchJSON(url, { schema })` yields `T=unknown`. Phase 1 already did the right thing:
keep the explicit generic AND pass `{ schema }` — the generic (now the **contract-inferred** type) types the
result, the schema validates it at runtime. Pattern for all phases: `fetchJSON<ItemsResponse>(url, { schema:
items.response })`. (Re-exporting the contract row types from the consumer hook keeps existing component
imports — `from '../../hooks/useStand'` — resolving unchanged while making them contract-derived.)

### 2026-06-05 — Phase 2: POS sale stays service-validated (no new route body schema)
`POST /stand/sales` deliberately has **no** `validate()` — the route comment documents that
`validateAndCreateSale` (a `validateAnd…` service) IS the cart boundary (deep per-item stock/price/payment
checks with friendly errors). Phase 2 honored that: `createSale` is **response-only** in the contract (typed
`{ saleId, change }` + runtime guard); the cart body keeps service-side validation and the frontend keeps its
local `SaleCreateData`. The plan's "fully enumerate every body" is scoped to the **existing** `validate()`
sites — adding validation where a service already owns the boundary would duplicate logic and risk a new 400
on the money path. Same reasoning left the `updateCategory`/`updateItem` partial-update bodies unvalidated.

### 2026-06-05 — Phase 3: minimal responses + keep-consumer-generics when a shape has many divergent consumer types
The work object is mirrored by **several different hand-written types across files** (`Work` in
WorkComponent, `WorkResponse` in NewWorkComponent, `WorkInfo` in Diagnosis, `WorkData` in loaders). Unifying
them all onto one contract-inferred type would be a large, risky refactor for little N13 benefit. Decision for
groups with this shape: **model the response minimally** (container + the stable id the consumer keys on,
`z.looseObject` long-tail), **keep each consumer's existing generic**, and just add `{ schema }` for the
runtime boundary guard. The server still gets compile-time container/id typing via `sendData`. This is the
plan's "Response tightness" applied at its loosest end; per-field tightening (and type unification) is the
later hardening. (Phases 1–2 unified types because each shape had ONE consumer; work doesn't.)

### 2026-06-05 — Phase 3: `apiLoader` now forwards a `schema` (route-loader boundary validation)
`router/loaders.ts#apiLoader` previously called `fetchData<T>(url, { signal })` with no way to validate the
response. Added `schema?: ResponseSchema` to `ApiLoaderOptions`, forwarded to `fetchData` — so route loaders
(not just component `fetchJSON`s) get the same fail-loud H11 guard. Wired on `getworkdetails`. **Phase 4 will
reuse this** for the patient loaders (`patientSearch` N13 tighten runs through a loader).

### 2026-06-05 — Phase 3: a raw (un-enveloped) endpoint stays out of the contract
`GET /api/diagnosis/:workId` deliberately returns `res.json(row | null)` — NOT `sendSuccess` — because the
literal `null` is the "no diagnosis yet" signal the client detects with `if (diagnosis)`; enveloping it as
`sendSuccess(res, null)` would make the client receive a truthy `{success,…}`. So it was NOT converted to
`sendData` and is NOT modeled in the contract (its consumer in `Diagnosis.tsx` keeps a plain `fetchJSON<
Partial<DiagnosisData> | null>` with no schema). When a handler bypasses the envelope on purpose, leave it.

### 2026-06-05 — Phase 3: large service-bound bodies relocate loose (the documented caveat, exercised)
Unlike payment/stand, several work bodies forward wholesale to `WorkService` (`addWork`→`WorkCreateData`) or
carry 22–45 financial/clinical fields (`updateWork`, `diagnosis`). Per the RESOLVED-finding caveat, these
keep their EXISTING loose guard (only the required scalars enumerated) — relocated verbatim into the contract
— and the handlers keep their local hand-written body interfaces (`UpdateWorkBody`/`WorkDetailBody`/
`DiagnosisData`) + the service's `WorkCreateData`. Full per-field enumeration of money/clinical bodies is a
later, runtime-verified hardening — NOT a blind rewrite here. Only `workStatus`/`deleteWork` (small, fully
enumerable) became `z.infer` SSoT this phase.

### 2026-06-05 — Phase 4: `anyArray = z.array(z.unknown())` — the flip-free array guard
The looseObject-index-signature tax (a query `interface[]` won't assign to `z.array(z.looseObject({…}))` in
`sendData`) made each array endpoint a flip-or-spread decision. **`z.array(z.unknown())` sidesteps it
entirely**: every type is assignable to `unknown`, so an `interface[]` source passes with NO flip, AND it still
asserts the container is an array (the N13 array-vs-object class). The element values are preserved (`z.unknown`
parse is identity), so consumers keep their generic element types. Used for phones/timepoints/images/alerts/
gallery. Reserve modeled `z.array(z.looseObject({ <id> }))` (and the one needed flip) for the endpoint that
actually needs row-id drift detection — here only `patientSearch` (the N13 victim) + the tiny tag/type options.
**Reusable rule:** when you only need "is it an array" and don't want to flip the source interface, use
`z.array(z.unknown())`; when you need a row-id guard, model `looseObject({id})` and flip the source.

### 2026-06-05 — Phase 4: rich single objects from a service/query type → `z.unknown()` response
A single-object response can't use the array trick. Modeling `z.looseObject({ <id> })` would (a) require the
source interface to be flipped AND (b) is the only way to *preserve* fields on parse — but a closed `z.object`
would STRIP everything the consumer reads. For a rich object whose source is a service/query type we don't want
to flip (`getPatientInfo`, `getPatientById`+alerts), the response is `z.unknown()`: it compiles trivially
(`z.infer` = `unknown`, any value assignable), preserves the payload, and documents the SSoT — but is a runtime
no-op guard. Acceptable because these were never the drift victims; tighten later by flipping the source +
`looseObject({ <id> })`. Inline-literal handler payloads (the majority) use a real closed `z.object`/`looseObject`.

### 2026-06-05 — ⚠️ CROSS-CUTTING (gate surfaced): `sendData` must type `data` as `z.input<S>`, not `z.infer<S>`
**This was the single biggest gate finding — it had silently broken every `timestampString` `sendData`
call since Phase 2, invisible only because the gate was deferred.** `sendData<S>(res, schema, data, …)`
originally typed `data: z.infer<S>` (= `z.output<S>`). But the handler holds the **pre-serialization**
value: for a PG `timestamp` column modeled with `timestampString` (`z.union([z.string(),
z.date().transform(d=>d.toISOString())])`), that value is a raw **`Date`** (the schema's *input*), which
the dev-parse transforms to the ISO *string* output. `z.infer`/`z.output` of that field is `string`, so
`Date`-typed data → **`TS2345: 'Date' is not assignable to 'string'`** (9 stand errors:
`date_added`/`movement_date`/`sale_date`). **Fix: `data: z.input<S>`** — the input type accepts `string |
Date`, which is exactly what the handler passes; the dev-parse still validates + transforms; the client
still receives the `string` output via `fetchJSON({schema})`. For every schema WITHOUT a transform (the
vast majority) `z.input === z.output`, so this is a no-op — it only matters for transform-bearing
primitives. **Runtime-verified**: stand items/movements GETs 200 live (Date→ISO transform exercised by the
dev-parse). Lesson for any future transform primitive: `sendData`'s arg is the schema INPUT side.

### 2026-06-05 — Phase 5: fold rich types as `z.object` row schemas used for `z.infer` ONLY, responses stay `anyArray`
The plan's "fold `aligner.types.ts` (contract-derived)" collides with the Phase 3/4 "minimal responses +
keep generics" safety rule (AlignerSet is mirrored across PatientSets/AllSetsList/forms; a too-tight row
response fail-louds on real data). **Resolution — decouple the two:** author the 6 canonical rows as
**`z.object` row schemas** (`alignerDoctorRow`/`alignerSetRow`/…) mirroring the old interfaces exactly,
export their `z.infer` types (the fold — types now live in `shared/`, single source of truth, both sides),
but DON'T plug them into the array responses — those stay `anyArray` (`z.array(z.unknown())`). Net: the
type-level fold is delivered AND the runtime guard stays loose (no false-loud risk; `anyArray` still
asserts the N13 array-vs-object class). `z.object` (not `looseObject`) for the row schemas → **clean
inferred types with NO string index signature**, structurally identical to the old interfaces, so the 8
`aligner.types` importers + `Pick<>`/`extends` helpers compile unchanged. Plugging a row schema into its
response (runtime row-field validation) is the later, runtime-verified hardening.

### 2026-06-05 — ⚠️ Phase 5 gotcha: `export type { X } from '…'` does NOT bring `X` into local scope
When folding `aligner.types.ts`, a bare `export type { AlignerDoctor, … } from '@shared/…'` re-exports the
names but leaves them **undefined inside the module** — so `interface AlignerDoctorWithAliases extends
AlignerDoctor`, `Pick<AlignerSet, …>`, and `LabelModalData { batch: AlignerBatch }` all failed with
**`TS2304: Cannot find name`**, and *cascaded*: `Pick<error, K>` makes every picked key **required** (so
`AlignerSetForBatch.days` flipped optional→required) and `extends error` drops the base fields (so
`AlignerDoctorWithAliases` lost `dr_id`) — 13 errors, all from this one root. **Fix: `import type { … }`
AND `export type { … }`** (separate statements) — import for local references, export for re-export. A
single combined `export type { … } from` is the trap.

### 2026-06-05 — Phase 5: small residual type-truths the gate forced (NOT blind silencing)
Two contract responses had to match the real (looser) source type, surfaced only at the gate:
- `uploadPdf.response.size` → `z.union([z.string(), z.number()])` because `PdfUploadResult.size` is typed
  `string | number` (driveResult.size || 0). Modeling `z.number()` rejected the source.
- `patient.contract.timepointFolder.response.folder` → `z.string().nullable()` because
  `timepointFolderName()` returns `string | null` (null = no resolvable folder). Pre-contract the handler
  always sent that null, so nullable is behavior-preserving — the contract just stops lying about it.
- `work` `deleteWork`: `result.rowsAffected` is `number | undefined` (`DeleteResult.rowsAffected?`) but the
  shared `rowsAffected` response is strict `z.number()` (other consumers pass a definite number). Fixed at
  the **call site** (`?? 0`, behavior-preserving on the success path) rather than loosening the shared
  schema — keeps drift detection strict for discontinue/reactivate/updateWorkDetail/deleteWorkDetail.

### 2026-06-05 — Wave 2 Phases 6–10 (lookup, appointment, expense, employee+staff, visit)

- **Gate green first try** (`typecheck:all` backend + frontend both EXIT 0). The Wave-1 traps did NOT
  recur because they were pre-empted: `sendData`'s `data: z.input<S>` is already fixed; every `looseObject`
  `sendData` source was flipped `interface`→`type` up front; service-bound shapes used `anyArray`/`z.unknown()`
  to sidestep the index-signature tax entirely.
- **interface→type flips this wave** (all local, non-exported, no `extends`): `LookupItem`
  (patient-queries), `AlertType` (alert-queries), `ImplantManufacturer` (work-queries); `AppointmentDetail`
  /`AppointmentResult` (appointment.routes); `Employee`/`position` (employee.routes); `StaffMember`
  (staff.routes).
- **`import * as <group>` collides with handler/consumer locals — rename the local, not the import.** The
  namespace-import style (`import * as appointment from …`) is shadowed by any local of the same name:
  `appointment.routes` had `const appointment = await validateAndCreateAppointment(...)` → renamed local to
  `createdAppointment`; `expense.routes` `const expense = await getExpenseById(...)` → `expenseRow`;
  `visit.routes` `const visit = await getVisitById(...)` → `visitRow`. On the **client**, where the local
  can't be renamed cleanly, alias the import instead: `EmployeeSettings`/`Expenses`/`useExpenses` →
  `employeeContract`/`expenseContract`; `NewVisitComponent`/`VisitsComponent` → `visitContract`. (Generalizes
  the Phase-0 `paymentHistory` collision rule to the whole-module import form.)
- **`getDailyAppointments` left on `sendSuccess` (NOT converted).** The service returns
  `DailyAppointmentsOptimizedResult` whose rows are `Record<string, unknown>[]`, which is **not** assignable
  to the existing `dailyAppointments.response` row `z.input` (`{ appointment_id: number } & …` — a `Record`'s
  index gives `unknown`, not `number`). It's already client-contracted (Phase 0 `useAppointments`), so the
  server stays `sendSuccess` and only the other 10 appointment endpoints were converted. (A reminder that the
  server-side `sendData` conversion is gated by the *source* return type, not just the schema.)
- **GET query schemas added (the H10 silent-NaN close)** on the manual-`parseInt` reads: employee `/employees`
  (loose string filters — `position` may be a NAME, so NOT numeric), and visit `/getlatestwires`/
  `/getvisitsbywork`/`/getvisitbyid` (`numericParam` on `workId`/`visitId`). The manual `if(!x)` guards were
  left in place (now redundant-but-harmless) to minimize behavior change.
- **`anyArray`/`z.unknown()` did the heavy lifting** for the service-bound responses (expense list/categories/
  subcategories/summary arrays; visit wires/visits; getWebApps/quick-checkin rich objects; single
  expense/visit rows) — flip-free, asserts the N13 array-vs-object class, preserves the payload, and the
  consumer keeps its explicit generic. Row-id `looseObject` guards were reserved for the dropdown feeds
  (lookup, appointment-details, employees/positions, doctors/operators, patient-appointments) where the
  consumer keys on a stable id.
- **Mutations stayed largely response-modeled-but-client-unwired** (per the read-only-wiring precedent): the
  state/create/quick-checkin/undo appointment writes, expense/employee create-update-delete, visit add/update/
  delete — server emits via `sendData` (compile-time + dev-parse), client `{schema}` adopted incrementally.

### 2026-06-05 — Wave 2 Phases 11–15 (settings+cost-preset, file-explorer+photo-editor, Group-B remainder, ROOT migration, final gate)

- **Gate green** (`typecheck:all` + `build` + `lint`) with only ONE backend error surfaced (well within the
  pre-empted-trap pattern): `lookup-admin createItem` — `createLookupItem` returns `string | number | null`
  (uuid OR numeric id OR null), so `response.id: z.number()` rejected the source. Fixed → `id: z.unknown()`
  (heterogeneous id, preserve). No interface→type / `z.input` surprises (pre-empted).
- **⚠️ NEW CROSS-PHASE GOTCHA — `sendData(res, schema, null)` does NOT yield `{data:null}`.** `sendSuccess`
  builds the envelope with `...(data !== null && data !== undefined && { data })` (`error-response.ts:90`),
  so a **null/undefined** payload is **omitted entirely** → the wire is `{success:true,timestamp}` with **no
  `data` key**. The funnel only unwraps when `success===true && 'data' in body`, so with no `data` key it
  returns the **whole envelope** (truthy), NOT null. Caught live on media `GET /webceph/patient-link` (the
  "fix the one raw `res.json({success:false,data:null})`" target): the first attempt `sendData(…, null)`
  made the consumer receive `{success:true,timestamp}` and treat it as a real link. **Fix: a "soft
  not-found" that must read as falsy can't ride `sendData(null)` — use `ErrorResponses.notFound` (404) and
  have the consumer treat 404 as the empty case** (`fetchJSON` throws `HttpError` with `.status`, so
  `catch (err) { if (err.status !== 404) … }`). Rule: never `sendData(res, schema, null/undefined)` expecting
  the client to read null — model it as a 404 or as an explicit non-null sentinel object.
- **ROOT migration (Phase 14) — the funnel-unwrap reasoning ONLY holds for core/http consumers.** Migrating a
  top-level manual envelope (`{success, X}`) to `sendData` (`{success, data:X}`) is behavior-preserving for a
  consumer that reads `X` THROUGH the core/http funnel (it unwraps `data` → key access unchanged; drop the
  dead `.success`-at-2xx checks). But `POST /api/email/send-appointments` is consumed by the **RAW whatsapp
  `apiClient`** (WhatsAppSend.tsx, `expectedFields:['success']`), which does **NOT** unwrap — it reads
  `success`/`appointmentCount` at the TOP level. Nesting under `data` would hide those fields → **left it raw**
  (top-level manual envelope), same class as the messaging `count`/`reset` endpoints. **Always check the
  consumer's transport (funnel vs raw apiClient) before migrating an envelope.** user-management + the
  EmailSettings-consumed email endpoints + all 6 calendar GETs use the funnel → migrated cleanly.
- **Live envelope verification (Phase 14):** confirmed `/api/users` → `{success,data:{users:[…]}}` and
  `/api/calendar/week` → `{success,data:{days,weekStart,…,timeSlots}}` — the `looseObject` containers
  preserved every unmodeled key (weekStart/weekEnd/maxAppointmentsPerSlot/…), so the funnel returns exactly
  what `validateCalendarData`/`.days`/`.timeSlots`/`.users` read. Dropped the dead `!success` guards in
  AppointmentCalendar (×2) + SimplifiedCalendarPicker (×2) + EmailSettings (×3) — they would have **fired
  post-unwrap** (the unwrapped payload has no `success`) and thrown/skipped. This was the real migration risk,
  caught by tracing each consumer.
- **Excluded endpoints honored:** file-content + working-files/content streams, photo `/render` (202+SSE),
  video `/:id/stream` + `/:id/thumbnail`, utility twilio `res.send`, `GET /api/email/test` (semantic-success
  at 200 — verified live it stays raw top-level). Photo `/render` still shares the contract's `personIdParams`
  guard but keeps its inline body schema + raw 202.
- **`anyArray`/`z.unknown()` again did the heavy lifting** for service-bound rich shapes (FileListing/FileEntry,
  Video rows, statistics summary, messaging count/reset, webceph results) — flip-free, asserts the N13 class,
  preserves payload. Row-id `looseObject` reserved for the genuine dropdown N13 victim (cost-presets `preset_id`).
  Only one interface→type flip this wave: `CostPreset` (cost-preset-queries).
- **Group B = response-only** honored: cost-preset/messaging/holiday/reports/video/media/utility/lookup-admin
  authored responses + `sendSuccess→sendData` (wire-identical for already-enveloped endpoints — adds dev-parse
  only) + wired `{schema}` on the high-value funnel reads (cost-presets, options, db-config, videos, holidays,
  statistics, messaging status, files/working-files/photo-dates). media/utility/lookup-admin = server-side
  dev-parse only (no client `{schema}` per the locked decision), though they DO have consumers.

## Verification log (gate results per phase)

| Date | Phase | `typecheck:all` | `build` | `lint` | Runtime smoke | Notes |
|------|------:|-----------------|---------|--------|---------------|-------|
| 2026-06-05 | 0 | ✅ pass | ✅ pass (client + `build:server exit=0`; `dist-server/shared/{validation,contracts/*}.js` emitted) | ✅ pass (touched files) | n/a (no route converted; client-side migration only) | Barrel `dist-server/middleware/validation-schemas.js` resolves `../shared/validation.js`. |
| 2026-06-05 | 1 | ⏸ deferred | ⏸ deferred | ⏸ deferred | ⏸ deferred | **Gate deferred** per user instruction (don't type-check until all phases done; stop after phase 1). Interim proof: **isolated `tsc --strict` probe** of every payment `sendData` chain (exact schemas + `type`-alias sources) + frontend `z.infer` field access → **EXIT 0**. Runtime add/set-rate/delete flows still owed. |
| 2026-06-05 | 2 | ⏸ deferred | ⏸ deferred | ⏸ deferred | ⏸ deferred | **Gate deferred** per user instruction (don't type-check until all phases done). No isolated probe this round — careful structural review only; risks flagged in Findings (looseObject index-sig flips, `timestampString` dual-side, TS2367 untyped bodies). |
| 2026-06-05 | 3 | ⏸ deferred | ⏸ deferred | ⏸ deferred | ⏸ deferred | **Gate deferred**. Structural review only. Residual risk to watch at the gate: `toWorkWire`'s anonymous `Omit&{}` return assigning to the looseObject response (if it fails, wrap the `sendData` arg in a spread); 6 query interface→type flips; `apiLoader` schema plumbing. |
| 2026-06-05 | 4 | ⏸ deferred | ⏸ deferred | ⏸ deferred | ⏸ deferred | **Gate deferred**. Structural review only. Residual risk: 3 route interface→type flips (`PatientSearchResult`/`TagOption`/`PatientTypeOption`); the tightened `patientSearch` rows must hold on real data (person_id/patient_name always present — they're NOT NULL PK/name, so safe); `z.unknown()` info/patientById are no-op guards by design. |
| **2026-06-05** | **5** | **✅ pass** | **✅ pass** | **✅ pass** | **✅ reads** | **FINAL GATE (all phases) run together.** `typecheck:all` green (after the `sendData` `z.input` fix + 3 residual type-truths — see Findings); `build` green (Vite client + `build:server` exit=0; all 6 contracts emitted to `dist-server/shared/contracts/`); `lint` 0 errors (2 pre-existing `exhaustive-deps` warnings). **Read-smoke (NODE_ENV=development, dev-parse active):** all 11 aligner GETs 200 on real data (incl. `sets/:workId`, `batches/:setId`, `all-sets` `noNextBatchCount`); archform/patients → 503 unavailable (intentional un-contracted branch, WSL has no Archform DB). |
| **2026-06-05** | **1–4 (final)** | **✅ pass** | **✅ pass** | **✅ pass** | **✅ reads** | Deferred gates from Sessions 2–3 **resolved** by the same final run. Cross-phase read-smoke: stand categories/items/low-stock/dashboard 200 (`timestampString`+`z.input` live), patient `search?q=92` → 200 with **100 tightened rows**, work getworktypes/getworkkeywords 200, payment covered by build/typecheck. **Owed**: mutation (write-path) runtime across all phases. |
| **2026-06-05** | **W2 6–10** | **✅ pass** | ⏸ deferred | ⏸ deferred | ⏸ deferred | **Wave-2 Phases 6–10 code complete; `typecheck:all` green first try** (backend EXIT 0 + frontend EXIT 0). `build`/`lint`/runtime deferred to the Wave-2 final gate (Phase 15). |
| **2026-06-05** | **WRITE-PATH (all)** | ✅ (re-run green) | n/a | n/a | **✅ mutations** | **Owed-before-merge mutation smoke DONE** (Session 7). Live create→verify→delete on the dev DB (port 3101, dev-parse active) across 8 domains: expense, stand (full POS: category/item/restock/adjust/sale/void), patient, work-create, payment addInvoice/deleteInvoice + updateExchangeRate, appointment, employee, aligner-doctor, cost-preset. **Zero false 400 (no under-enumeration), persisted rows kept every field (no over-strip / mis-coercion incl. `currency`, optional fields, `timestampString` `date_added`), stock math exact, no client/dev-parse fail-loud.** Self-cleaning verified (ZZZ leftover sweep = 0). Two non-bugs surfaced: addwork needs `currency` (service-bound loose body, not a contract regression — DB `ck_works_cur`); `deletework` is `DELETE` not POST. |
| **2026-06-05** | **W2 11–15 (FINAL)** | **✅ pass** | **✅ pass** | **✅ pass** | **✅ reads** | **Wave-2 FINAL GATE.** `typecheck:all` green (1 fix: `lookup-admin createItem.id` → `z.unknown()`); `build` green (Vite client + `build:server`; all 14 Wave-2 contracts emitted to `dist-server/shared/contracts/`); `lint` 0 errors (2 pre-existing warnings). **Read-smoke (NODE_ENV=development, port 3101):** every read across P11–14 → 200 on real data; root-migration envelope verified (`/api/users`, `/api/calendar/week` nest payload under `data`, keys preserved); `/api/email/test` confirmed raw. Found+fixed the `sendData(null)` media bug (→ 404). **Owed:** write-path mutation runtime. |
| **2026-06-05** | **100%-enum + 4 NEW contracts** | **✅ pass** | n/a | n/a | **✅ mutations** | **Session 8 — newly-added-contract mutation smoke (the OWED item from the 100%-body-enum pass).** Server live (NODE_ENV=development, Express :3101 / Vite :5273, `sendData` dev-parse active). `typecheck:all` re-run **EXIT 0** (backend+frontend). Boundary smoke of all 4 new contracts: **chair-display** (validate-wired) — valid beacons both union directions → 202, missing `personId` + boolean `chairId` → 400 w/ correct field path; **whatsapp** (validate-wired) — valid send-receipt/send-appointment pass validate then short-circuit "WhatsApp not connected" (client INITIALIZING, **no messages sent**), `z.coerce.number` accepts `"12"`, `"abc"`/missing → 400 NaN, `sendmedia` valid→handler "not ready" 400 (validate passed) / missing file → 400, `sendmedia2` valid prog=WhatsApp passed validate **after** `multer upload.none()` (→ "File not found", confirms middleware order), `prog:"Email"`/missing → 400 enum; **template** (type-only) — full create→verify(16 fields exact)→partial-update(name+width only, desc preserved)→delete→GET 404, self-cleaning; **auth** (type-only) — bad creds 401, wrong currentPassword 401, short newPassword 400, **Admin/Yarmok11 still logs in (password un-mutated)**. Leftover ZZZ sweep = 0; test session logged out. Non-destructive on auth change-password by design (type-only ⇒ runtime identical; handler regenerates session mid-request). |

---

## Session log

### Session 1 — 2026-06-05
- Read plan; verified every assumption against the build (see Findings).
- Created this tracking document (`docs/shared-contract-progress.md`).
- **Completed Phase 0** (Foundation) end-to-end and gated it green:
  - Created `shared/validation.ts` (moved from `middleware/validation-schemas.ts`) + barrel re-export.
  - Created `shared/contracts/{appointment,patient,payment}.contract.ts` (response-only; 4 schemas migrated).
  - Added `sendData` to `utils/error-response.ts`; added `@shared` to vite + both tsconfigs.
  - Migrated the 3 consumers; deleted `public/js/core/api.schemas.ts`.
  - Discovered + handled the `paymentHistory` import/state collision (alias rule, see Findings).
  - Gate: `typecheck:all` + `build` + `lint` all green.
- **Stopped after Phase 0** per user request.
- **Plan changed (user decision):** request bodies for contracted endpoints are now **fully enumerated →
  `z.infer` single source of truth** (hand-written `XxxBody` interfaces deleted), done incrementally and
  verified per-endpoint because they carry critical business values. Updated the plan file
  (`~/.claude/plans/make-a-comprehensive-well-distributed-codd.md`) and this tracker (see the RESOLVED
  Findings entry for the full method); amended the `validation-boundary-convention` memory to scope its
  old "loose + hand-written" rule to *non-contracted* routes only.
- **Next session: Phase 1 (payment)** — enumerate each payment endpoint's body via the 3-place trace, author
  contracts (looseObject + `z.infer` body/response), convert routes + consumers, then runtime-verify the real
  add-invoice / exchange-rate / delete-invoice flows.

### Session 2 — 2026-06-05
- **Completed Phase 1 (payment) code** end-to-end; user asked to "stop after phase 1" and to **not** run the
  full type-check until all phases are done — so the formal gate is **deferred**, replaced for now by an
  isolated `tsc --strict` assignability probe (passed).
- Authored `shared/contracts/payment.contract.ts` — 9 endpoints; 2 fully-enumerated request bodies
  (`updateExchangeRate`, `addInvoice`) → `z.infer` SSoT (route interfaces deleted), 9 net-new responses.
- Converted `routes/api/payment.routes.ts` (all 9 → `sendData`; contract `validate()` for the 2 bodies +
  delete params; removed inline schemas + `z`/`idParams`/`intId`/`dateString` imports).
- Converted consumers: `WorkComponent.tsx`, `PaymentModal.tsx`, `ExchangeRatesSettings.tsx`
  (`{ schema }` + contract-inferred types; deleted local `Payment` interface).
- **DISCOVERED + RESOLVED the cross-phase `looseObject` index-signature blocker** (see the ⚠️ CRITICAL
  Finding): `z.looseObject` infer carries `[k:string]: unknown`, so an `interface`-typed `sendData` arg won't
  compile. **Rule for all later phases: flip the data-source `interface` → `type` alias.** Did so for
  `PaymentRecord`, `WorkForInvoice`, `CreatedInvoice`, `WorkForReceiptResult`.
- Also fixed a latent `workid`-vs-`work_id` type-assertion mismatch in `getworkforreceipt` surfaced by the
  contract; widened WorkComponent's local `formatCurrency` to accept `null` currency (nullable DB columns).
- **Owed before merge** (carry to whoever runs the final gate): `npm run typecheck:all` + `build` + `lint`,
  and the runtime add-invoice / set-exchange-rate / delete-invoice critical-business checks.
- **Next session: Phase 2 (stand)** — 10 `validate()`; `routes/api/stand.routes.ts` ↔ `hooks/useStand.ts`
  (~20 `core/http` calls w/ inline `StandItem[]` generics). Watch the index-signature rule on every `sendData`.

### Session 3 — 2026-06-05
- **Completed Phase 2 (stand) code** end-to-end (gate deferred per the standing instruction — no typecheck
  until all phases done). User asked to continue through ALL phases, tracking after each.
- Added shared `timestampString` primitive (`shared/validation.ts`) for PG `timestamp` columns — the
  dual-side (server `Date` / client `string`) modeling problem Phase 1 never hit (see Findings).
- Authored `shared/contracts/stand.contract.ts` (22 endpoints; shared row schemas; 5 enumerated bodies; 7
  param sets; `createSale` response-only). Flipped 7 query row `interface`→`type` in `stand-queries.ts`.
- Converted `stand.routes.ts` (all payload handlers → `sendData`; void handlers keep `sendSuccess(null)`; the
  10 `validate()` → contract `body`/`params`; removed inline schemas + `z`/`idParams` imports).
- Converted consumers: `useStand.ts` (response types → contract re-exports, `{ schema }` on 13 reads),
  `ItemFormModal.tsx` (`VisionScanResult` → contract + `{ schema }`), `POSItemSearch.tsx` (`{ schema }`).
- New cross-phase findings recorded: `timestampString`, the TS2367 untyped-body rule, the `{ schema }`
  generic-not-inferred clarification, and the POS-sale-stays-service-validated decision.
- **Owed before merge**: `typecheck:all` + `build` + `lint`, and the runtime POS critical-business checks.
- **Next: Phase 3 (work)** — 11 `validate()`; `routes/api/work.routes.ts` ↔ `WorkComponent.tsx` + visit/
  diagnosis screens. Watch index-sig flips, `timestampString` for any `timestamp` column, TS2367 on typed bodies.

### Session 3 (cont.) — 2026-06-05 — Phase 3 (work)
- **Completed Phase 3 (work) code** (gate deferred). Route `work.routes.ts` (19 endpoints, 11 `validate()`) +
  5 consumers (`WorkComponent`, `NewWorkComponent`, `Diagnosis`, `TransferWorkModal`, `loaders.ts`).
- Authored `work.contract.ts` — minimal responses (container + stable id) + relocated bodies (2 small →
  `z.infer` SSoT, 6 large → loose guard per caveat). Flipped 6 query `interface`→`type`.
- Extended `apiLoader` with an optional `schema` (forwarded to `fetchData`) — reused next phase.
- Left `GET /diagnosis/:workId` raw (un-enveloped null signal) — not contracted.
- New findings: minimal-responses/keep-generics for multi-consumer shapes; `apiLoader` schema plumbing; raw
  endpoint stays out of contract; large service-bound bodies relocate loose.
- **Owed**: gate + runtime (work CRUD/finish/transfer, diagnosis upsert incl. the raw-null GET signal).
- **Next: Phase 4 (patient)** — 13 `validate()`; `routes/api/patient.routes.ts` ↔ `loaders.ts` (TIGHTEN
  `patientSearch` — the actual N13 guard) + patient screens. `apiLoader` schema support is already in place.

### Session 3 (cont.) — 2026-06-05 — Phase 4 (patient)
- **Completed Phase 4 (patient) code** (gate deferred); user said to finish Phase 4, mark progress, and stop.
- **Tightened `patientSearch`** (the named N13 goal): rows now assert `{ person_id, patient_name }`. Auto-applies
  at the loader (already wired) + `PatientManagement`. Flipped `PatientSearchResult` → `type`.
- Authored the full `patient.contract.ts` (28 endpoints + 3 shared param schemas). Introduced the **`anyArray`**
  flip-free array guard and the **`z.unknown()`** rich-single-object response convention (see Findings).
- Converted `patient.routes.ts` (21 payload handlers → `sendData`; 8 voids kept; 13 `validate()` → contract;
  removed inline schemas + `z`/`validation-schemas` imports). Flipped `TagOption`/`PatientTypeOption` → `type`.
- Wired `{ schema }` on the high-value N13 reads (search/phones/tag+type-options); long-tail screen reads left
  on server-side `sendData` validation (schemas exist; adopt `{ schema }` incrementally).
- **Owed**: gate + runtime (patient CRUD, search rows hold on real data, alerts/portal/photo-visibility/timepoint).
- **Phase 5 (aligner) NOT started** — stopped here per the user's request. 24 `validate()`;
  `routes/api/aligner.routes.ts` ↔ aligner pages; fold in `public/js/pages/aligner/aligner.types.ts`; includes
  `POST /api/aligner/payments` (which belongs to the aligner contract, not payment). `apiLoader` schema + the
  `anyArray`/`z.unknown()`/`timestampString` primitives are all in place for it.

### Session 4 — 2026-06-05 — Phase 5 (aligner) + FINAL GATE (rollout complete)
- **Completed Phase 5 (aligner) code** — authored `aligner.contract.ts` (30 endpoints; 6 canonical
  `z.object` row schemas folded out of `aligner.types.ts`; closed mutation responses; 5 param schemas;
  SSoT note/targetDate bodies + relocated loose service-bound bodies). Converted `aligner.routes.ts`
  (22 `sendData`, 11 voids kept, 24 `validate()` → contract, removed inline schema block + `z` import).
  **Folded `aligner.types.ts`** (6 types now contract-derived via `import type`+`export type`). Wired
  `{ schema }` on the read path across 8 consumers + the loader.
- **RAN THE DEFERRED FINAL GATE for all phases (1–5)** — the standing "don't type-check until all phases
  done" instruction was now satisfied. **Green: `typecheck:all` + `build` + `lint`.** Fixes the gate
  forced (all recorded in Findings): (1) **`sendData` `data: z.infer` → `z.input`** — the big one; the
  `timestampString` `Date`-input had been mistyped since Phase 2, invisible under the deferral (9 stand
  errors); (2) `uploadPdf.size` union + `timepointFolder.folder` nullable + `deleteWork.rowsAffected ?? 0`
  (small source-type truths); (3) the `export type { } from` local-scope gotcha in the fold (13 cascading
  errors from one root).
- **Runtime read-smoke (dev-parse active)** across all phases — all GET reads 200 on real DB data,
  including the live `timestampString`+`z.input` path (stand) and the **100-row tightened `patientSearch`**
  (the N13 fix holds on real data). No over-tight response fail-louds found.
- **ROLLOUT COMPLETE.** Remaining work owed before merge (per the per-phase deferral): the **write-path
  mutation** runtime checks (critical-business: money/works/aligner create-update-delete) — reads + the
  `sendData` dev-parse are verified, mutations are not yet exercised end-to-end. Per-row response
  tightening (`anyArray`/`z.unknown()` → modeled rows; strict `z.object` bodies to reject over-posting)
  remains the documented later hardening.

### Session 5 — 2026-06-05 — Wave 2 Phases 6–10 (lookup, appointment, expense, employee+staff, visit)
- Started Wave 2 (plan `~/.claude/plans/continue-planing-pure-engelbart.md`). User: run Phases 6→10
  continuously without an interim type-check, then stop; afterward asked to run the gate.
- **Phase 6 (lookup):** new `lookup.contract.ts` (6 response-only dropdown feeds, `looseObject({id})` /
  `looseObject({alert_type_id})`); converted `lookup.routes.ts` (`sendSuccess`→`sendData`); flipped
  `LookupItem`/`AlertType`/`ImplantManufacturer` → `type`; wired `{schema}` on `AddPatientForm` +
  `EditPatientComponent`.
- **Phase 7 (appointment):** **extended** `appointment.contract.ts` with 10 endpoints (relocated the 3
  loose bodies state/create/quick-checkin; `z.unknown()` for the rich webApps/create/quick-checkin payloads;
  closed `z.object` for the state echoes); converted `appointment.routes.ts` (8 `sendData`, 3 `sendSuccess`
  kept incl. the deliberately-unconverted `getDailyAppointments`); flipped `AppointmentDetail`/
  `AppointmentResult` → `type`; renamed `const appointment`→`createdAppointment` (import collision); wired
  `{schema}` on `AppointmentForm`/`EditAppointmentForm`/`PatientAppointments`.
- **Phase 8 (expense):** new `expense.contract.ts` (relocated query-filter + loose body; `anyArray`/
  `z.unknown()` responses); converted `expense.routes.ts` (all 8 → `sendData`); renamed `const expense`→
  `expenseRow`; wired `useExpenses` (list/categories/subcategories/summary) + `Expenses.tsx` (byId), both
  aliased `expenseContract`.
- **Phase 9 (employee + staff):** new `employee.contract.ts` (added the missing GET query schema; loose body;
  `{employees}`/`{positions}` containers) + `staff.contract.ts` (doctors/operators); converted both routes;
  flipped `Employee`/`position`/`StaffMember` → `type`; wired `AppointmentForm`/`EditAppointmentForm`/
  `NewWorkComponent`/`useAppointmentDoctors` (employees), `EmployeeSettings` (employees+positions, aliased),
  `DoctorFilter` (doctors), `NewVisitComponent` (operators).
- **Phase 10 (visit):** new `visit.contract.ts` (added `numericParam` GET query schemas on workId/visitId;
  loose add/update bodies, closed delete body; `anyArray`/`z.unknown()` responses); converted
  `visit.routes.ts` (5 `sendData`, 2 voids kept); renamed `const visit`→`visitRow`; wired `NewVisitComponent`
  (getWires/latestWires/visitById) + `VisitsComponent` (visitsByWork), aliased `visitContract`.
- **Gate (user asked mid-flight):** `npm run typecheck:all` → **green first try** (backend + frontend EXIT 0).
  No interface→type or `z.input` surprises (pre-empted). See the Wave-2 Findings entry.
- **Owed:** `build` + `lint` + runtime read/mutation smoke — deferred to the Wave-2 final gate (Phase 15).
- **Next: Phase 11 (settings + cost-preset).**

### Session 6 — 2026-06-05 — Wave 2 Phases 11–15 (WAVE 2 COMPLETE)
- Ran Phases 11→14 continuously, then the deferred final gate (Phase 15) — all green.
- **Phase 11 (settings + cost-preset):** new `settings.contract.ts` (relocated the 4 inline schemas
  bulkOptions/optionName/updateOption/restart — `restart`→`z.infer` SSoT; db-config bodies stay dynamic
  `looseObject`) + `cost-preset.contract.ts` (Group B response-only; `getPresets` row-id `looseObject({preset_id})`
  → flipped `CostPreset`→`type`). Wired `{schema}` on CostPresetsSettings/ViewPatientInfo (cost-presets),
  GeneralSettings/CalendarTimesSettings/SimplifiedCalendarPicker (options), DatabaseSettings (config+export).
- **Phase 12 (file-explorer + photo-editor):** new contracts; EXCLUDED the 2 content streams + photo `/render`
  (202+SSE, keeps inline body, shares `personIdParams`). FileListing/FileEntry → `z.unknown()`/`anyArray` (no
  service-type flips). Converted photo `/photo-dates` raw `res.json`→`sendData`; `/prepare` discriminated result
  → `looseObject` w/ optional discriminants. Wired FileExplorer/WorkingFilesView/PhotoSessionDialog reads.
- **Phase 13 (Group-B remainder):** messaging/holiday/reports/video/media/utility/lookup-admin contracts;
  `sendSuccess→sendData` (wire-identical + dev-parse). **Fixed media's one raw `res.json`** (see the
  `sendData(null)` gotcha Finding → resolved as a 404). Wired the funnel reads (useMessageStatus RQ, holiday on
  AppointmentCalendar/HolidayEditor, statistics on StatisticsComponent/DailyInvoicesModal, Videos list/categories/qr);
  media/utility/lookup-admin = server dev-parse only.
- **Phase 14 (ROOT migration):** user-management (full `z.infer` bodies, folded the manual guards), email-api
  (config GET/POST + test-send migrated; `send-appointments` LEFT RAW — raw apiClient consumer; `/test` excluded),
  calendar (all 6 GETs; `looseObject` containers; `validate({query})` with `dateString`). Converted each consumer:
  dropped the dead `.success`-at-2xx checks + added `{schema}` (AppointmentCalendar/SimplifiedCalendarPicker/
  AdminUserManagement/EmailSettings).
- **Phase 15 final gate:** `typecheck:all`/`build`/`lint` green (1 fix: `lookup-admin createItem.id`→`z.unknown()`);
  runtime read-smoke all 200 + envelope verified live; found+fixed the `sendData(null)` media bug.
- **Owed before merge:** the write-path mutation runtime checks across all Wave-2 groups (reads + dev-parse
  verified; mutations not yet exercised end-to-end — same deferral as Wave 1).

### Session 7 — 2026-06-05 — Write-path mutation smoke (the owed item) + CLAUDE.md paradigm
- **Ran the deferred write-path mutation verification** live against the dev server (port 3101,
  `NODE_ENV=development` so `sendData` dev-parse is active), authenticating with the staff session +
  `GET /api/csrf-token` double-submit token echoed in `x-csrf-token`. Method = clearly-marked
  (`ZZZ_…`) create → verify-persisted-row → delete, self-cleaning.
- **8 domains PASS** (no false 400, persisted rows kept every field, no client/dev-parse fail-loud):
  1. **expense** create→delete — kept `currency:"USD"` (not defaulted to IQD) + optional cat/subcat/note.
  2. **stand POS** category→item→restock(+50)→adjust(−10)→sale(−3)→void→soft-delete — stock math exact
     (100→150→140→137), sale totals correct (3×10=30, profit 15, change 20), `timestampString` `date_added`
     transform exercised, `standSaleWithItemsRow` parsed.
  3. **patient** create→delete (folder removed; cascade removed the attached work — no orphan).
  4. **work** create (needs `currency` — service-bound loose body, see non-bug below).
  5. **payment** `addInvoice` (InvoiceID persisted `amount_paid/usd_received/change` exactly, verified via
     `getpaymenthistory`) + `deleteInvoice` (`rowsAffected:1`) + `updateExchangeRate` (idempotent re-set 1540).
  6. **appointment** create→delete (rich `z.unknown()` response preserved).
  7. **employee** create→delete. 8. **aligner-doctor** create→delete. 9. **cost-preset** create→delete
     (amount 99 persisted). Leftover sweep (ZZZ markers) = 0 across patients/doctors/employees/stand.
- **Two non-bugs surfaced (NOT contract regressions):** (a) `POST /addwork` with only `{person_id,dr_id,
  type_of_work}` hits DB `ck_works_cur` — the contract's loose service-bound body intentionally enforces only
  the 3 ids; `WorkService` forwards `currency` (UI sends it), so the minimal test payload was the issue, not
  the contract. (b) `deletework` is `router.delete` (DELETE-with-body), not POST.
- **CLAUDE.md updated** — added the `### Shared API contracts` Critical-patterns section (**MANDATORY for new
  endpoints**, "NEVER hand-write a parallel `XxxBody`/response interface for a contracted endpoint → fully
  enumerate to `z.infer`"), fixed the stale `core/api.schemas.ts` funnel reference (deleted Phase 0) →
  `shared/contracts/*`, and corrected the folded aligner-types note.
- **Remaining (lower priority):** other Wave-2 mutation domains not individually smoked (visit, settings
  options, user-management, lookup-admin, file/photo folder ops, messaging, video) — same proven plumbing;
  plus the documented later hardening (`anyArray`/`z.unknown()`→modeled rows; strict bodies) and repo hygiene
  (the whole rollout is still **uncommitted** on `main`; no CI gate enforcing `typecheck:all`; no test framework).

### Session 8 — 2026-06-05 — 100% body-enumeration + 4 NEW contracts + their mutation smoke
- Working tree at session start: ALL `interface *Body` in `routes/` deleted → contract `z.infer` SSoT
  (the 100%-enumeration pass), **plus 4 brand-new contracts** for the previously-uncontracted enveloped/raw
  staff routes: `auth.contract.ts`, `chair-display.contract.ts`, `template.contract.ts`, `whatsapp.contract.ts`
  (eslint lock-in rule added to forbid re-introducing `interface *Body`). `typecheck:all` was green; the
  **runtime mutation smoke of these 4 was OWED** (server hadn't booted in-sandbox).
- **Ran the owed mutation smoke** (user got the dev server up: Express :3101, Vite :5273, NODE_ENV=development
  so `sendData` dev-parse is live). `typecheck:all` re-run → **EXIT 0** (backend + frontend). Auth via staff
  session + `GET /api/csrf-token` echoed in `x-csrf-token`. Results (see Verification log row "100%-enum + 4
  NEW contracts"): **all 4 contracts PASS.**
- **Two of the four CHANGE runtime behaviour** (wired to `validate({ body })`) and were tested as real
  boundaries: **chair-display** (`patient-loaded`/`patient-cleared` — public + CSRF-skipped sendBeacon, 202;
  the `chairId` string|number union + required `personId` both verified — valid passes, malformed → 400) and
  **whatsapp** (`send-receipt`/`send-appointment`/`sendmedia`/`sendmedia2` — `z.coerce.number`, required
  fields, and the `prog` `z.enum(['WhatsApp','Telegram'])` all enforced; valid bodies pass validate then fail
  safe at the not-ready WhatsApp client / fake paths — **no real messages sent**; confirmed `sendmedia2`'s
  `validate()` runs *after* `multer upload.none()`).
- **Two are type-only** (NOT wired to `validate()`, contract = handler-generic SSoT, runtime provably
  unchanged): **template** — got a genuine DB create→verify(16 fields exact)→partial-update→delete→404
  round-trip anyway (proves the contract-typed handlers persist every field; partial update preserved the
  un-sent `description`); **auth** — exercised both `ChangePasswordBody` fields via the 401/400 error paths
  (non-destructive: a real password change is unwarranted for a type-only contract and would regenerate the
  session mid-request), confirmed `Admin/Yarmok11` still logs in (password un-mutated).
- **Minor doc-drift noticed (not a bug):** `template.contract.ts`'s `saveHtml` doc-comment says
  `PUT /api/templates/:templateId/html`, but the actual route is `POST /:templateId/save-html` (the body shape
  `{ html: string }` is correct). Harmless (type-only, not validate-wired) — fix the comment on next touch.
- **Self-cleaning verified:** ZZZ_SMOKE template leftover sweep = 0; test session logged out; temp cookie/token
  files removed.
