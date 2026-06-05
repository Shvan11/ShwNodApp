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
