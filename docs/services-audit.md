# `services/` audit record

**Status:** three sweeps done (2026-08-13, 2026-08-31, **2026-09-15 — batch 3, the re-review**).
This file is the in-repo record.
**Scope:** `services/` — 19 domain subdirectories, the largest part of the backend.
**Companion:** `docs/backend-audit-tracker.md` covers everything OUTSIDE `services/` and is far
more detailed (86 findings + a 2026-09-09 re-review, each written up in place).

> **Why this file exists.** It was written on **2026-09-12** to close finding **R9(e)** of the
> backend audit: the two `services/` sweeps happened in working sessions and their per-finding
> reasoning was never committed, so the repo could not tell a future reader what had been checked
> or what had been looked at and deliberately left alone. That is the failure mode this file
> fixes. **Read it as a coverage map and a decision log, not as a reproduction of the sweeps** —
> the batch-1/batch-2 per-finding write-ups are gone, and what follows is the durable residue,
> re-verified against the code on 2026-09-12. Anything below that names a file or behaviour was
> confirmed to still be true on that date.

---

## Batch 1 — dir-by-dir sweep (2026-08-13, closed 2026-08-14)

A bug + dead-code pass over every subdirectory. Two structural outcomes survive in the tree:

**1. Directory reorganization — 5 directories folded into their real owners.** The current layout
(`ls services/`) is the result; the names below no longer exist and should not be reintroduced:

| Was | Now | Why |
|---|---|---|
| `services/state/`, `services/email/` | `services/messaging/` | `messaging/` owns every channel *and* the WhatsApp runtime state (`messageState` / `stateEvents` / `StateManager`) |
| `services/config/` | `services/settings/` | Backs the Settings screen — distinct from the root `config/` boot config behind `@config/*` |
| `services/core/` | `utils/` | Cross-cutting helpers were not a domain service |
| `services/authentication/` | `services/google-contacts/` | It was only ever that provider's OAuth |

`services/sync/cdc/` was examined and **deliberately NOT flattened** — the sink/engine split is
load-bearing (see `docs/sync-cdc.md`).

**2. The WhatsApp lock reaper.** The stuck-lock reaper in `services/messaging/StateManager.ts` was
found to be provably dead code. It was replaced with **fencing tokens**: `acquireLock` mints a
token identifying that particular grant, `releaseLock` ignores a release carrying a stale one, and
`reportStuckLocks` is now **warn-only** — it never force-releases. That is what makes a slow holder's
eventual release a safe no-op instead of a release of somebody else's lock. Do not "simplify"
`releaseLock` back to a keyed release.

## Batch 2 — CDC + the 6 integrations (2026-08-31)

Swept `services/sync/cdc/` plus the six external integrations. **31 findings, all fixed.** The
schema half shipped as `migrations/pg/1787000000000_cdc-capture-clock-timestamp.sql` (+ its Supabase
mirror), applied to both databases and verified; that migration is recorded in the `pgmigrations`
ledger (applied 2026-08-31) and its rule — `change_log.changed_at` uses `clock_timestamp()`, never
`now()` — is documented in CLAUDE.md because reverting it silently drops changes.

### Deliberate non-fixes — both still live, both now annotated in code

Two findings were raised, understood, and **left as they are on purpose**. Each call site carries an
`AUDIT DECISION` comment pointing here (added 2026-09-12 — before that the decisions existed only in
a chat log, which is how a later reader "fixes" them and breaks a working install):

1. **Google Drive requests the full `auth/drive` scope**, not `drive.file`
   (`services/google-drive/google-drive-client.ts#getAuthUrl`). Narrowing looks right and is wrong
   here: `drive.file` only ever sees files the app itself created, while `GOOGLE_DRIVE_FOLDER_ID`
   points at a folder created **by hand** in the clinic's Drive — `files.get` on it would fail and
   `getRootFolder()` would break on the next reconnect. Narrowing needs the app to own its root
   folder first.
