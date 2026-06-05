# Finish the shared-contract rollout to 100% — client wiring, response modeling, params/query, lock-in

## Context

The `shared/contracts/*` rollout (29 contracts; tracker `docs/shared-contract-progress.md`) hit its
headline milestone — **zero hand-written `interface *Body` in `routes/`; every request body enumerated to
`z.infer`**, mutation-smoked through Session 8 — and that body tier is genuinely done. But "100% wired"
is **not** true across the whole request+response surface. A fresh audit of the (now fully committed,
clean) tree confirms three open tiers:

1. **Client `{ schema }` wiring is partial.** 263 `fetchJSON` reads exist in `public/js`; ~120 funnel
   calls pass a `schema`. ~140 staff-app reads have **no client-side runtime guard** — and the client
   schema is *the only fail-loud guard in prod* (the server `sendData` parse is dev-only). Zero-schema
   examples confirmed on disk: `GridComponent.tsx`, `useWhatsAppAuth.ts`, `Navigation.tsx`,
   `services/appointment.ts`.
2. **Responses are deliberately loose** — **103** `z.unknown()`/`anyArray`/`z.array(z.unknown())`
   occurrences across 19 contracts (heaviest: `aligner` 16, `patient` 10, `file-explorer`/`expense` 9,
   `video`/`reports` 7, `calendar` 6, others 1–5). Documented "later hardening."
3. **Request params/query are still hand-written** — **33** local `interface *Params|*Query|*Filters`
   in route files (e.g. `reports.routes.ts` ×4, `template-api.ts` ×3, `expense.routes.ts` ×2,
   `employee.routes.ts` ×2, `calendar.ts`, `whatsapp.routes.ts`).

**Goal:** close all three to true 100%, wire client schemas on reads + meaningful mutations, and **lock it
in** so it can't silently regress.

**Locked scope decisions (user):** Responses → **Full model + verify**. Client wiring → **Reads +
meaningful mutations**. Params/query → **Full fold**. Lock-in → **ESLint rule(s) + npm `gate` script + a
net-new GitHub Actions workflow**. Delivery → **plan-only**: this session implements the refined plan +
the **Phase 0 measurement scaffold** (non-failing) and stops; the user drives each later phase in its
own session.

## Verified ground truth (refinements over the draft)

- **Tree is clean / already committed** (branch `claude/refine-local-plan-Qfp1H`). No "commit baseline
  first" step needed.
- **No CI today** — `.github/workflows/` is empty, so the gate workflow is the repo's first. `scripts/**`
  is eslint-ignored, so `scripts/contracts-dod.mjs` won't trip lint.
- **The funnel & loader plumbing already exist exactly as needed:** `public/js/core/http.ts` →
  `FetchOptions.schema?: ResponseSchema` → `validateResponse` (fail-loud at `http.ts:161`);
  `router/loaders.ts#apiLoader` forwards `schema?` to `fetchData` (`loaders.ts:79,214`). Nothing to build
  here — only to *use*.
- **Existing lock-in to model on:** `eslint.config.js` `routes/**` `no-restricted-syntax` selector
  `TSInterfaceDeclaration[id.name=/Body$/]` (extend it); `public/**` bare-`fetch()` ban with inline-disable
  escape hatch (model `require-schema-on-reads` on it).
- **Two corrections to the draft, important for sequencing:**
  - *Aligner responses are not a drop-in.* Its 6 row schemas already exist but as **`z.object`** (folded
    for *types only*, per the tracker). Plugging them into the array responses would **strip** the
    long-tail fields consumers read via `*WithAliases`/`Pick<>`. Tightening aligner = convert those rows to
    `looseObject` (only where long-tail is read) + verify — not a one-line plug-in.
  - *Some zero-schema reads aren't contracted at all.* `useWhatsAppAuth.ts` reads `/api/wa/initial-state`
    & `/api/wa/qr` — **flat, un-enveloped passthrough** with no contract response. Wiring those means
    authoring a flat response schema first (in `whatsapp.contract.ts`) **or** documenting them as a raw
    exception. Client-wiring (Phase 1) therefore splits into *contracted reads (just add `{schema}`)* vs
    *uncontracted reads (author small response first, or mark raw)*.

## Shape of the change