2. **Uploaded PDFs are shared as anyone-with-the-link** (`createShareableLink`, `type: 'anyone'`).
   This was raised as a finding and **the clinic explicitly excluded it from the fix list** — it is a
   product decision about how aligner PDFs reach labs and patients. Provenance matters here: the
   record is "the owner decided", not "an engineer reasoned it was fine". Ask before changing it.

---

## What this record does NOT cover

- **Per-finding detail for the 31 batch-2 findings and batch 1's individual bugs.** Not recoverable;
  the fixes are in git history around those dates.
- ~~**A third sweep.**~~ **Done — see Batch 3 below (2026-09-15).** The prediction in this bullet
  held: the re-review found a live data-integrity failure the first two sweeps' own remediation
  code had made invisible.
- **`services/messaging/whatsapp.ts` and `services/database/queries/aligner-queries.ts` as structural
  problems** — they were logged as R9(c) in the backend tracker, and **closed there in session S2
  (2026-09-13)**: `aligner-queries.ts` (2,159) became seven table-scoped modules, and
  `whatsapp.ts` (3,294 → 2,501) shed its types, `ClientStateManager`, `EnhancedCircuitBreaker` and
  the LocalAuth-profile filesystem helpers. The `WhatsAppService` class core (client lifecycle +
  batch-send engine) was deliberately left whole — see the tracker for why.

---

# Batch 3 — the re-review (2026-09-15)

The sweep the two bullets above said was missing. Scope: all 19 subdirectories (~39,600 lines),
with three deliberate priorities — (a) code written **after** the first two sweeps and therefore
never audited at all (the seven `aligner-*-queries` modules and seven `Aligner*Service` modules
created by the backend audit's session S2 on 2026-09-13), (b) batch 1's and batch 2's own
**remediation** code, and (c) invariants the backend audit established later than the `services/`
sweeps (`moneyInt` sign, `sendError`, the contract rules, the date gotchas).

**Every claim below was verified against the live local database and the Supabase mirror**, not
read off the code alone. Where a check came back clean that is recorded too — a verified negative
is the part of an audit that stops the next one re-deriving it.

## 🔴 F1 — the failover mirror is 162 rows behind, and every mechanism that should have said so is broken

Four separate defects compose into one failure. They are listed apart because they need separate
fixes, but the reason this went unnoticed for a week is that each one hides the next.

### F1a — the divergence itself

A full row-count diff of all **73 cdc-captured tables** (59 are identical):

| table | local | mirror | missing |
|---|---|---|---|
| `message_status_history` | 15,944 | 15,889 | 55 |
| `time_point_images` | 23,676 | 23,644 | 32 |
| `appointments` | 70,263 | 70,240 | 23 |
| `invoices` | 31,330 | 31,316 | 14 |
| `works` | 7,716 | 7,706 | 10 |
| `visits` | 35,406 | 35,397 | 9 |
| `expenses` | 4,313 | 4,308 | 5 |
| `time_points` | 3,611 | 3,607 | 4 |
| `patients` | 6,826 | 6,823 | 3 |
| `work_items`, `work_item_teeth` | | | 2 each |
| `stand_sales`, `stand_sale_items`, `stand_stock_movements` | | | 1 each |

The missing rows are **not** a drain backlog — they are not in `change_log` at all. They cluster in
one window: every missing `works` row is `work_id` 12891–12909 (contiguous odd ids) with
`updated_at` between **2026-09-08 15:46 and 21:16**; 21 of the 23 missing appointments were written
2026-09-08 15:06–20:57; missing patients 7821/7823/7825 likewise. That is a **capture blackout**.

### F1b — a blackout is unrecoverable by design, and nothing recovers from it anyway

`cdc_capture()` inserts nothing at all while `cdc_sink_control.enabled = false` (verified in the
function body: `IF EXISTS (SELECT 1 FROM cdc_sink_control c WHERE c.sink = s AND c.enabled)`). There
is no catch-up scan anywhere, so a write made during an off window is gone from the mirror
permanently. The `stale` flag exists to say exactly this — "full reload required".

### F1c — any second process can switch capture off for the live service

`startCdc()` calls `disableSinkCapture()` for a sink whose env flag isn't the string `'true'`, and
`cdc_sink_control` is a **row in the shared database**, not process-local state. So a `tsx` one-off,
a second checkout, a test run, or a differently-configured boot turns capture off for every other
process pointing at that database — including the live Windows service. The engine header documents
capture being decoupled from *drainer* lifetime; it does not account for the control row being
shared across *installations*.

### F1d — and the next normal boot erases the evidence

`CdcEngine.start()` runs

```ts
await this.setControl(true, { stale: false, note: 'engine started' });
```

**unconditionally** — re-enabling capture, clearing `stale`, and overwriting the note, with no check
of what the previous state was. The live row today reads `enabled=t, stale=f, note='engine started'`:
nothing distinguishes it from a sink that has never had a problem. A restart is all it takes to turn
"full reload required" into "healthy".

### F1e — a lost parent poisons its children forever, at one warn line every 5 seconds

Seven changes have sat in `change_log` since 2026-09-12/14 and can never apply. Each is a child of a
row lost in the blackout:

```
visits 46667                  → works 12895        (missing)
invoices 43794                → works 12897        (missing)
appointments 99007            → patients 7823      (missing)
appointments 99153            → patients 7821      (missing)
message_status_history ×3     → appointments 99007 (itself blocked)
```

The engine's per-row `catch` defers them and retries on the next tick — every 5 s, forever —
logging a warn each time. **`logs/combined4.log` holds 13,987 identical
`deferred 3 change(s) … violates foreign key constraint` lines**, `combined3.log` another 3,424. The
Winston window is 5 MB × 5, so this noise is actively rotating real diagnostics out of existence.
The engine header names the circuit breaker as the backstop for persistent failures, but the breaker
trips on backlog **size**; a small permanently-stuck set never trips it and never self-heals.

### F1f — the status endpoint cannot see any of it

`GET /api/sync/supabase-status` reports `enabled / stale / note / backlog + reachable`. Today that is
`enabled=true, stale=false, backlog=7, reachable=true`. Nothing reports backlog **age**, a
permanently-stuck row, or row-count divergence, so the Settings panel shows a healthy sink while the
portal's serving source is missing a day of clinic data.

**Fix shape (all four are needed; the first two are the operational half):**
1. Reconcile: identify the missing rows per table and re-push them (bulk load under
   `app.cdc_origin='failover'`, per the runbook), then let the 7 deferred rows drain on their own.
2. Make `start()` refuse to clear `stale` — clearing it should be an explicit operator action
   (the kill-switch `UPDATE`), never a side effect of booting.
3. Make `disableSinkCapture()` safe for a shared DB — scope it, or make an env-disabled sink simply
   not drain rather than reach into the shared control row.
4. Add to `/supabase-status` (and the Settings card) the two numbers that would have caught this:
   oldest `change_log.changed_at` per sink, and a per-table count diff.

## 🟠 F2 — aligner payments bypass the locked balance guard the work-payment path was given

`payment-queries.addInvoiceWithBalanceGuard` exists precisely because a read-then-write overpayment
check races; its doc-comment spells out the `SELECT … FOR UPDATE` → re-sum → insert sequence and
says "this is the backstop that actually holds under concurrency".

The aligner twin writes the **same `invoices` table** with none of it:
`AlignerPaymentService.validateAndCreatePayment` pre-checks `paymentAmount > balance`, then
`aligner-payment-queries.createAlignerPayment` issues a bare `insertInto('invoices')` — no
transaction, no row lock, no re-check. Two concurrent payments both pass the pre-check and the set
is overpaid. It also never consults the **work** balance, so an aligner payment can push a work past
`total_required` without tripping the work-level rule that guards every other payment.

Live data is clean (only one work currently carries aligner invoices, nothing overpaid) — this is a
correctness gap for the multi-doctor aligner-lab deployments the product targets, not a present
corruption.

## 🟠 F3 — two aligner-batch paths turn ordinary business-rule rejections into 500s

`AlignerBatchService` maps query-layer `Error` messages onto `AlignerValidationError` (→ 400 with a
code) for **update, delete, manufacture and deliver** — but not for **create** or
**undo-manufacture**, which have no mapping at all. The route's `catch` therefore falls through to
`ErrorResponses.internalError`. Consequences at the front desk:

- creating a batch that exceeds the set's remaining aligners — the commonest data-entry mistake —
  returns *500 "Failed to create aligner batch"* and the actual message
  (`requested upper aligners (12) exceed remaining count (8)`) is discarded;
- the template-flag rules and `AlignerSet not found` do the same;
- undo-manufacture on a delivered batch returns a 500 instead of *"Undo delivery first."*

Note also that `mapBatchUpdateError` keys on `'Cannot update aligner batch: requested upper…'` while
`createBatch` throws `'Cannot **add** aligner batch: requested upper…'` — so the existing map would
not match even if it were wired in.

## 🟠 F4 — deleting an aligner batch or set orphans its doctor-portal announcements (5 live rows)

`doctor_announcements.related_batch_id` has **no foreign key**. `deleteBatchAutoAnnouncement` is
called only on UNDO_MANUFACTURE / UNDO_DELIVERY; neither `deleteBatch` nor `deleteSetWithBatches`
(where batches vanish by CASCADE) calls it. The doctor portal then keeps showing
*"Batch #N ready / delivered — &lt;patient&gt;"* with a working "View case" link for a batch that no
longer exists, until `expires_at` 30 days later.

Verified in the live DB — announcement ids 9, 16, 52, 53, 67 point at batches 691, 737, 747, all
deleted. (All five are now past `expires_at`, so nothing is displayed today.)

## 🟡 F5 — `deleteBatch` skips the set-row lock its three sibling writes take

`createBatch`, `updateBatch` and `updateAlignerSet` all `forUpdate()` the `aligner_sets` row before
touching `remaining_*` — `updateAlignerSet` carries a comment explaining the TOCTOU. `deleteBatch`
does not: it issues a relative `remaining_* = remaining_* + N` with no lock. Relative-vs-relative is
safe; relative-vs-**absolute** is not. `createBatch` reads `remU` under its lock, `deleteBatch`
commits `+2`, `createBatch` then writes the absolute `remU - consumed` and the restore is lost.

## 🟡 F6 — `aligner_sets.set_cost` is the one money field with no sign guard

`shared/validation.ts` states the rule for the whole schema — *"No money field in the schema
legitimately takes a negative"* — and exempts the two `numeric` columns from `moneyInt` only because
they legitimately take **decimals**. The exemption dropped the sign rule with it:
`createSet.body.set_cost` is `optNum` and `updateSet.body.set_cost` is `clearableNum`, both bare
`z.coerce.number()`, and there is no DB CHECK. `cost-preset.contract.ts` — the other `numeric` money
column — uses `.positive()`, so this is the only gap.

A negative set cost is not merely a wrong number: `PaymentStatus` reads **'Paid'** at zero paid
(`0 >= -500`), `Balance` goes negative, and `AlignerPaymentService` then rejects *every* payment as
exceeding the balance, so the set can never be paid at all.

The same field has no upper bound either: `numeric(10,2)` tops out at 99,999,999.99, and neither
contract carries a `.max()`, so a larger figure reaches PG as `22003 numeric_field_overflow` → 500.

## 🟡 F7 — the clinic's own name is compiled into ten patient-facing message bodies

CLAUDE.md opens by stating this is a commercial, multi-deployment product. Ten outbound-message
sites hardcode this clinic's identity with **no configuration override**:
`messaging-queries.ts` (6 reminder bodies, EN + AR) and `whatsapp-batch-plan.ts` (4). A second
deployment would send *"your appointment with Dr. Shwan orthodontic clinic"* /
*"عيادة د.شوان لتقويم الاسنان"* to its own patients. A configurable clinic name already exists
(Settings → General, the branding options row), so the wiring is available.

Distinguish these from the sites that already do it correctly — `email.ts`
(`this.config?.from_name || 'Shwan Orthodontics'`), `sms.ts` (`config.twilio.fromName || …`) and
`appointment-pdf-generator.ts` (`options.clinicName || …`) use the hardcoded string only as a
default, which is fine.

## 🟡 F8 — `getSmsMessages` has four defects in one function

`services/database/queries/messaging-queries.ts#getSmsMessages`, the Twilio reminder path:

1. The guard admits `dd` ∈ [0,3] but `eMes` only branches on `dd === 2`, so an appointment **today**
   or **three days out** is announced as *"Tommorow … is your appointment"*.
2. `aMes` is `null` outside `dd` ∈ {1,2}, producing `body = ''`; `sms.ts#sendSms` checks only
   `sms.to`, so Twilio is called with an empty body.
3. The recipient is built as `'+964' + phone`, ignoring `patients.country_code` — which the WhatsApp
   twin (`whatsapp-batch-plan.ts`) correctly honours via `candidate.countryCode || '964'`.
4. *"Tommorow"* / *"The day after tommorow"* is misspelled in both branches, patient-facing.

Impact here is nil — no SMS has been sent since 2023 (`max(app_date) where sms_sid is not null` =
2023-03-11) and only 3 patients are English-language — but the path ships and `whatsapp-batch-plan.ts`
is the correct implementation to converge on.

## 🔵 Lower-severity / latent

- **`createAlignerPayment` defeats `toDateOnly`'s pass-through guard.** It calls
  `toDateOnly(new Date(date_of_payment))`. `toDateOnly` passes `'YYYY-MM-DD'` through verbatim
  *precisely* so it is never round-tripped via `new Date()` (UTC midnight); wrapping it first
  bypasses that. Correct today only because `TZ=Asia/Baghdad` (+3). The sibling module's
  `updateBatchStatus` documents this exact trap and passes the string through — the S2 split missed
  this one. The same `new Date('YYYY-MM-DD')` shape recurs in `CalendarViewService` (week/month grid
  helpers), `AppointmentService`, `PaymentService` and `appointment-pdf-generator`; all are latent
  on a negative-UTC-offset host only.
- **Work-type ids duplicated outside the taxonomy SSoT.** `[19,20,21]` is hardcoded in
  `aligner-set-queries.ts:156` and `aligner-patient-queries.ts:27,88,164`, and `(1,2,11,19,20)`
  (= `ORTHO_WORK_TYPE_IDS`) in `appointment-queries.ts:172`, while `shared/treatment-taxonomy.ts`
  is the declared source of truth for work-type ids. Add an `ALIGNER_SET_WORK_TYPE_IDS` group and
  import it.
- **`remaining_upper_aligners` is off by exactly −1 on 9 of 22 template sets** (creation dates
  2026-02-10 → 2026-04-05; 0 of 106 non-template sets drift, so it is the template branch, not a
  race). The current arithmetic is self-consistent, so these rows predate or straddle a change in
  how the template aligner is counted. **Cause undetermined — needs its own look, and it is NOT
  evidence for F5.**
- **Dead exports:** `clearReadableCache` and `normalizeArabicFont` in `services/pdf/pdf-assets.ts`
  have zero references anywhere (the former's doc claims "used by tests"; no test imports it).
- **`aligner-note-queries.ts`:** a dangling unterminated JSDoc left by the S2 split — the stale
  *"Check if aligner set exists"* comment (the function moved to `aligner-set-queries.ts`) now
  swallows `createNote`'s doc block. Also `updateNote` / `toggleNoteReadStatus` / `deleteNote` each
  wrap a **single** statement in `withPgTransaction`, paying a BEGIN/COMMIT round trip for nothing.
- **`getDoctorsWithUnreadCounts` returns `doctor_email: null` unconditionally** — it never selects
  the column, but its return type declares `string | null`, so a consumer reading the field silently
  always gets null.
- **`SchemaMetaCache` loads each catalog query twice on first sight of every table** (`pkFor`,
  `generatedColsFor`, `isUpdatedAtTable` all populate the cache, then immediately refresh it because
  the `seen` set is empty). Harmless, three wasted catalog round trips per sink at boot.
- **`approve()`'s phase-2 apply runs outside any transaction, after the claim has committed**
  (`services/approvals/approval-service.ts`). That ordering is deliberate and correct against
  double-apply, and a thrown error is caught and recorded as `status='failed'` — but a **crash**
  between the claim commit and `action.apply()` leaves a row reading `approved` with the write never
  performed, and nothing retries it. The window is milliseconds; noted so the next reader doesn't
  mistake the design for an oversight, and so it is on record if approvals ever need to be
  reconciled.
- **`getAllAlignerSets` has no `LIMIT` and pays four correlated subqueries per row** (NextDueDate,
  NextAppointment, NextBatchPresent, the four-branch LabStatus `CASE`), over a four-table join, and
  `AllSetsList` then sorts client-side. Fine at this clinic's 136 sets; it is a per-row cost that
  grows linearly for the aligner-lab deployments the product targets. Not a defect today — a shape
  to revisit before a doctor-heavy install, per CLAUDE.md's ceiling paragraph.
- **`createBatch` conflates two conditions in one message:**
  `if (!set || set.remaining_upper_aligners == null) throw new Error('AlignerSet not found')` — a
  set that exists with a NULL `remaining_upper_aligners` reports "not found". No live rows are in
  that state (checked: 0 of 136), so it is a message bug, not a behaviour bug.
- **`WhatsAppService.heartbeatTick`'s `Promise.race` timeout is never cleared** — a 10 s timer is
  left pending on every 60 s tick. Not an unhandled rejection (`race` subscribes to both arms), but
  it can delay a graceful exit by up to 10 s.

## Considered and deliberately NOT filed

Recorded so the next sweep doesn't spend time re-deriving them.

- **Deleting an aligner set that has payments.** `fk_invoice_alignerset` is `NO ACTION` (every other
  FK onto `aligner_sets` cascades), so the delete raises `23503`. This looked like an unmapped-error
  twin of F3 — it isn't: `routes/api/aligner.routes.ts` already catches it via
  `isForeignKeyViolation` and answers **409** with *"it has payments recorded against it"*, and the
  comment there names the exact constraint. Already correct.
- **`StateManager.clear()` lets a mid-flight `atomicOperation` holder re-`set` state after the
  clear**, and `validateState()` reports a lock on a not-yet-written key as an "orphaned lock". Both
  are real but reachable only during `cleanup()` at shutdown, when neither outcome is observable.
- **`change_log` head-of-line blocking beyond the seven poison rows of F1e.** The drain loop
  continues past a failing row, and the window only stalls entirely if the permanently-failing set
  reaches `FAILOVER_SYNC_BATCH_SIZE` (200). Seven rows is nowhere near it, so F1e's damage is the
  log flood, not a halted sink.

## Coverage — what was actually read, and what was not

This is the part the batch-1/batch-2 records could not tell a future reader, so it is written down
here. "Deep read" means the file (or the named section) was read end to end; "signature scan" means
it was covered only by the repo-wide pattern sweeps (dates, money, locks/transactions, floating
promises, timers, path joins, casts, swallowed errors, `console`/radix/`@ts-ignore`, dead exports)
plus, where relevant, a live-database check.

**Deep read.** The whole aligner slice — `aligner-{set,batch,note,payment,doctor,shared}-queries.ts`
and `Aligner{Set,Batch,Payment}Service.ts` + `AlignerErrors.ts`; all of `services/sync/cdc/`
(`engine`, `reverse-sink`, `cdc-schema`, `index`) plus the `cdc_capture` trigger body on the live
DB; `messaging/StateManager.ts`; `approvals/approval-service.ts`; the write paths of
`stand-queries.ts`; `payment-queries.ts#addInvoiceWithBalanceGuard`; the batch auto-announcement
helpers in `announcement-queries.ts`; the path guards in `files/file-explorer.service.ts` and
`files/tv-display-store.ts`; `whatsapp-batch-plan.ts`, `sms.ts#sendSms` and the message builders in
`messaging-queries.ts`; `CalendarViewService`'s date helpers; `WorkService`'s create path;
`pdf-assets.ts`; `lab-cases/remake-guard.ts`; `templates/receipt-service.ts#applyFilter`.

**Signature scan only — the honest gaps in this sweep.**
- **`services/messaging/whatsapp.ts`** — only the heartbeat and the client-construction casts were
  read. The `WhatsAppService` class core (client lifecycle + the batch-send engine, ~2,000 lines)
  was deliberately left whole by backend-audit session S2 and has **never had a line-by-line
  review**. It is the single largest unaudited surface left in `services/`.
- **`MessageSession.ts` / `MessageSessionManager.ts`** (≈900 lines of ack-tracking state).
- **The non-aligner query modules** — `patient-`, `visit-`, `report-`, `appointment-`, `expense-`,
  `lookup-admin-`, `template-`, `alert-`, `employee-queries.ts` and the rest (~7,000 lines).
- **`imaging/`, `settings/`, `monitoring/`, `archform/`, `localsend/`** and the read paths of
  `stand-queries.ts`.
- **The six outbound integrations** (`google-drive/`, `google-contacts/`, `threeshape/`,
  `webceph/`, `cloudflare/`, and `sync/cdc/dolphin-sink.ts`) were scanned rather than re-read
  **on purpose**: batch 2 swept them line-by-line on 2026-08-31, two weeks before this sweep. Their
  timeout fixes were re-verified (see below); nothing else was.

## ✅ Verified clean (do not re-derive these)

- **Path traversal in `services/files/`.** `resolveSafe` (pure path math, `\0` check, separator
  normalization, `path.resolve` + containment assert), `realpathGuard` (symlink escape) and
  `mediaFilePath` (basename + extension allowlist + `path.relative` check) all hold.
- **The Supabase mirror's access control.** `anon` has **zero** table grants. `authenticated` has
  SELECT only, on exactly 8 tables, and every RLS policy is correctly doctor-scoped on
  `auth.jwt() ->> 'dr_id'`, including the `aligner_notes` INSERT `WITH CHECK`
  (`note_type='Doctor' AND is_read=false AND` set-ownership). The 7 tables with RLS off
  (`lab_cases`, `lab_case_events`, `labs`, `change_log`, `cdc_sink_control`, the two shade tables)
  have no grants to reach them, so the missing RLS is a defence-in-depth gap, not an exposure.
- **Stand POS stock integrity.** `createStandSaleTransaction` uses a conditional decrement
  (`WHERE current_stock >= qty`, 0 rows ⇒ abort), `voidStandSale` a conditional claim
  (`WHERE voided_date IS NULL`), `adjustStock` a non-negative guard — all inside one transaction with
  their ledger rows.
- **Outbound HTTP timeouts.** All five raw `fetch` call sites in `services/` (3Shape client, 3Shape
  OAuth, Cloudflare, WebCeph, LocalSend) carry an abort signal — four `AbortSignal.timeout(...)`, one
  its own `AbortController`. Batch 2's fix held. (The sixth `.fetch()` match is the Twilio SDK's own
  resource fetch, not an HTTP call this code makes.)
- **`StateManager`'s fencing tokens** (batch 1's remediation) are correct: hand-off mints a fresh
  token while the entry stays held, stale releases are ignored and logged, `reportStuckLocks` never
  releases.
- **Work money contracts.** `total_required` / `discount` / `item_cost` all route through `moneyInt`
  via `optMoney`; the `parseFloat` in `WorkService.toDbWorkData` is redundant defence, not a hole.
- **No `console.*`, no `parseInt` without radix, no `@ts-ignore`, no empty `catch {}`** anywhere in
  `services/` (the one match is inside a PowerShell string literal).
- **`approval_requests` IS deliberately mirrored** (since `migrations/supabase/mirror-approvals-slideshow-2026-07-21.sql`,
  RLS on with no policies, promoted from local-only **on purpose** and reasoned about in that
  migration's header). Any note still calling it "LOCAL-ONLY, no CDC" is stale.