```
Phase 0  scaffold (THIS SESSION) ── scripts/contracts-dod.mjs (report-only, exit 0)
              │                       npm run contracts:check ; baselines → tracker
              ▼
Phase 1  client {schema} on READS ───────┐  (cheap; guards auto-upgrade when P3 tightens)
Phase 2  client {schema} on meaningful MUTATIONS
              ▼
Phase 3  FULL RESPONSE MODELING + verify ─┘  (the big one; 103 loose slots; per-read runtime verify)
              ▼
Phase 4  FULL params/query FOLD ── contract schemas + validate() + z.infer ; delete 33 interfaces
              ▼
Phase 5  LOCK-IN ── flip DoD script to FAIL ; extend ESLint ; add require-schema-on-reads
                    ; npm "gate" ; .github/workflows/gate.yml ; docs

Each phase ends behind:  typecheck:all + build + lint + contracts:check  + runtime smoke on :3101
Work PER CONTRACT GROUP within a phase so runtime verification stays local.
```

## Definition of Done

| # | DoD | Check |
|---|-----|-------|
| D1 | No hand-written request interfaces in `routes/` | `grep -rEn "interface [A-Za-z]*(Body\|Params\|Query\|Filters?)\b" routes/` (excl. `express-session` declare-merge) = **0** (baseline 33) |
| D2 | No loose responses except documented exceptions | `grep -rE "z\.unknown\(\)\|anyArray\|z\.array\(z\.unknown" shared/contracts/` = **allowlist only** (baseline 103) |
| D3 | Every staff-app read carries a client schema | `require-schema-on-reads` ESLint rule passes (inline-disable only on documented raw/null/stream reads) |
| D4 | Meaningful-mutation responses carry a client schema | covered by D3 scope + manual checklist |
| D5 | Gate green | `typecheck:all` + `build` + `lint` + `contracts:check` exit 0 (locally **and** in the GH Actions workflow) |
| D6 | Runtime-verified | every newly-tightened/wired read returns 200 on real data; Session-8 mutation smoke unchanged |

## Reusable mechanics (exist — reuse, don't reinvent)

- **Funnel** `public/js/core/http.ts` — pass `{ schema: <a>.response }` **and keep the explicit generic**
  (`{schema}` does NOT infer it — tracker finding): `fetchJSON<XResponse>(url, { schema: x.response })`.
- **Loaders** `router/loaders.ts#apiLoader` — already forwards `schema` to `fetchData`.
- **Server** `utils/error-response.ts#sendData(res, <a>.response, data)` — dev-parses; `data` typed
  **`z.input<S>`** (matters for transform primitives).
- **Shared primitives** `shared/validation.ts`: `timestampString` (PG `timestamp`, Date/string dual-side),
  `anyArray`, `intId`, `dateString`/`optionalDateString`, `numericParam`. Date-only cols → plain `z.string()`.

## Critical risk patterns (from the tracker Findings — apply, don't re-learn at the gate)

- **looseObject index-signature:** a query `interface`-typed `sendData` source won't assign to a
  `looseObject` response → flip the source `interface`→`type` (grep `extends`/declare-merge first).
- **Nullable vs optional:** a column always returned (as `null`) is `.nullable()`, NOT `.optional()` —
  `.optional()` fail-louds on parse. #1 false-loud cause when tightening responses.
- **Preserve long-tail:** keep `z.looseObject` (not `z.object`) for rows whose unmodeled fields the UI
  reads — `core/http` returns the *parsed* payload and `z.object` strips unknown keys. (This is exactly the
  aligner-row trap above.)
- **Transport check before tightening:** raw whatsapp `apiClient` consumers read top-level fields (don't
  unwrap) — leave raw. Verify funnel-vs-apiClient per consumer.
- **`sendData(res, schema, null)` ≠ `{data:null}`** — null payload is omitted from the envelope, so the
  funnel returns the whole envelope (truthy). A "soft not-found" must be a 404 the consumer catches, not
  `sendData(null)`.
- **Params/query coercion writeback:** `validate({params/query})` coerces + writes back to
  `req.params`/`req.query`. Trace each handler's read; turning silent-NaN into a 400 is desired but must not
  400 a legit caller. Form `<select>` empties → `z.preprocess(v=>v===''||v==null?undefined:v,
  z.coerce.number().int().optional())`.
- **Out of scope (leave raw, document inline):** `GET /api/diagnosis/:workId` (literal-null signal),
  PDF/stream/`res.send`/blob/beacon endpoints, the patient portal (`public/js/portal/*`), the raw whatsapp
  `apiClient` send responses, and the flat `/api/wa/initial-state` & `/api/wa/qr` reads unless a flat
  response schema is authored for them.

---

## Phase 0 — Baseline + measurement scaffold (THIS SESSION; non-failing)

1. Add **`scripts/contracts-dod.mjs`** — prints D1/D2/D3 counts (the three greps above) against a small
   committed allowlist/baseline, and **exits 0** (reporting only). Structure it so Phase 5 flips a single
   `STRICT` flag to make it exit non-zero on regression past the allowlist.
2. Add **`npm run contracts:check`** → `node scripts/contracts-dod.mjs` in `package.json`.
3. Record current baselines (D1=33, D2=103, D3≈140 unguarded reads) in
   `docs/shared-contract-progress.md` under a new "Tier completion" section.
4. **Do NOT** add the failing ESLint rules or the GH workflow yet (they'd break before the work is done).
5. Gate: `npm run contracts:check` exits 0; `npm run lint` unaffected (`scripts/**` is eslint-ignored).
   Commit. **Stop here** — subsequent phases are user-driven sessions.

## Phase 1 — Client `{ schema }` on all reads (Tier 1a) — *later session*

- For each staff-app consumer, add `{ schema: <action>.response }` to every **contracted** read and align
  the explicit generic to the contract `z.infer`. Loader reads wired via `apiLoader`'s `schema`.
- **Split the work:** (a) contracted reads → just wire; (b) reads whose endpoint isn't contracted yet
  (flat `wa` reads, any other passthrough) → either author a small flat response schema in the relevant
  contract, or add a documented inline-disable as a raw exception.
- Representative files: `GridComponent.tsx`, `Navigation.tsx`, `CompareComponent.tsx`,
  `UniversalHeader.tsx`, `ViewPatientInfo.tsx`, `slideshow/PatientSlideshow.tsx`, `useWhatsAppAuth.ts`
  (raw/flat — handle per split), `WhatsAppAuth.tsx`, `services/appointment.ts`, `GlobalStateContext.tsx`,
  `TemplateManagement.tsx`, `photo-editor/*`, `Diagnosis.tsx` (skip the raw-null read), + remaining partials.
- Apply the **alias-on-collision** rule (`…Contract` suffix). Document & inline-disable the legit
  raw/null/stream reads.
- Gate per group; reads already 200, so adding `{schema}` against the existing (possibly loose) schema is a
  safe no-op guard that auto-upgrades when Phase 3 tightens it.

## Phase 2 — Client `{ schema }` on meaningful mutations (Tier 1b) — *later session*

- Wire `{ schema: <a>.response }` on mutations whose returned payload the UI consumes (created/updated ids
  & rows): payment `addInvoice` (InvoiceID), aligner `createSet`/`createBatch`, template create
  (template_id), work create, stand sale, etc. Skip `{success}`-only acks.
- Where a consumed mutation response is still loose, defer its modeling to Phase 3.

## Phase 3 — Full response modeling + verify (Tier 2 — the big one) — *later session(s)*

- For each of the **103** loose slots, replace `z.unknown()`/`anyArray`/`looseObject` with a modeled row
  schema covering **every field the consumer reads** (trace the consumer): flip source query/service
  `interface`→`type` as needed, `.nullable()` on always-present-nullable columns, `timestampString` on
  `timestamp` columns, **keep `looseObject` (not `z.object`) where long-tail fields are read**.
- Group-by-group, heaviest first: **`aligner` (16; convert the folded `z.object` rows → `looseObject` where
  consumers read aliased fields, then plug into responses)** → `patient` (10) → `file-explorer`/`expense`
  (9) → `video`/`reports` (7) → `calendar` (6) → `appointment`/`settings`/`messaging`/`visit`/`lookup-admin`
  (5) → the 1–4 stragglers.
- **Runtime-verify EACH modeled read on `:3101`** (real DB → 200, no fail-loud). This is where
  nullable-vs-optional bites; budget a verify+fix loop per group.
- Keep a small **documented allowlist** of responses that legitimately stay loose (pure passthrough streams,
  the genuinely-dynamic settings db-config maps, service shapes with no stable schema) — each an inline
  comment + a D2 allowlist entry in `scripts/contracts-dod.mjs`.

## Phase 4 — Full params/query fold (Tier 3) — *later session*

- Author `params`/`query` schemas in each contract (reuse existing standalone param schemas like
  `personIdParams`/`setIdParams`), wire `validate({ params, query })`, type handlers
  `Request<z.infer<typeof a.params>, …, …, z.infer<typeof a.query>>`, and **delete the 33 local interfaces**
  (`StatisticsQuery`/`YearlyStatisticsQuery`/`MultiYearStatisticsQuery`/`DailyInvoicesQuery`,
  `TemplateIdParams`/`WorkIdParams`/`TemplateQueryParams`, `ExpenseQueryParams`/`ExpenseFilters`,
  `EmployeeQuery`/`EmployeeParams`, `CalendarQueryParams`, `SendByDateQuery`, …).
- Trace each handler's `req.params`/`req.query` reads for the coercion-writeback risk; verify no false-400
  on the live reads (keep behavior — don't 400 a field the handler treated as optional).
- Keep `declare module 'express-session'` and any non-request interfaces.

## Phase 5 — Lock-in + final gate + docs — *later session*

- **ESLint:** extend the `routes/**` `no-restricted-syntax` selector to
  `id.name=/(Body|Params|Query|Filters?)$/` (one selector). Add a tiny local plugin
  `require-schema-on-reads` (inline `plugins: { local: { rules: {…} } }` in `eslint.config.js`, or a small
  imported module) that flags `fetchJSON(`/`apiLoader(` calls whose options arg lacks a `schema` property,
  with an inline-disable escape hatch (mirrors the bare-`fetch()` ban). Lands **last**, once reads are wired.
- **DoD gate:** flip `scripts/contracts-dod.mjs` `STRICT` → exit non-zero when D1/D2/D3 regress past the
  allowlist baseline.
- **npm `gate`:** add `"gate": "npm run typecheck:all && npm run lint && npm run contracts:check && npm run build"`.
- **GitHub Actions (net-new):** add `.github/workflows/gate.yml` — on `pull_request` + `push`, `npm ci`
  then `npm run gate`. (First workflow in the repo; keep it single-job, Node version from `package.json`.)
- **Docs:** update `CLAUDE.md` `### Shared API contracts` (reads MUST carry `{schema}`; responses MUST be
  modeled; params/query MUST be contract-derived) + `docs/shared-contract-progress.md` (Tier-completion +
  verification log) + the `shared-contract-rollout` memory.
- Final full gate + a full read-smoke pass on `:3101` + the Session-8 mutation smoke re-run.

## Verification

- **Per-phase gate:** `npm run typecheck:all`, `npm run build`, `npm run lint`, `npm run contracts:check`.
- **Runtime (live dev server `:3101`, `NODE_ENV=development` so the `sendData` dev-parse is active):** login
  (`Admin`/`Yarmok11`) + `GET /api/csrf-token` → `x-csrf-token`; hit every newly-modeled/newly-wired **read**
  and assert 200 (no fail-loud); re-run the Session-8 self-cleaning **mutation** smoke (create→verify→delete)
  for money/works/aligner. WhatsApp send endpoints stay safe (client-not-ready short-circuits; fake phones).
  Delete test rows; `ZZZ_` leftover sweep = 0. After any Playwright use, delete its screenshots.
- **Final:** all six DoD checks pass; `contracts:check` is wired into `gate` and the GH workflow and fails on
  regression.

## Risks & mitigations

- **Response tightening fail-louds on edge data (highest risk).** Model only consumer-read fields +
  `looseObject` long-tail; `.nullable()` discipline; runtime-verify EACH read on real data before moving on.
  Aligner specifically: convert its folded `z.object` rows to `looseObject` before plugging into responses.
- **Params/query coercion writeback breaks a handler.** Trace each handler's `req.params/query`; verify live;
  preserve optionality.
- **`require-schema-on-reads` false positives.** Inline-disable escape hatch (documented), exactly like the
  bare-`fetch()` ban; the rule lands LAST.
- **Net-new CI on the repo.** Keep `gate.yml` minimal and mirror the local `gate` script so behavior is
  identical in both places; introduce it only in Phase 5 after the tree is green.
- **Scale / partial-merge.** Per-group phases each behind the gate; the DoD script makes remaining work
  measurable at any point; delivery is plan-only so each phase is a user-driven, individually-gated session.