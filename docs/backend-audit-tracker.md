# Backend Audit Tracker (excluding `services/`)

**Goal:** audit every backend file outside `services/` for bugs, unused files, duplicated/dead code.
**Rule:** the AUDIT phase was audit-only. Remediation started 2026-09-07 — see *Remediation progress* below.
**Started:** 2026-09-07 · **Audit complete:** 2026-09-07 · **Remediation complete (86/86):** 2026-09-08
· **Re-reviewed:** 2026-09-09 (2 new findings fixed, 7 open)
· **Re-verified + remediated:** 2026-09-12 — every open item re-checked against the code, then
**R3-R8 and the chair-display item closed** (batch 7).
· **2026-09-13:** R9(b) closed (B1-B5), then **session S1** closed R9(a) + R9(d) and did C1/C2/C3 +
the route-table snapshot, and **session S2 closed R9(c)** (C4/C5/C6).
· **2026-09-14:** the two PRE-EXISTING findings S2 parked under the move-first rule (aligner-set
delete 500-instead-of-409; the `/api/wa/status` boot banner) were fixed — see *Two findings surfaced
during S2 verification* below — and the WhatsApp batch path's DECISIONS were extracted as pure,
unit-tested functions (the engine itself deliberately stayed put) — see *C6 follow-up*.
**🎉 THE AUDIT IS COMPLETE — every tracked item is closed.**

> **Nothing here is open.** The whole file is closed history, kept for the reasoning. If you are
> starting new backend work, read the S2 record below for the three decisions it locks in (and the
> one god file deliberately left whole), then go to the code.

---

## ✅ Open work — NONE (as of 2026-09-13, after session S2)

The 86 original findings, R1-R8, the chair-display item and **all of R9 (a/b/c/d)** are closed.
**There is no open work in this tracker.** Everything below is the record of how it got there.

Severity legend for the history: 🔴 bug · 🟠 risk · 🟡 dead/dup · 🔵 note.

**Gate green at the close:** `npm run gate` exit 0 — `typecheck:all` · `lint` 0 errors (the same 4
pre-existing `PatientSets.tsx` a11y warnings) · **168 tests** · D1 0 / D2 9 · `build`. Every S1 and
S2 move was additionally runtime-verified against the live dev DB on `:3101`.

| # | Sev | Item | State |
|---|---|---|---|
| ~~**R9(a)**~~ | ✅ | 4 well-behaved routers filed under `routes/api/` | **CLOSED in S1** — proven by a byte-identical route-table snapshot |
| ~~**R9(b)**~~ | ✅ | 78 → 0 raw `sql` statements in `routes/`; ESLint-ratcheted | CLOSED 2026-09-13 (B1-B5) |
| ~~**R9(c)**~~ | ✅ | God files | **CLOSED in S2** — see below |
| ~~**R9(d)**~~ | ✅ | `phoneFormatter.ts` → `phone-formatter.ts`; `types/api.types.ts` + `types/index.ts` → `middleware/types.ts` | **CLOSED in S1** |

---

## 🗺️ The work, split into two sessions (written 2026-09-13)

The split was by LAYER, because that is also the split by risk: S1 is the routing/boot layer, where a
mistake changes which handler serves a URL and is caught by a snapshot; S2 is the service layer,
where a mistake changes behaviour and only runtime verification catches it.

| Session | Scope | Status |
|---|---|---|
| **S1 — routing + boot layer** | C3 (`index.ts`) · the route-table snapshot · R9(a) · C1 (`patient.routes.ts`) · C2 (`calendar.ts`) · R9(d) | ✅ **DONE 2026-09-13** |
| **S2 — service-layer god files** | C5 (work stack) · C4 (aligner stack) · C6 (whatsapp) | ✅ **DONE 2026-09-13** |

### ✅ S1 — routing + boot layer (done 2026-09-13)

| | Before | After |
|---|---|---|
| `index.ts` | 971 ln | **295 ln** |
| `routes/api/patient.routes.ts` | 1,440 ln | **671 ln** |
| `routes/calendar.ts` | 1,000 ln | **582 ln** (`routes/api/calendar.routes.ts`) |
| routers filed outside `routes/api/` | 4 | **0** |
| route-table regression test | none | **464 routes snapshotted** |

- **C3 — `index.ts` 971 → 295.** Four modules under a new top-level **`app/`**: `sessions.ts` (121,
  staff+portal session + CSRF), `mount-routes.ts` (212, the whole route table), `whatsapp-events.ts`
  (229, service↔bus wiring + startup auto-init), `shutdown.ts` (222, graceful teardown + signal and
  crash handlers). What stays in `index.ts` is the ORDER those run in. Two deliberate details:
  `installSignalHandlers()` is called from the module body (so Ctrl-C during boot still tears down)
  while `installCrashHandlers()` is called mid-init, at exactly the point the `process.on` calls sat
  before — registering uncaughtException earlier would change what happens to a throw during boot.
  The vestigial `await import('./routes/api/index.js')` for `setWebSocketEmitter` became a static
  import: `index.ts` already imported that module at line 29, so the dynamic form bought nothing.
  The `middleware/auth.js` dynamic import stays dynamic — it is inside the auth-enabled branch.
- **The route-table snapshot — `app/mount-routes.test.ts` → `app/__snapshots__/route-table.txt`.**
  Mounts the REAL `mountRoutes` onto a bare app and writes all 464 routes out **in registration
  order**. *A diff in that file is a diff in what the server serves.* Two things made it work:
  - **Express 5 does not keep the mount path on a Layer** (`layer.path` is a per-request value,
    `undefined` at rest; only opaque `matchers` survive). The test wraps `Router.prototype.use` /
    `.route` — the two funnels EVERY registration goes through, `app.get(...)` included — and stamps
    the path onto the layers each call pushes. Wrappers are removed in `afterAll`.
  - **It is env-free**, because CI runs `npm test` with no `.env`: the test sets the boot-required
    vars with `??=` before the first import, and `dotenv.config()` never overrides an already-set
    value. Nothing connects — importing `mountRoutes` registers pools and health checks but opens no
    socket (measured: ~2 s, 0 network handles).
  - `vitest.config.ts` gained `'app/**/*.test.ts'`.
- **R9(a) — the 4 stray routers moved** to `routes/api/{calendar,email,user-management,template}.routes.ts`
  (relative imports re-depthed, the two importers updated). **The mounts deliberately did NOT move**:
  keeping them where they were makes the route-table snapshot **byte-identical**, which is the
  strongest available evidence the move changed nothing. `routes/` root is now only the five
  genuinely root-mounted routers (`admin`, `auth`, `portal`, `sync-webhook`, `web`) plus `api/` and
  `public/`. Stale path references in 6 code comments were updated.
- **C1 — `patient.routes.ts` 1,440 → 671**, split by concern into three siblings mounted at the same
  `/api` prefix: `patient-timepoint.routes.ts` (386 — time points, gallery, X-ray),
  `alert.routes.ts` (255 — the alerts/tasks table, including the un-prefixed `/alerts/:alertId/*`
  writes) and `patient-portal-admin.routes.ts` (202 — staff-side portal access + photo privacy, both
  `PatientPortalService` consumers). The snapshot's route **set** is unchanged; only the order within
  `/api` shifted, and no moved path can be shadowed by what now precedes it (every preceding patient
  route is 2 segments, or 3 with a literal last segment that is none of `timepoints`/`alerts`/
  `portal`/`photos`).
- **C2 — `calendar.ts` 1,000 → 582** + new **`services/business/CalendarViewService.ts`** (466): the
  view-model types, the Sat→Thu grid math (the clinic week has NO Friday column, which is why it is
  hand-rolled rather than a date library's `startOfWeek`), the two transforms, the
  `MaxAppointmentsPerSlot` read and the throttled calendar-horizon check. The route file is now HTTP
  only. Route table unchanged.
- **R9(d)** — `utils/phoneFormatter.ts` → `utils/phone-formatter.ts` (backend `utils/` is now fully
  kebab-case; the **frontend** `public/js/utils/phoneFormatter.ts` is a DIFFERENT file and stays
  camelCase, which is that directory's convention — don't "finish" the rename there). And
  `types/api.types.ts` + `types/index.ts` folded into **`middleware/types.ts`**: the middleware layer
  was the only consumer of either, and `types/index.ts`'s `AppConfig` re-export was dead (`config.ts`
  imports `config.types.js` directly). `types/` is now generated + ambient declarations + the
  boot-config shape, nothing else.

**Runtime verification (live dev DB, `:3101`)** — not just compiled. Boot + health + login + session
+ CSRF token; the auth gate (`/api/genders` 401 → 200, `/api/sse/appointments` and
`/api/sse/chair-display/1` **401 un-authed**, 200 + `retry:` frame authed, `/login.html` public);
`/api/portal-activity` still receiving the staff session (the segment-bounded skip); all four moved
routers; the full alert lifecycle through the new router (create → status `done` → snooze → update,
probe row deleted afterwards); the timepoint reads incl. the on-disk folder check (`Initial_14-12-2018`,
`exists: true`) and its 400/404 branches; portal enable/unlock + photo-privacy toggle, **every probe
restored to its original state**; and all six calendar reads, checked for the grid invariants that
the move could have broken — week = Sat→Thu ×6 with 22 time slots, month = a 30-cell grid containing
**zero Fridays**.

### ✅ S2 — the service-layer god files (done 2026-09-13)

R9(c) is closed: all seven files it named are dealt with. **The largest file in `routes/` is now 671
lines** (`patient.routes.ts`, from S1) — no route file is over 700. The largest backend file overall
is still `services/messaging/whatsapp.ts` at **2,501**, and the part of it that is still large is
**deliberately** whole (see C6).

Four files over ~750 lines remain and were **never in R9(c)'s scope** — this tracker excludes
`services/`, and R9(c) enumerated only the seven worst offenders. They are logged here so the next
reader doesn't mistake them for a miss: `services/database/queries/stand-queries.ts` **975**,
`services/database/queries/messaging-queries.ts` **956**, `services/business/WorkService.ts` **885**,
`services/files/tv-display-store.ts` **796** (plus `work-queries.ts` at **771**, down from 1,279).
None is a god file of the R9(c) kind, and none has been assessed — that would be a new item, for
`docs/services-audit.md` rather than here.

| | Before | After |
|---|---|---|
| `services/database/queries/aligner-queries.ts` | 2,159 ln | **deleted** → 7 modules, largest 692 |
| `services/messaging/whatsapp.ts` | 3,294 ln | **2,501 ln** (+ 4 modules) |
| `routes/api/aligner.routes.ts` | 1,504 ln | **403 ln** (+ 6 sibling routers) |
| `services/database/queries/work-queries.ts` | 1,279 ln | **771 ln** (+ 3 modules) |
| `services/business/AlignerService.ts` | 1,263 ln | **deleted** → 7 modules, largest 561 |
| `routes/api/work.routes.ts` | 990 ln | **512 ln** (+ 3 sibling routers) |
| `routes/api/whatsapp.routes.ts` | 964 ln | **504 ln** (+ 2 sibling routers) |
| **largest backend file** | **3,294** | **2,501** |

**Every route split kept the route table's registration order byte-identical.** Each new sibling
router is mounted at the same prefix as its parent, immediately after it, in the order its section
appeared in the original file — so the only diff in `app/__snapshots__/route-table.txt` across all of
S2 is the eleven extra `MOUNT` marker lines (3 for work, 6 for aligner, 2 for whatsapp). Not one
`GET`/`POST`/… line moved. That is the strongest available evidence the splits changed nothing.

- **C5 — the work stack.**
  - `work-queries.ts` 1,279 → **771**, now owning only the `works` ROW (CRUD, status lifecycle,
    the create-with-invoice paths). Split out by TABLE, not by feature:
    **`work-item-queries.ts`** (320 — `work_items` + `work_item_teeth` + `tooth_numbers`, and the
    `numericOrNull` helper only its two writers used), **`work-lookup-queries.ts`** (76 — the four
    dropdown catalogues; two of them are served by `lookup.routes.ts`, not `work.routes.ts`, which
    is why they never belonged next to the work CRUD) and **`work-transfer-queries.ts`** (153).
  - `work.routes.ts` 990 → **512**, plus **`work-item.routes.ts`** (241), **`diagnosis.routes.ts`**
    (148) and **`work-transfer.routes.ts`** (171) — the file's own four `// ====` section banners
    were already the seams.
  - **Verified** (live dev DB): all five lookups cross-checked against `SELECT COUNT(*)` (manufacturers
    0, labs 2, teeth 52, work types 22, keywords 89 — exact match); the work-item lifecycle
    create → read (teeth `UR8, UR7` / ids `[1,2]`) → update with a teeth REPLACEMENT (`[1,2]` → `[3]`,
    proving the DELETE+INSERT transaction still holds) → delete, with the `work_item_teeth` rows
    confirmed gone and no orphans; the diagnosis lifecycle create → **"created"** → upsert →
    **"updated"** with the row count staying **1** → delete → GET returns literal `null`; the three
    transfer refusals (SAME_PATIENT 400, target-not-found 404, ACTIVE_WORK_CONFLICT 409, work unmoved
    each time) and then a REAL transfer 5768 → 7395 that also reclassified **both** patients
    (`patient_type_id` 5→2 and 3→5) and a transfer back that restored both; `getworks` compared
    row-for-row against the DB including `toWorkWire`'s `addition_date` truncation. Every probe row
    was deleted and every patient restored.

- **C4 — the aligner stack.** The biggest volume, and the one place a **barrel was rejected**: all
  three files were consumed as `import * as alignerQueries` / `* as AlignerService`, so a re-export
  shim would have been the zero-churn option — but it would have left a module that still claims to
  own everything. Instead the barrels were deleted and all 48 call sites re-pointed at the
  domain namespace they actually use, which makes the layering visible at the call.
  - `aligner-queries.ts` → **`aligner-{doctor,set,patient,batch,note,payment,archform}-queries.ts`**
    + **`aligner-shared.ts`** (24 — just `toIntOr` and the `PgTransaction` alias, the only two things
    both the set writes and the batch writes used). `alignerSetExists` moved to the SET module even
    though it sat under the NOTES banner: it reads `aligner_sets`.
  - `AlignerService.ts` → **`Aligner{Set,Batch,Doctor,Note,Payment,Patient}Service.ts`** +
    **`AlignerErrors.ts`** (the `AlignerValidationError` / `AlignerErrorCode` taxonomy every section
    and the route layer share). Two cross-module edges are real and intended:
    `AlignerSetService` reads `aligner-payment-queries` (the set-cost-below-paid invariant) and
    `AlignerBatchService` reads `aligner-set-queries` (the set-exists check).
  - `aligner.routes.ts` → **`aligner-{note,batch,file,archform,label,doctor}.routes.ts`**. `file`
    holds the PDF and the portal-photo sections together (both are set attachments).
  - **Verified** (live dev DB): every read; the note lifecycle create → update (with `is_edited`
    flipping) → toggle-read → status → delete → 404-on-repeat; the **full batch lifecycle** on a
    real set — create (remaining 1/5 → 0/3, exactly the not-yet-batched semantics), manufacture and
    deliver (each inserting its `doctor_announcements` auto-announcement, and the deliver activating
    the batch), undo-deliver and undo-manufacture (**both announcements retracted**, dates cleared,
    batch deactivated), an edit (1/2 → 1/4, remaining 0/1), the two refusals
    (LOWER_ALIGNER_LIMIT_EXCEEDED, INVALID_SET_CHANGE) and a delete that put the set back to
    **ru=1 rl=5, 0 batches, 0 announcements**; set create/update/delete; a real payment plus the
    SET_COST_BELOW_PAID refusal (which is the cross-module edge above, so it also proves that
    import); doctor CRUD including the duplicate-email 409; archform link/unlink; and a label PDF
    that came back as a real `%PDF-1.3`. Every probe row was removed.

- **C6 — WhatsApp. Split along the explicit seams only; the class core was left whole ON PURPOSE.**
  - Out of `whatsapp.ts` (3,294 → **2,501**): **`whatsapp-types.ts`** (164), **`whatsapp-client-state.ts`**
    (247 — `ClientStateManager`, already a standalone class), **`whatsapp-circuit-breaker.ts`** (125 —
    ditto) and **`whatsapp-session-files.ts`** (326 — `validateSessionQuality`, `checkExistingSession`,
    `ensureProfileUnlocked`, `killPidAndWait`, `killWindowsChromeForProfile`).
  - **The seam test was mechanical, not aesthetic:** every method in `WhatsAppService` was scanned
    for `this.` usage. Exactly four were `this`-free (`handleLoadingScreen`, `killPidAndWait`,
    `killWindowsChromeForProfile`, `validateSessionQuality`), plus two that only called `this`-free
    siblings. Those are what moved.
  - **What deliberately did NOT move: the client lifecycle and the batch-send engine.** The send
    group alone (`sendBatch`/`sendSingleMessage`/`sendMessage`/`report`/…, ~630 ln) touches ten
    distinct pieces of mutable instance state — `wsEmitter`, `messageState`, `emit`, `clientState`,
    `circuitBreaker`, `batchSendActive`, `adhocMessages`, `restart()`, and two tuning constants.
    Extracting it means passing the service (or a context object) into it: a refactor with real
    behavioural surface on the live-send path, not a move. **Do not "finish" C6 by doing that
    without a reason better than the line count.**
  - `whatsapp.routes.ts` 964 → **504** + **`whatsapp-media.routes.ts`** (209, `/sendmedia*` and the
    `OutOfTreePathError` guard) + **`whatsapp-session.routes.ts`** (316, QR/status + client lifecycle).
  - **Proof the client path is untouched:** `createAndInitializeClient`, `performInitialization`,
    `setupClientEventHandlers`, `handleQR`, `handleAuthenticated`, `handleReady` and
    `armReadyWatchdog` were diffed method-by-method against the pre-split file. The ONLY differences
    are six `this.x()` → `x()` call sites for the three moved helpers. Puppeteer options, LocalAuth
    config, the session path and the event wiring are byte-identical.
  - **Verified at runtime:** the server boots, `checkExistingSession` and `validateSessionQuality`
    run from their new module ("Session quality: valid (size 489842KB, mature session)"), Chrome
    launches, WhatsApp Web loads and the QR/event pipeline runs end-to-end through the split code.
    All three routers exercised: `/qr` (real base64 PNG), `/initial-state`, group-settings
    GET/PUT/restore, the `/sendmedia*` validation branches and the out-of-tree path guard.

### ➕ C6 follow-up (2026-09-14) — the DECISIONS came out, the machinery stayed

The "do not finish C6 by line count" rule above still stands, and this change did not break it: the
batch-send engine was **not** moved, and `WhatsAppService` still owns every piece of mutable state it
owned before. What moved is the *reasoning* the engine was carrying, into two pure modules:

| New module | Ln | Contents |
|---|---|---|
| `services/messaging/reminder-format.ts` | 67 | The SQL-compat formatting primitives that were **private** to `messaging-queries.ts` (`englishDay`, `daysFromToday`, `format12h`, `formatDMY`, `formatPhone`, `isValidPhone`) — pure moves, bodies byte-identical. Being private to a DB module is what made everything built on them untestable. |
| `services/messaging/whatsapp-batch-plan.ts` | 348 | The four decision clusters: **recipient selection** (`isReminderDay`, `buildReminderPlan` → `{recipients, skipped}`), **abort rules** (`classifySendFailure`, `advanceBatchGuard`, `summarizeBatch`), the **zero-ack verdict** (`shouldArmAckWatchdog`, `isAckSilenceConfirmed`, `ackSilenceWarning`), and **report reconciliation** (`reconcileAck`). No clock, no I/O, no service state. |

- **`whatsapp.ts` kept every side effect** — the client, the 2s pacing, the DB writes, the SSE emits,
  the restart — and now reads its rules instead of restating them. Net −18 ln (2,501 → 2,483), which
  is the point: this was never about the line count.
- **Three rules that were invisible before are now named and pinned.** The counter asymmetry in
  `advanceBatchGuard` (a stall does NOT reset the malformed counter, and vice versa — alternating
  systemic failures are not evidence of recovery); the restart split in `summarizeBatch` (a stall
  restarts, a malformed result must NOT, because a library-version mismatch survives a restart); and
  `reconcileAck`'s `ack || 1` floor (a message still visible in the chat has reached the server, so
  "pending" must not overwrite a delivered/read status the DB already holds).
- **`getWhatsAppMessages` now supplies rows and keeps the SQL**; the wording and skip rules come from
  the planner. A row with an unusable phone is now *reported* as `skipped` (and logged) instead of
  silently dropped — it still never reaches the send loop, so it keeps its eligibility flags.
- **Deliberately NOT unified:** `getSmsMessages` and `getNewAppointmentMessage` still build their own
  text. Their wording genuinely differs from the WhatsApp reminder (different clinic phrasing, a
  meridiem on the time, the `Tommorow` typos inherited from the retired procs); folding them into one
  "shared" template would silently rewrite messages patients receive.
- **Verification.** `whatsapp-batch-plan.test.ts` — **30 unit tests**, the first coverage this path
  has ever had (suite 168 → 198, gate green). Plus a **differential check against the dev database**:
  the pre-refactor loop (copied verbatim) and the new planner were run over **186 real appointment
  rows** across four dates × both window days × the three out-of-window cases — byte-identical output,
  0 mismatches, including the one real row whose phone the validator rejects. The send-loop half is
  covered by the unit tests and review only: exercising it live means sending real reminders to real
  patients, which is not a verification step worth taking.

**Two findings surfaced during S2 verification. Both were PRE-EXISTING, neither was introduced by the
splits, and per the move-first rule neither was fixed in the same change. Both are now ✅ CLOSED in a
separate follow-up change (2026-09-14):**

| Sev | Finding | State |
|---|---|---|
| ~~🟠~~ | `DELETE /api/aligner/sets/:setId` on a set that has payments returned **500** with the raw PG text (`violates foreign key constraint "fk_invoice_alignerset"`) instead of a 409. `sendError` dev-gates the `Error` in `details`, so production never leaked the stack — but the status and the message were both wrong for a known, expected conflict. | ✅ **FIXED 2026-09-14** — `aligner.routes.ts` now branches on `isForeignKeyViolation` (SQLSTATE 23503) before the `internalError` fallback and answers `ErrorResponses.conflict` (409) with "it has payments recorded against it. Delete those payments first." The 23503 branch can only mean invoices: every *other* FK onto `aligner_sets` (`fk_aligner_batches_alignerset`, `fk_aligner_notes_alignerset`, `fk_activityflags_alignerset`, `fk_aligner_sets_tblwork`) is `ON DELETE CASCADE`; `fk_invoice_alignerset` is the sole non-cascading one, which is what makes the specific message safe. Matches the house pattern in `lookup-admin.routes.ts` (`ReferentialError` → `conflict`). Note the route must handle this itself — the global `classifyPgError` net in `middleware/error-handler.ts` never sees it, because the handler catches the error first. |
| ~~🔵~~ | The boot banner printed `WhatsApp Status: /api/wa/status`, a route that does not exist (and does not appear in the route-table snapshot). | ✅ **FIXED 2026-09-14** — `index.ts` banner now prints `/api/wa/initial-state`, the real endpoint (route-table snapshot line 187). |

**Neither fix touches the route table** — `app/__snapshots__/route-table.txt` is unchanged (no route was
added, removed or re-pathed; only a status code, a message and a log string changed).

**Environment note (not a code issue):** on the WSL dev box an orphaned Puppeteer Chrome from the
previous day held the `.wwebjs_auth/session-client` profile for ~14 h, so *every* server started that
day failed WhatsApp init with `Client initialization timeout - no events` — visible before any S2
change was made. Freeing the profile required SIGKILLing it, after which WhatsApp Web asked to
re-verify and the dev client now sits at a QR prompt. The on-disk profile is intact (4 `.ldb` files,
valid `MANIFEST`, and the app's own validator still says "valid, mature session"); the dev box just
needs one QR scan. Prod is a separate Windows-service profile and is unaffected. Note that
`ensureProfileUnlocked` only hunts orphan Chromes on **win32** — on Linux it clears lock files and
kills a *tracked* pid only, which is why the orphan survived.

**Rules that governed S2** (same as the B-sessions, they earned their keep):

1. **Pure move, no behaviour change.** Found a bug mid-move? Move first, fix in a separate commit.
   (Both findings above are parked under exactly this rule.)
2. **The extracted module takes typed params, not the `Request`.** No `req`/`res` below the route layer.
3. **Comments move with the code.** The rationale comments are worth more than the move.
4. **`type`, not `interface`, for anything feeding `sendData`** — `looseObject` needs the index
   signature (CLAUDE.md / TS2345).
5. **Gate green before ending the session**, and run the route-table snapshot.

**Three decisions a future session must not silently undo** (the first two from 2026-09-09, the
third from batch 7):

1. **`moneyInt` is non-negative BY DEFAULT** (`shared/validation.ts`). Do not "simplify" it back to a
   bare `.int()` — 6 of its 12 call sites never added a sign check, which is how the negative-invoice
   hole existed. Its docblock explains this. Note the floor also now rejects negative Stand
   `costPrice`/`sellPrice`/`unitCost`, `patients.estimated_cost` and `works.discount`, which is
   believed correct everywhere but **was never explicitly confirmed with the clinic**.
2. **5 sites deliberately still forward `(err as Error).message` to the client** (`integrations.routes.ts`
   ×3, `localsend.routes.ts` ×2). Each carries an inline `no-restricted-syntax` disable naming the
   reason: those modules humanize every message they throw (`humanizeAuthError`,
   `describeFetchError`, hand-written LocalSend copy), so suppressing them would replace actionable
   guidance with "Upload failed". Do not "fix" them.
3. **The chair kiosk is NOT session-less, and its SSE stream must stay behind the auth gate.** The
   "kiosk has no session" premise was false and is what kept PHI on a public endpoint for months —
   see batch 7. If a future kiosk genuinely has no session (a bare HTML page, not the SPA), the
   answer is a per-chair token, never an un-gated mount.

---

## 🗺️ R9(b) session plan (written 2026-09-13) — CLOSED HISTORY

> Superseded by the two-session split at the top of this file. Kept for the B1-B5 record and the
> C1/C2/C3 line-count baselines it was planned against; C1, C2 and C3 were done in **S1**, and
> C4/C5/C6 are now **S2**.

**Ground truth re-measured 2026-09-13** (the tracker's prose has been wrong 3× — these are counts
taken from the code today, not copied forward):

| File | `sql` stmts | lines |
|---|---|---|
| `routes/api/patient.routes.ts` | **38** | 1,762 |
| `routes/api/employee.routes.ts` | 12 | 283 |
| `routes/user-management.ts` | 9 | 294 |
| `routes/api/appointment.routes.ts` | 5 | 637 |
| `routes/api/media.routes.ts` | 3 | 383 |
| `routes/api/work.routes.ts` | 3 | 1,165 |
| `routes/api/payment.routes.ts` | 2 | 478 |
| `routes/api/staff.routes.ts` | 2 | 68 |
| `routes/calendar.ts` | 2 | 1,008 |
| `routes/auth.ts` | 1 | 382 |
| `routes/portal.ts` | 1 | 364 |
| **total** | **78** | — |

**The single most useful fact:** 34 of `patient.routes.ts`'s 38 statements are *one feature* — the
`GET /patients/search` query builder (lines 560-899). Extracting that one handler removes 44% of the
entire R9(b) surface **and** ~340 lines from the #3 god file. So B1 does double duty and goes first.

### Sessions

Each row is one sitting, independently shippable, gate-green on its own. Order matters only where
noted.

| Session | Scope | Removes | Depends on |
|---|---|---|---|
| ~~**B1**~~ ✅ | `GET /patients/search` builder → new `patient-search-queries.ts` | 35 stmts · −301 ln | — |
| ~~**B2**~~ ✅ | user/auth cluster: `user-management.ts` (9) + `auth.ts` (1) → new `user-queries.ts` (+`middleware/auth.ts`'s 2, out of scope but same table) | 12 stmts | — |
| ~~**B3**~~ ✅ | staff cluster: `employee.routes.ts` (12) + `staff.routes.ts` (2) → `employee-queries.ts` | 14 stmts | — |
| ~~**B4**~~ ✅ | tail: `appointment.routes.ts` (5), `media.routes.ts` (3), `work.routes.ts` (3), `payment.routes.ts` (2), `calendar.ts` (2), `portal.ts` (1), `patient.routes.ts` leftovers (3) | 19 stmts | B1 |
| ~~**B5**~~ ✅ | **ratchet**: ESLint ban on `getKysely`/`kysely` imports under `routes/**`, wired into `npm run gate` | locks it | B1-B4 |
| ~~**C1**~~ ✅ | `patient.routes.ts` (**1,440** after B1+B4) → split alerts + portal + timepoints into sibling routers | −769 ln (done in S1) | B1 |
| ~~**C2**~~ ✅ | `routes/calendar.ts` **1,000** → service + router | −418 ln (done in S1) | B4 |
| ~~**C3**~~ ✅ | `index.ts` 971 → `mountRoutes(app)` + boot/shutdown modules (also unblocks R9(a)'s route-table snapshot) | −676 ln (done in S1) | — |
| ~~**C4**~~ ✅ | aligner stack: `aligner-queries.ts` 2,159 + `aligner.routes.ts` 1,504 + `AlignerService.ts` 1,263 | done in S2 | — |
| ~~**C5**~~ ✅ | `work-queries.ts` 1,279 + `work.routes.ts` **990** | done in S2 | B4 |
| ~~**C6**~~ ✅ | `services/messaging/whatsapp.ts` 3,294 — **last, and riskiest**: it owns live runtime state (`messageState`/`stateEvents`/`StateManager`) and a Puppeteer session. Split only along already-explicit seams; never while another WhatsApp change is in flight. | — | — |

### Rules for every session in this plan

1. **Pure move, no behaviour change.** If a bug is found mid-move, move first, fix in a separate
   commit — otherwise the diff stops being reviewable and a regression has two candidate causes.
2. **The query module takes typed params, not the `Request`.** No `req`/`res` below the route layer;
   that is the whole point of the move.
3. **Comments move with the SQL.** The search builder's comments (trigram-index lockstep, the
   correlated-MAX rationale, the two-marker photo semantics, the remaining-balance formula) are the
   most valuable thing in that block. Losing them costs more than the move gains.
4. **`type`, not `interface`, for anything feeding `sendData`** — `looseObject` needs the index
   signature (CLAUDE.md / TS2345).
5. **Gate green before ending the session**: `npm run typecheck:all && npm run lint && npm test`,
   plus `npm run gate` on the last session of a group.

### Progress

**B1 + B2 done 2026-09-13** — gate green (`npm run gate` exit 0: typecheck · lint 0 errors, the same
4 pre-existing `PatientSets.tsx` a11y warnings · 167 tests · D1 0 / D2 9, no baseline movement ·
build). Both were runtime-verified against the live dev DB on `:3101`, not just compiled.

| | Before | After |
|---|---|---|
| route-layer `sql` statements | 78 | **33** |
| route files importing `getKysely` | 11 | **9** |
| `routes/api/patient.routes.ts` | 1,762 ln / 38 sql | **1,461 ln / 3 sql** |
| `routes/user-management.ts` | 294 ln / 9 sql | **246 ln / 0 sql** |

- **B1** → `services/database/queries/patient-search-queries.ts` (355 ln): the whole builder, with
  every rationale comment carried over (trigram-index lockstep, correlated-MAX probe, two-marker
  photo semantics, the remaining-balance formula). The route keeps only query-string adaptation
  (`parseIdList` + the `'true'` flags); the 500-row page cap moved INTO the query module so every
  future caller inherits it. **Verified** across 20 filter combinations against the live DB — all 4
  sorts, prefix-vs-substring names (231 → 28 hits), phone/ID, debt, work types, keywords, tags,
  patient types, date range, pagination. The tri-state partition checks out exactly:
  `finalPhotos=has` 840 + `none` 5,981 = 6,821 = unfiltered total, which is positive evidence the
  negated branch is right, not just that it runs.
- **B2** → `services/database/queries/user-queries.ts` (9 exported functions): now the single owner
  of the `users` table. `middleware/auth.ts`'s 2 statements went in too — outside R9(b)'s stated
  scope, but leaving the credential read behind would have defeated the point. The last-active-admin
  guard's two helpers (`countOtherActiveAdmins`, `getUserRoleStatus`) moved out of the router and
  next to the writes they protect. **Verified**: login / wrong password / unknown user (the
  enumeration-guard dummy-hash path), `last_login` stamping, list, create, duplicate-username
  rejection, password reset, both role-change directions, toggle, delete — and the refusal branch
  (`PUT /users/1/role` → 400 "Cannot demote the last active admin", role unchanged in the DB). The
  throwaway probe user was deleted; the DB is back to its original 2 rows.
- Watch out: `touchLastLogin` had to become **`stampLastLogin`** — `verifyCredentials` already has a
  local boolean option by that name, and the import shadowed it (TS2349, caught by typecheck).

**B3 + B4 + B5 done 2026-09-13 — R9(b) is CLOSED.** Gate green (`npm run gate` exit 0: typecheck ·
lint 0 errors, the same 4 pre-existing `PatientSets.tsx` a11y warnings · 167 tests · D1 0 / D2 9, no
baseline movement · build). Every moved endpoint was runtime-verified against the live dev DB on
`:3101`, writes included — not just compiled.

| | Before (pre-B1) | After |
|---|---|---|
| route-layer `sql` statements | 78 | **0** |
| route files importing `getKysely` | 11 | **0** |

- **B3** → the four staff/lookup reads moved into `employee-queries.ts` (`listEmployees`,
  `listPositions`, `listActiveDoctors`, `listActiveOperators`), which now owns every `employees`
  read as well as its writes. `employee.routes.ts` 283 → 207 ln, `staff.routes.ts` 68 → 45 ln. The
  position filter's *name-or-id* discrimination (`isNaN(Number(position))`) went WITH the SQL rather
  than staying in the route — it shapes the predicate, so it belongs next to it; the route keeps
  only the `'true'` → boolean query-string adaptation. **Verified**: 11 filter combinations against
  the live DB. Active 9 + quit 2 (Sandra, Snowbar) = 11 = `includeInactive`; `position=Doctor`
  (name) and `position=1` (id) return the identical 3 rows and match `/doctors` exactly; `/operators`
  9 = the active-only default; an unknown position name returns `[]`, not everything.
- **B4** → the tail, split by table rather than by route file:
  - `appointment-queries.ts` += `listAppointmentDetails` / `getPatientAppointments` /
    `getAppointmentById` / `deleteAppointment` / `getNextAppointmentForPatient` (the portal's). The
    two summary reads now share one `APPOINTMENT_SUMMARY_SELECT` fragment instead of a copy-pasted
    10-line SELECT each. `deleteAppointment` returns the `app_day` it read BEFORE the DELETE — the
    SSE broadcast key, unreadable afterwards.
  - **new `webceph-queries.ts`** — the sole owner of `patients.web_ceph_*` (3 statements). Not
    folded into `patient-queries.ts`: those columns are touched only by the WebCeph integration.
  - **new `diagnosis-queries.ts`** — the `diagnoses` table, moved verbatim (the ~45-column SELECT,
    the ON CONFLICT upsert and every rationale comment: the `UNIQUE (work_id)` / advisory-lock
    history, the `xmax = 0` created-vs-updated trick). The per-field `|| null` normalization moved
    WITH the SQL; the route keeps the `dx_date` local-midnight parse. **−270 ln from
    `work.routes.ts`** (1,165 → 990), the biggest single win of the session.
  - `payment-queries.ts` += `getWorkForReceipt`. The route's raw `DELETE FROM invoices` was a
    **duplicate** of the existing `deleteInvoiceById` (used by `approval-actions.ts`) — deleted, not
    moved.
  - `options-queries.ts` += `getOptions(names[])` (one round trip, name → value map) for
    `calendar.ts`'s four-setting read; its single-option helper now just calls the existing
    `getOption`.
  - `patient-queries.ts` += `getTagOptions` / `getPatientTypeOptions` / `updateEstimatedCost`.
  - **Verified** (live dev DB): all 11 reads; the 404 branches (`appointments/:id`,
    `getworkforreceipt/:id`, `deleteInvoice/:id`, `webceph/patient-link` with no link); the
    diagnosis lifecycle create → **"created"** → upsert → **"updated"** with the row count staying
    **1** → field cleared to null → delete → GET returns literal `null`; estimated-cost `0` staying
    `0` (not NULL) and currency `'IQD'` defaulting; an appointment created then deleted (`app_day`
    broadcast key read correctly) and a delete of a non-existent id still 200ing with no broadcast.
    Every probe row was restored — patient 5768 and work 12947 are back as found.
- **B5** → the ratchet, in the existing `routes/**/*.ts` ESLint block:
  `no-restricted-imports` bans the **`kysely` package** (the `sql` tag) and the named
  `getKysely`/`withPgTransaction` from `services/database/kysely.js` (pattern-matched, so it catches
  every relative depth and the `@services` alias). Proved by a throwaway probe file importing all
  four: 3 errors, and `getPgPool` passes.
  - **`getPgPool` is deliberately NOT banned.** `routes/sync-webhook.ts` reads each CDC sink's
    control row + backlog through a raw `pg.Pool` so ONE `readSinkStatus(pool, sink)` serves both
    the LOCAL failover feed and the one living on Supabase — and the Supabase tables aren't in
    `types/db.d.ts`, so Kysely cannot type that side at all. Banning it would force either a
    duplicated reader or a fake type.

**Next session was R9(c)** — the god files; C1/C2/C3 landed in S1 and C4/C5/C6 in S2, closing it.

---

## Remediation progress

**86 of 86 original findings closed (100%)** as of 2026-09-08, in four batches (plus batch 5, batch 6
from the 2026-09-09 re-review, and **batch 7** — 2026-09-12 — which closed every remaining re-review
item except R9's tail). Each is marked **✅ FIXED** in place below
(two are marked **✅ VERIFIED — not a defect**: F5.6 and half of F7.23 did not survive re-verification, see batch 4).
Gate green after each batch: `typecheck:all` · `lint` (only the 4 pre-existing `PatientSets.tsx` a11y warnings) · `test` (**144/144** after batch 4 — 27 new tests) · `contracts:check --strict` (D1 0, D2 9 — no baseline movement) · `build`.

### Fixed in batch 1

| # | Finding | What changed |
|---|---|---|
| **F7.1** 🔴 | `sendmedia2` arbitrary file read | New `isUnderClinicRoot()` in `services/files/clinic-paths.ts` (separator- + case-insensitive, **normalizes `..` before the prefix test**); `sendmedia2` resolves through it and 400s on an out-of-tree path. |
| **F6.1** 🔴 | Most privileged endpoints ungated | `settings.routes.ts`: `authorize(ADMIN_ROLES)` on every write + the whole DB-config surface (backup / test / update / export / restart / options writes). The two `GET /options` reads stay open — the SPA shell reads `PatientsFolder`/`VideosPath` on every page. |
| **F6.7** 🔴 | `/api/admin` gate defeated by mount order | Gate moved INTO `lookup-admin.routes.ts` (pathless is safe — the router is mounted at `/api/admin`), so it no longer depends on registration order. `FINANCE_ROLES`, not `ADMIN_ROLES`: the right-click "Edit values" flow is a documented front-desk workflow; it excludes `clinical`. `index.ts` now documents the ordering hazard for future `/api/admin/*` routers. |
| **F6.8** 🟠 | Stored XSS via inline file preview | Inline serves (both the `sendFile` and manual-stream paths) set `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff`, so a `.svg`/`.html` in a patient folder renders in an opaque origin with scripting off instead of reaching the viewer's session. |
| **F7.11** 🟠 | `POST`/`PUT /api/patients` ungated | `PUT` → `FINANCE_ROLES` (matching its `DELETE` and estimated-cost siblings). `POST` → `CLINICAL_ROLES` written out explicitly: chairside intake is real, so creation stays open, but the decision is now visible instead of being the absence of a line. |
| **F7.12** 🟠 | SMTP config rewritable by anyone | `GET`/`POST /api/email/config` → `ADMIN_ROLES`. The send endpoints stay open (front-desk workflow). |
| **F2.1** 🟠 | Invoice age guard read a user-typed date | `getInvoiceCreationDate` now reads `invoices.sys_start_time` instead of the form-entered `date_of_payment`, so an old invoice can no longer be re-dated into today's edit window. (Expense half + the UTC skew on that column: batch 2.) |
| **F7.3** 🟠 | Diagnosis upsert could duplicate | Stopgap: UPDATE-then-INSERT wrapped in `withPgTransaction` behind `pg_advisory_xact_lock(hashtext('diagnoses'), work_id)`, serialising concurrent saves per work without a schema change. **Superseded by the batch-2 `UNIQUE (work_id)`**, which retired both the lock and the transaction. |
| **F7.5** 🟠 | `PUT /appointments/:id` skipped the booking guard; PUT+DELETE silent | New `validateAndUpdateAppointment()` runs the same holiday / doctor / double-booking checks as `POST` (`checkAppointmentConflict` gained an `excludeAppointmentId` so the row isn't a conflict with itself). PUT and DELETE now broadcast. |
| **F7.6** 🟠 | Check-in SSE broadcast today's date | `updatePresent`/`undoAppointmentState` return the row's own `app_day` (read inside the existing `FOR UPDATE`); a new `broadcastDays(...)` helper in the router de-dupes and drops nulls, and is now the single path every mutating handler uses. `appDay` is split off before `sendData` so the contracted response is unchanged. |
| **F7.4** 🟠 | Unbounded `/api/calendar/range` span | Contract now refines `start <= end` and caps the window at `MAX_CALENDAR_RANGE_DAYS` (92) — a 400 at the boundary, mirroring `/statistics/multi-year`'s 10-year cap. |
| **F7.8** 🟠 | `new Date('YYYY-MM-DD')` defeating `toDateOnly` | All five sites now pass the contract string through: aligner batch manufacture/deliver (service + `updateBatchStatus` widened to `Date \| string`), `visit_date` ×2, `date_of_birth` ×2. `work.routes.ts` `dx_date` is a `timestamp`, not a `date`, so it uses `parseLocalDate` (local midnight) with a full-timestamp fallback. |
| **F4.4** 🟠 | `sendError` leaked `Error.message` in production | `details` from an `Error` is now dev-only in full (message *and* stack). ~140 call sites pass a caught error straight through; the client's `httpErrorMessage` reads the top-level `error` string, so the UI is unaffected. |
| **F7.10** 🟠 | 11 handlers returned raw DB error text as the 500 message | All 11 now pass a fixed friendly string with the error object in `details` (payment ×6, messaging ×2, email-api ×3). |
| **F7.17** 🟡 | `health.routes.ts` unreachable | Routes de-prefixed to `/`, `/detailed`, `/start`, `/stop` (the router is already mounted at `/api/health`), and `start`/`stop` gated `ADMIN_ROLES` — resolving the `F7.13` half for that router too. |
| **F2.6** 🔵 | String PKs bound un-parsed | `getPatientCreationDate` / `getInvoiceCreationDate` / `getExpenseCreationDate` now `parseInt` like `getWorkCreationDate` did, so a junk id can't raise `22P02` → 500. |
| **X.1 / F3.4** 🟡 | `config/ssl.ts` | Deleted (66 lines, no importer, no `ssl/` dir). |
| **F2.3** 🟡 | `middleware/validation-schemas.ts` | Deleted (0 importers); the stale pointer in `shared/validation.ts`'s header updated. |
| **F1.2/F1.3/F1.4** 🟡 | `index.ts` dead code | Removed unused `__filename`/`__dirname` (+ the `url` import), the no-op second `dotenv.config()` (+ its import), and the dead unbounded `/api/aligner-portal` skip. |
| **F7.20** 🟡 | `MaxAppointmentsPerSlot` ×5 | One `getMaxAppointmentsPerSlot()` helper + a named `DEFAULT_MAX_APPOINTMENTS_PER_SLOT`; the batched `/range` read now shares the same default (and is NaN-safe, which none of the copies were). |
| **F7.21** 🟡 | Duplicate `parseLocalDate` | `patient.routes.ts` imports the `utils/date.ts` export instead of redefining it. |
| **F7.22** 🟡 | `getWorkDetails` imported twice | Single import; `getWorkDetailsFromQueries` alias gone. |
| **F9.3** 🟡 | Duplicate `normalizePath` | Hoisted to `services/files/clinic-paths.ts#normalizeVideoDbPath`, shared by both video routers. |
| **F7.14** 🟡 | Message passed in the `data` slot | `sendSuccess(res, null, 'Photo deleted successfully')`. |
| **F7.24** 🔵 | No-op `m.Year === year` filter | Removed. |
| **F11.4** 🔵 | Migration cites a squashed file | Comment points at the 2026-07-30 baseline instead. |

### Fixed in batch 2 — the schema half (2026-09-07)

The two follow-ups batch 1 left open were both "needs a migration", so they were done together.
Applied to **both** databases and verified: `scripts/diff-supabase-mirror.mjs` reports no drift
beyond the intentionally local-only `integration_oauth_tokens`, and row counts match on all 73
mirrored tables.

| # | Finding | What changed |
|---|---|---|
| **F7.3** 🟠 (durable) | Diagnosis upsert could duplicate | `migrations/pg/1788812600000_diagnoses-unique-workid.sql` adds **`UNIQUE (work_id)`** (`diagnoses_work_id_key`), preceded by an idempotent LWW dedupe (`updated_at DESC NULLS LAST, id DESC`, each removed row RAISEd in full first — 0 duplicates on either DB here). `POST /api/diagnosis` is now ONE statement, `INSERT … ON CONFLICT ("work_id") DO UPDATE … RETURNING (xmax = 0)`, so the create/update message survives; the `pg_advisory_xact_lock` + `withPgTransaction` wrapper are gone. The invariant now binds **every** writer, including the CDC sinks, not just the code path that remembered to take the lock. |
| **F11.3** 🟡 | Redundant `diagnoses$compindex` | Dropped in the same migration, together with `tblDiagnosis$tblworktblDiagnosis` — a plain btree on `(work_id)` that the new unique index subsumes exactly. `diagnoses` goes from 3 indexes to 2, and the surviving pair actually constrains something. |
| **F2.1** 🟠 (expense half) | Expense age guard read a user-typed date | `migrations/pg/1788812700000_expenses-created-at.sql` adds **`expenses.created_at timestamp NOT NULL DEFAULT LOCALTIMESTAMP`**; `getExpenseCreationDate` reads it instead of `expense_date`. Backfill is `expense_date::timestamp` **on purpose** — it reproduces the old guard's verdict exactly for all 4,290 existing rows (no historical expense changes permission class), where `updated_at` would have handed any old expense edited today a "created today" stamp, i.e. reopened the hole (and is NULL on 3,999 of them anyway). The backfill runs under `app.cdc_origin='reverse'` so it neither replicates 4,290 rows nor lets `trg_set_updated_at` destroy their real modification times; the mirror half computes the identical value from the identical column. Verified: 0 `change_log` rows, `updated_at` non-null count unchanged (291). |
| **F2.1** 🟠 (follow-on, new) | The invoice guard read UTC as if it were local | `invoices.sys_start_time` is the schema's ONE creation stamp defaulted to `now() AT TIME ZONE 'UTC'` rather than `LOCALTIMESTAMP`, so batch 1's fix was reading a value 3h behind Baghdad: an invoice taken between 00:00 and 03:00 local read as **yesterday's**, and the person who had just entered it could not correct it. The guard's query now says `sys_start_time AT TIME ZONE 'UTC'`, yielding a `timestamptz` the driver resolves to the right instant. No data migration — the stored values are untouched. |

**Mirror halves + ordering** (`docs/db-migrations.md`): `expenses.created_at` is additive → mirror
FIRST (`migrations/supabase/expenses-created-at-2026-09-07.sql`), because the failover sink builds
its column list from the local row. `UNIQUE (work_id)` is restrictive → mirror LAST
(`migrations/supabase/diagnoses-unique-workid-2026-09-07.sql`), so the mirror never rejects a row
the source is still permitted to produce. Both applied in that order; `types/db.d.ts` regenerated.

**Runtime-verified** on a dev server against the live DB (writes made and then deleted; both DBs
back to 665 diagnoses / 4,290 expenses, `change_log` drained empty):
- sequential `POST /api/diagnosis` ×2 for one work → `created` then `updated`, one row;
- **6 concurrent** `POST /api/diagnosis` for a work with no diagnosis → exactly one `created`, five
  `updated`, **one row** (the shape that used to produce duplicates);
- an expense POSTed with `expense_date=2026-01-15` landed with `created_at` = the real wall clock,
  i.e. the guard now sees "created today" for the person who just entered it, and a back-dated
  `expense_date` no longer certifies its own age.


### Fixed in batch 3 — the long tail (2026-09-08)

29 findings, no schema change. Gate green (`typecheck:all` · lint 0 errors / the same 4 pre-existing
a11y warnings · **138 tests**, +21 · D1 0 / D2 9 · build), then runtime-verified on a dev server
against the live DB (see *Runtime verification* below).

**`utils/` (9)**

| # | Finding | What changed |
|---|---|---|
| **F4.1** 🔴 | `formatDatePattern` mangles literal letters | `[bracketed]` escaping, moment-style (brackets stripped, contents verbatim; an unclosed `[` is a literal bracket), so a template author can write `'DD MMMM YYYY [at] hh:mm A'` instead of getting `"… 2026 pmt 02:05 PM"`. The un-padded `D`/`M`/`m`/`s` tokens now exist too (`date:D/M/YYYY` used to render the literal `D/M`). The old `'[on] YYYY'` test asserted the *absence* of escaping and now pins the real behaviour, alongside the two mangling cases and the new tokens. |
| **F4.2** 🟠 | `stream-file` rejects suffix ranges | Range parsing rewritten to RFC 9110 §14 in a testable `parseByteRange(header, size)`: `bytes=-500` is the last 500 bytes (was `parseInt('')` → NaN → 416), an end past EOF clamps instead of 416-ing, and a MULTI-range request answers **200 with the whole file** (permitted) rather than silently returning only the first part as a 206 the client reads as complete. 8 unit tests. |
| **F4.3** 🟠 | Read stream leaked on client abort | `res.on('close', () => stream.destroy())` — a scrub/abort no longer leaves an `fs.ReadStream` reading to EOF with an fd held. |
| **F4.5** 🟡 | `phoneFormatter` triplication + dead members | `formatForWhatsApp`/`ForTelegram`/`ForSMS` (byte-identical) collapse into one `formatInternational`; `PhoneFormatter.forWhatsApp`/`forTelegram` are the two names the call sites read best. The identical-branch `if/else` in `normalizePhoneNumber` is one branch. The 6 zero-reference members are gone (`forSMS`, `forDatabase`, `forDisplay`, `forLocalDisplay`, `getLocal`, `extractCountryCode`) — the browser has its own `public/js/utils/phoneFormatter.ts`, so nothing else read them. |
| **F4.6** 🟠 | `extractCountryCode` reads Iraqi mobiles as Russia | Resolved by deletion (it was the last of the dead exports above, and its bare `startsWith('7')` probe had no correct fix that wasn't a full country-code table). |
| **F4.8** 🟡 | `video-mime.ts` duplicated `file-mime.ts` | `utils/video-mime.ts` deleted; `getMediaMimeType` now lives in `file-mime.ts`. It is `getFileMimeType` plus ONE documented override — `.ogg` → `video/ogg` for the video routes, because the shared table calls it `audio/ogg` (its registered use) and the video library stores Ogg *video* under it. Behaviour on both call sites is unchanged. |
| **F4.10** 🟡 | Dead exports in `utils/` | `getPathSeparator` + the `export default {…}` object deleted from `path-resolver.ts`, `resolvePath` de-exported (only `createPathResolver` uses it); `PG_SQLSTATE`/`asPgError`/`isNotNullViolation`/`isCheckViolation` + `PgDatabaseError` de-exported in `pg-errors.ts`; `ValidationSchemas` de-exported in `middleware/validate.ts`. |
| **F4.11** 🔵 | Stale mssql docblock in `date.ts` | Rewritten for the pg parsers (`date`→string, `timestamp`→local `Date`). |
| **F4.12** 🔵 | `filename-converter` cut at the first dot | Base name is now everything before the LAST dot: `patient.record.i99` → `patient.record.jpg`, not `patient.jpg`. |

**Boot / `config/` / `middleware/` (10)**

| # | Finding | What changed |
|---|---|---|
| **F1.1** 🟠 | `NODE_ENV ??=` ran after the imports it guards | `config/timezone.ts` → **`config/process-env.ts`**, which now sets BOTH `NODE_ENV` (default `production`) and `TZ`, and stays the first import in `index.ts`. ESM evaluates it before `csrf.ts`/`logger.ts`/`config.ts`, so the `npm start` path no longer gets a non-Secure CSRF cookie beside a Secure session cookie, or a console transport in production. `csrf.ts` carries a comment naming the dependency. |
| **F1.6** 🔵 | `startBackgroundDatabaseRetry` interval leaked | `unref()`-ed + registered with `ResourceManager` (and unregistered when the DB comes back), so shutdown clears it instead of relying on `process.exit`. |
| **F1.7** 🔵 | `/portal` double-`sendFile` | The fallback runs only while `!res.headersSent`; a mid-stream failure destroys the response instead of raising `ERR_HTTP_HEADERS_SENT`, and a missing fallback file 404s. |
| **F2.2** 🟡 | Dead barrel re-exports | The 8 zero-importer re-exports dropped from `middleware/index.ts` (`customTimeout`, `MemoryFile`, `TimeoutType`, `TimeoutValue`, `ResourceType`, `OperationType`, `GetRecordDateFn`, `RecordAgeOptions`); `customTimeout` (a one-line alias of `requestTimeout`) and the unused `MemoryFile` interface deleted at the source. The barrel's docblock now says what it is for. |
| **F2.5** 🔵 | `'code' in err` over-matched in the upload handler | Matched against multer's own code set (`MULTER_CODES`), so a pg SQLSTATE or `ENOENT` reaching that handler is no longer reported to the client as `Upload error: <raw message>` with a 400. |
| **F2.7** 🔵 | `authenticateWeb`'s unbounded `/api` prefix | Segment-bounded (`=== '/api' \|\| startsWith('/api/')`) — `/apifoo` no longer skips the web gate. |
| **F2.8** 🔵 | User-enumeration timing oracle | A cost-12 `bcrypt.compare` against a fixed dummy hash runs on the user-not-found path, so both failures cost the same. |
| **F3.1** 🟡 | Three `AppConfig` fields with no consumers | `config.google`, `config.urls.qrHost`, `config.dbDriver` removed (plus `GoogleConfig`/`DbDriver` in `types/`). The Drive/Contacts blocks already read `GOOGLE_CLIENT_ID/SECRET` directly; a comment says so, so the middle layer isn't re-added. |
| **F3.2** 🔵 | `envSchema`'s coercion was parsed and discarded | `envResult.data` is now the source for `server.port` (a real `number`, was `number \| string`) and `localsend.port` (no second hand-`parseInt`). `ServerConfig.port` narrowed to `number`. |
| **F3.3** 🔵 | `DATABASE_URL` query parameters dropped | `sslmode` and `application_name` survive resolution (`PG_SSLMODE`/`PGSSLMODE`/`PG_APPLICATION_NAME` win per field, like every other setting). `sslFromMode` maps libpq semantics onto `pg`: `require` encrypts WITHOUT verifying, `verify-ca`/`verify-full` verify, `disable` is explicit plaintext, `allow`/`prefer` resolve to no TLS, unknown warns. Absent mode ⇒ the key is not passed at all, so local connections are untouched. 6 new tests. |

**Contracts / validation boundary (7)**

| # | Finding | What changed |
|---|---|---|
| **F7.16** 🟠 | The D1 gate matched `interface` only | Both enforcement points widened to the `type` form: ESLint gains `TSTypeAliasDeclaration[id.name=/(Body\|Params\|Query\|Filters?)$/] > TSTypeLiteral` and `contracts-dod.mjs`'s D1 regex now matches `type X = {`. An ALIAS of a contract export has no literal body and correctly still passes. All six evaders converted first, so D1 stays 0: `PersonIdParams`, `CostPresetParams`, `TableNameIdParams` and `ExpenseQueryParams` are now aliases of new `z.infer` contract exports; `ExpenseFilters` (an internal parsed shape, never a request type) is renamed `ExpenseFilterValues`; `OAuthCallbackQuery` moved into a new **`shared/contracts/oauth-callback.contract.ts`** (request-side only — those endpoints 302, so there is no response to author) and is now *validated* on both Google callbacks. Verified by probe: a `type XParams = { … }` in `routes/` fails both gates; the alias form passes. |
| **F7.7** 🟠 | 4 Stand writes took a raw `req.body` | `updateCategory`, `updateItem`, `createSale` and `voidSale` each gained a contract `body` (typed partials for the two updates; `items[]`/`amountPaid` shapes for the sale; a non-empty `reason` for the void) and `validate({ body })`. The CART rules stay in `validateAndCreateSale` — the contract owns the shape, the service owns the semantics. Over-posted keys still pass through as before (`z.object` strips, it does not reject), so the existing clients are unaffected. |
| **F5.4** 🟠 | Query strings never crossed a validation boundary | The endpoints the audit named now validate: `/sendtwilio` + `/checktwilio` (`date` as a real calendar date), `/google`, `/convert-path`, `/stand/items` (incl. `stockStatus`, which used to be a bare `as` cast), `/stand/sales`, `/stand/items/expiring`, `/expenses/summary` (it had NO query guard at all), plus the F7.18 sites below. A repeated key (`?date=a&date=b`) is an array in Express and now 400s instead of reaching `sms.sendSms()` / a query layer. |
| **F7.18** 🔵 | Unvalidated numeric params → `NaN` → 500 | `workQuery.workId` and `paymentQuery.workId` became `numericParam` (validated STRING, so the handlers' `parseInt` is unchanged) and are wired on `/getworkdetails`, `/getworkdetailslist`, `/getpaymenthistory`; `:workId` gained `workIdParams` guards on `GET`/`DELETE /diagnosis/:workId` and `/getworkforreceipt/:workId`; messaging's `dateParams` went from `z.string()` to `dateString` and is wired on `/status/:date`, `/count/:date`, `/reset/:date`. Junk now 400s with a field-level message instead of PG `22P02` → 500. |
| **F7.19** 🔵 | `\|\|` where `??` was meant | `estimated_cost = ${estimatedCost ?? null}` (a legitimate estimate of **0** was being stored as NULL) and `currency ?? 'IQD'` (with the contract now rejecting an empty currency, so the fallback only covers absence); the alert quick-add uses `alertTypeId ?? 1` and the already-coerced `alertSeverity` instead of `x ? parseInt(String(x)) : d`; `detailId ?? itemId` + `id === undefined` on both work-detail routes; `/stand/items/expiring?days=` is validated and `?? 30` (was `parseInt(...) \|\| 30`, which mapped `days=0` to 30 and accepted negatives). |
| **F7.15** 🔵 | Photo-delete ownership guard surfaced as a 500 | The service throws a typed `PhotoOwnershipError`, which the route maps to **403**; `?path=` is contracted (`deletePhotoQuery`), so a repeated param 400s instead of throwing inside `key.startsWith`. |
| **F5.5** 🟡 | Dead exports in `shared/` | `nonNegInt` deleted (0 references anywhere); `YMD_RE`, `isRealYmd` and `ALIGNER_LAB_WORK_TYPE_ID` de-exported (used only inside their own module). **Deliberately kept exported:** `PatientTypeId`, `ClassifiableWork`, `ViewTag`, `GoogleContactAccount` — each appears in the signature of an exported function or const, so they are public API, not dead weight. |

**Auth + scripts (3)**

| # | Finding | What changed |
|---|---|---|
| **F6.3** 🔵 | `change-password` reported failure after the password had changed | Everything after the `UPDATE` (session regenerate + the newly added `session.save()`, matching `/login`) is wrapped in its own try/catch that logs and still answers 200. A rotation failure no longer tells the user to retry with a password that no longer works. |
| **F6.4** 🔵 | `change-password` stamped `last_login` | `verifyCredentials(username, password, { touchLastLogin })` — the change-password re-authentication passes `false`, so a password change is no longer recorded as a sign-in. |
| **F10.1** 🟠 | DB scripts ignored `DATABASE_URL` (and two inverted the app's precedence) | New **`scripts/_pg-connection.mjs`** resolves the local connection exactly as `config/pg-connection.ts` does (discrete `PG_*` win per field, `sslmode`/`application_name` carried, `.env`+`.env.development` loaded). All nine scripts use it: `db-migrate-check`, `db-baseline-{stamp,build,verify,dump}`, `reverse-sync-ops`, `_pgenv` (so `scripts/psql.sh` follows too), and the two mirror scripts whose URL-first order could have compared the WRONG local DB. The scripts are `.mjs` run by bare `node`, so this is a hand-kept mirror of the TS module — **`config/pg-connection.test.ts` now asserts the two agree field-for-field over 6 env shapes**, so drift fails the gate. `npm run db:check` re-run: still certifies the ledger (6 files, 6 rows). |

**Runtime verification** (dev server on `:3101` against the live DB, all read-only or reverted):
`GET /api/getworkdetails?workId=abc` → **400** field-level (was 500) and `workId=1` still resolves ·
`GET /api/diagnosis/abc` → 400 · `GET /api/getpaymenthistory?workId=abc` → 400, `workId=1` → 200 ·
`GET /api/expenses?limit=2&currency=IQD` and `?categoryId=1` return rows (the contract-coerced
numbers reach the filter correctly) · `/api/expenses/summary` 400s without dates, 200s with them ·
`/api/stand/items?stockStatus=bogus` → 400, valid → rows · `/api/stand/sales`, `/api/stand/items/expiring?days=0` → 200 ·
`/api/messaging/status/notadate` → 400, `/2026-09-07` → 200 · `/api/checktwilio?date=a&date=b` → 400 ·
`PUT /api/stand/items/21 {"costPrice":"abc"}` → 400, `{}` → 200 · `POST /api/stand/sales {"items":[]}` → 400 ·
`POST /api/stand/sales/101/void {}` → 400 · `DELETE /api/aligner/sets/1/photos?path=sets/999/x.jpg` → **403**
(was a 500), no `path` → 400 · video streaming: `Range: bytes=-500` → **206 `bytes 1270358-1270857/1270858`**
(was 416), `bytes=0-99` → 206, `bytes=0-10,20-30` → **200 full body**, `bytes=abc-` → 416 ·
`/api/admin/lookups/tables`, `/api/settings/cost-presets`, `/api/patients/1/files`, `/api/convert-path` all 200 ·
no errors in the server log.

### Fixed in batch 4 — the last third (2026-09-08)

The 27 remaining findings, closing the audit. Three needed a product decision and got one
(explicit gates everywhere · reject fractional money at the contract · password floor 8);
two turned out not to be defects on re-verification and are recorded as such. No schema change.
Gate green (`typecheck:all` · lint 0 errors / the same 4 pre-existing a11y warnings · **144 tests**,
+6 · D1 0 / D2 9 · build), then runtime-verified on a dev server against the live DB — including
**as a real `clinical` account**, not just as admin (see *Runtime verification* below).

**Authorization — the largest theme in the audit (2)**

| # | Finding | What changed |
|---|---|---|
| **F6.2 / F7.13** 🟠 | ~45 mutations with no `authorize()` | Every one now carries an explicit gate, so "any staff role may do this" is a decision on the page instead of the absence of a line. **CLINICAL_ROLES** (unchanged reach, now stated): aligner's 25 writes, templates ×4, video ×3, localsend ×3, share, messaging reset, the email send endpoints, the two WhatsApp send paths, `/tasks` + `/tasks/history`, and `/getpaymenthistory` + `/getworkforreceipt` (deliberately NOT finance — `WorkComponent` shows clinical staff payments read-only, and the gate now says so). **FINANCE_ROLES** (the secretary tier): the whole WhatsApp device surface — `/qr`, `/unlink`, `/restart`, `/refresh-qr`, `POST /initialize`, `group-settings` — plus `POST /api/calendar/regenerate` and `POST /aligner/payments` (a money write, matching payment.routes.ts). **ADMIN_ROLES**: the three branding writes, `/api/email/{test,test-send}` (the SMTP surface `/config` already held). Gates are **per-route, never a pathless `router.use`**, in every router mounted at `/` inside the api aggregator — a pathless gate there applies to every `/api/*` request merely passing through (the 2026-07-11 admin-403 incident); each such file now says so in its header. |
| **F7.13** 🟠 (Stand + the pairing QR) | Stand reads and the WhatsApp QR | Every `GET /api/stand/*` is **FINANCE_ROLES**: those reads carry cost prices, margins, cashier ids and the sales ledger — the same class of money data `/api/statistics` already gates — and the Stand *writes* were finance/admin already, so the reads were the odd ones out. `Dashboard.tsx` hides the Stand card for clinical the way it already hides Statistics, so nobody lands on an access-denied page. Gating `GET /api/wa/qr` alone would have been theatre: **`GET /api/wa/initial-state` returned the same pairing QR** and is called by `GlobalStateContext` on every page for every role. It stays open (it is the `clientReady` reconcile) but now returns `qr: null` unless the caller is FINANCE_ROLES. *Closed in batch 5 (below):* the SSE `whatsapp_qr_updated` frame, which was fanning the same QR to every authenticated stream and was therefore the way around both gates. |

**Product decisions (2)**

| # | Finding | What changed |
|---|---|---|
| **F7.9** 🟠 | Fractional money truncated or 500 | New **`moneyInt`** in `shared/validation.ts` — a coerced `.int()` with the message *"Amount must be a whole number — fractional amounts are not supported"* — on every request field that writes an `integer` money column: `expenses.amount`, aligner `amount_paid`, `sms.exchange_rate`, `patients.estimated_cost`, the intake `fee`s, `works.total_required`/`discount`, `work_items.item_cost`, and the Stand `costPrice`/`sellPrice`/`unitCost`/`amountPaid`. The two genuinely `numeric` columns — `estimated_cost_presets.amount` (18,2) and `aligner_sets.set_cost` (10,2) — are called out in the helper's docblock and deliberately excluded. With the boundary honest, the `parseInt(String(amount))` in `expense.routes.ts` ×2 and the Stand restock — *the truncation itself* — could go: those values arrive already coerced. Schema unchanged; USD cents remain unrepresentable, but now visibly rather than silently. |
| **F6.5 / F10.4** 🔵 | 6-character password floor | **`MIN_PASSWORD_LENGTH = 8`** + `passwordString` in `shared/validation.ts`, read by the user-management contracts, `POST /api/auth/change-password`, both React forms, and `scripts/reset-admin-password.js` (which runs under `tsx`, so it imports the constant rather than mirroring the number). Existing passwords are unaffected — the floor is checked only when one is set. No complexity rules. `role-registry.test.ts`'s `'secret6'` fixture became `'x'.repeat(MIN_PASSWORD_LENGTH)` so that suite keeps testing roles rather than password length. |

**CSRF-exempt mutations (1)**

| # | Finding | What changed |
|---|---|---|
| **F7.2** 🟠 | Mass messaging on a GET, `sameSite: 'lax'` | The state-changing GETs are **gone**, not merely gated — csurf never challenges a safe method, and a `lax` session cookie rides along on a top-level cross-site navigation, so one link click fired the day's whole reminder batch. `GET /api/wa/send?date=` → **`POST /api/wa/send`** with the date in the body (new `sendByDate` contract; the handler's hand-rolled format/validity checks collapse into `dateString`), client switched to `apiClient.post`. `GET /api/sendtwilio?date=` → **POST** (new `sendTwilio` contract; `/checktwilio` is a real read and stays a GET). `GET /api/email/test` → **POST** (it opens an outbound SMTP connection), client switched to `postJSON`. `GET /api/wa/initialize` **deleted** — it was a duplicate of its own POST twin, and `WhatsAppAuth.tsx` now calls that. Verified: each old URL falls through to the SPA shell, and `POST /api/wa/send` without a CSRF token 403s. |

**Correctness / robustness (5)**

| # | Finding | What changed |
|---|---|---|
| **F2.4** 🔵 | The 408 didn't abort the handler | Two fixes. (1) **One timeout registration, not two**: `req.setTimeout` and `res.setTimeout` are the same socket timer, so registering both never gave two deadlines — it gave two callbacks for one, the second logging a phantom "Response timeout exceeded" on every timeout. (2) A timeout still cannot interrupt an in-flight `await`, but it no longer lets the overrunning handler crash the error path: the 408 is followed by `res.end()`, and a new `isClosed()` guard in `utils/error-response.ts` makes a late `sendError`/`sendSuccess`/`sendData` a **no-op** instead of an `ERR_HTTP_HEADERS_SENT` throw that the handler's own `catch` re-throws into the global handler as a second, phantom 500 — one guard covering all ~140 senders. **`res.end()` is scoped to the `!headersSent` path on purpose**: a mid-flight file or video stream is not stuck waiting on a handler, and ending it would truncate the body (verified: `Range: bytes=0-99` and `bytes=-500` still answer 206 with the right `Content-Range`). |
| **F1.5** 🔵 | `/health/basic` ahead of all middleware | Registration moved from the module body into `initializeApplication()`, before the auth gate (it must stay public) but **after** `setupMiddleware`, so it is no longer the one route in the app served with no helmet headers and no request timeout. It also no longer reports `process.version` or `NODE_ENV` — an unauthenticated caller doesn't need the server's Node build, and `/api/health/detailed` is where real diagnostics live. Verified: HSTS + `X-Content-Type-Options` + `X-Frame-Options` now present. |
| **F4.7** 🔵 | Iraqi carrier-prefix allowlist | `isValidPhoneNumber`'s `75[01]\|77[0-9]\|78[0-4]\|79[0-5]` — a snapshot of which blocks the carriers had been assigned when it was written — becomes the structural rule `^9647\d{9}$`. Every prefix outside the old list was reported "invalid number" and the send simply never went out, so a newly-allocated block (752, 785, 796) silently made those patients unreachable. **13 new assertions** in `utils/phoneFormatter.test.ts` pin every input shape, the blocks the allowlist rejected, the wrong-shape rejections, and the non-964 fallback. |
| **F6.11** 🔵 | A pg + mssql pool per status poll | The Settings sync panel polls every 10 s and each tick built, TLS-handshook and tore down a whole `pg.Pool` (and an mssql `ConnectionPool` for Dolphin). Both are now built once, reused, `idleTimeoutMillis: 30_000` so pg drops the connection on its own when the panel closes, and registered with `ResourceManager` for shutdown; a failed Dolphin connect drops the pool so the next poll rebuilds. Verified: pool registered **once** across 5 polls, first poll 0.74 s (cold handshake) then a steady ~0.20 s. |
| **F9.2** 🔵 | Double-escaping in the public video player | `escapeHtml` is the wrong tool inside `<script>` — HTML entities are decoded in text/attribute position but **not** in a script block, so `Dr O'Brien's video` reached the share-filename code as `Dr O&#039;Brien&#039;s video` (and made the `.replace(/'/g, "\\'")` after it dead code). New `toJsStringLiteral` uses `JSON.stringify` plus `<`/`>`/U+2028/U+2029 escaping, which also closes the `</script>`-in-content hole `JSON.stringify` leaves open. Verified in the served page: `var videoTitle = "Brushing with Braces";`. |

**Dead code + boundary hygiene (5)**

| # | Finding | What changed |
|---|---|---|
| **F5.1** 🟡 | The hand-written `types/` layer | **984 lines → 347**, and every remaining export has a consumer. `types/services.types.ts` **deleted** outright (12 exports, zero importers, five of them — `PoolStats`, `HealthStatus`, `HealthCheckResult`, `RegisteredResource`, `DriveUploadResult` — shadowing the live declaration in the service that owns them). `api.types.ts` keeps the 5 symbols the middleware layer imports and loses the 22 that nothing did (incl. `ApiResponse`/`ApiSuccessResponse`/`UploadedFile`/`WorkRelatedCounts`, all re-declared elsewhere). `config.types.ts` exports **only `AppConfig`** — the 17 `*Config` interfaces it needs are now module-private, so `DatabaseConfig` here can no longer drift from the different `DatabaseConfig` that `services/settings/EnvironmentManager.ts` declares and the Settings screen actually uses — and the `Environment`/`RequiredEnvVars`/`OptionalEnvVars`/`EnvVars` block is gone (unreferenced, and it still listed the retired `DB_SERVER`/`DB_INSTANCE` as REQUIRED). Each file's header now says what may and may not be added back. |
| **F5.3** 🔵 | 12 type-only Zod schemas | Resolved the way batch 3 resolved its half — by making the runtime cost buy something rather than by deleting it. Four more are now **validated** at the boundary: `appointmentQuery` (`AppsDate` → `optionalDateString`), aligner `patientsQuery` (`doctorId` → `numericParam`), `getPresetsQuery`, and `sendAppointmentsQuery`; `videoIdParams` went from `z.string()` to `numericParam`. The other two were redundant *views*, not missing validation: `calendarQuery` and `visitQuery` were single loose all-optional shapes that 9 handlers typed themselves from **even though `validate()` had already proved a tighter shape** — a type-lie in the direction that hurts, since each handler re-checked what the boundary guaranteed and `/month-availability` could read a `date` field its route never validates. Both are replaced by per-endpoint `z.infer` aliases, and the now-provably-dead `as string` assertions in `calendar.ts` are gone. |
| **F6.10** 🔵 | `parseInt` without a radix | **All 208 sites** across `routes/`, `middleware/`, `utils/`, `services/`, `shared/` and `public/js/` now pass an explicit `10`, and **ESLint `radix: 'error'`** (both the backend and frontend blocks) keeps it that way — the durable half. Without it `parseInt('0x10')` is 16, so `DELETE /api/users/0x10` addressed user 16 on any route whose param lacked a `validate({ params })` guard. |
| **F8.2** 🔵 | `template-api.ts` NaN params | `templateIdParams`/`workIdParams` go from `z.string()` to `numericParam`, which covers all ten un-guarded `parseInt`s at once (kept a validated STRING, per the Express-5 note in CLAUDE.md, so the handlers' own `parseInt` is unchanged). The four writes gained `authorize(CLINICAL_ROLES)` in the same pass. Verified: `/api/templates/abc` → **400** (was a 500), `/api/videos/abc` → 400. |
| **F5.6** 🟡 | Unreferenced contract constants + row fragments | **✅ VERIFIED — not a defect.** Re-checked all 33 named symbols with a reference count that excludes the declaring file: every constant array feeds a `z.enum` in its own module, and every "row fragment never composed into a response" *is* composed into one (`alignerBatchRow` → `batches`, `labCaseEventRow` → `events`, `transferStatus` → a response, `alertStatusEnum` → two bodies, …). Four of the sibling type aliases (`ApprovalStatus`, `ApprovalActionType`, `AnnouncementAutoEvent`, `PortalActivityType`) are imported by `services/`, which is what makes the export convention load-bearing rather than noise. Exactly **one** symbol had zero references anywhere — `LabCaseEventType` — and it is deleted, with a comment saying why it alone went. |

**Also revised**

- **F7.23** 🟡 — the finding says `ensureCalendarRange` "writes inside every calendar READ". It does **not**: it is `SELECT MAX(app_date) FROM calendar`, report-only (`fillCalendar()` behind `POST /regenerate` is the only writer). The real defect was worse in a quieter way — all five reads `await`ed it and **discarded the result**, so every calendar render paid for a full-column aggregate whose answer nobody looked at, under a comment ("Ensure calendar has enough future dates") that was simply untrue. It is now `noteCalendarRange()`: throttled to once an hour per process, run **off** the request path, and it `log.warn`s when the calendar really has run short — the one thing the result was ever good for, and the prompt to run the regenerate endpoint.

**Runtime verification** (dev server on `:3101` against the live DB; every write reverted, and a
temporary `clinical` account created and deleted so the gates were proved by **denial**, not just by
an admin session passing through them). Zero errors in the server log across the whole run.

*As `clinical` — all **403**:* `/api/wa/qr` · `POST /api/wa/{unlink,restart,refresh-qr,initialize}` ·
`PUT /api/branding` · `DELETE /api/branding/logo` · `GET /api/stand/dashboard` · `GET /api/stand/items` ·
`POST /api/calendar/regenerate` · `POST /api/email/test` · `GET /api/email/config`.
*As `clinical` — still **200**, by design:* `/api/wa/initial-state` (with **`qr: null`**, where the admin
session gets the data URL) · `/getDailyAppointments` · `/api/tasks` · `/getpaymenthistory?workId=1` · `/api/videos`.

*F7.2:* `GET /api/wa/send`, `GET /api/wa/initialize`, `GET /api/sendtwilio`, `GET /api/email/test` all fall
through to the SPA shell (`text/html`) — no handler left to run · `POST /api/wa/send` 400s on a missing or
non-calendar date, 503s (WhatsApp not ready) on a valid one, and **403s without a CSRF token**.

*F7.9:* `amount=12.99` → 400 *"Amount must be a whole number"* (was stored as `12`), `amount=12` → 201 and
then deleted (newest expense back to 4635) · same 400 for `estimatedCost=100.5`, Stand `costPrice=1.5`,
Stand sale `amountPaid=1.5`.

*F6.5:* creating a user with a 7-character password → 400 *"Password must be at least 8 characters"*.

*F5.3 / F8.2:* `/api/templates/abc` → 400 (was 500) · `/api/videos/abc` → 400 · `AppsDate=nope` → 400 ·
`?AppsDate=a&AppsDate=b` (the repeated-key array) → 400 · `doctorId=abc` → 400 · `getvisitbyid?visitId=abc` → 400.
All six calendar reads and all three visit reads still 200; `/calendar/range` still 400s past 92 days.

*F1.5:* `/health/basic` answers 200 **with** HSTS + `X-Content-Type-Options` + `X-Frame-Options`, and its body
no longer carries `version`/`environment`.

*F2.4:* video `Range: bytes=0-99` → 206 `bytes 0-99/4878554`, `bytes=-500` → 206 `bytes 4878054-4878553/4878554`
— streaming is untouched by the new `res.end()`.

*F6.11:* `sync-status-failover-ping-pool` registered **once** across 5 polls; first poll 0.74 s (cold TLS), then ~0.20 s.

*F9.2:* the served player emits `var videoTitle = "Brushing with Braces";` — a real JS string literal.

### Posture changes worth confirming with the clinic

Batch 4 narrowed three surfaces that a `clinical` account could previously reach. All three are
deliberate, and all three are user-visible:

1. **The Stand is now front-desk/admin only** (reads included). The dashboard card is hidden for
   clinical accounts, so it fails closed rather than landing them on an error.
2. **WhatsApp device pairing is front-desk/admin** — a clinical account can still send messages, but
   cannot see the pairing QR, unlink, restart or start the client.
3. **Branding and the SMTP test/send endpoints are admin.**

Carried over from batch 1 and still worth confirming: **`PUT /api/patients/:personId` is FINANCE_ROLES**,
so a clinical account can no longer edit patient demographics.

### Fixed in batch 5 — the pairing QR on the SSE channel (2026-09-08)

Batch 4 closed the two HTTP paths to the pairing QR and recorded the SSE path as a deliberate
residual. This closes it. One finding, no schema change, gate green (**148 tests**, +4).

**Confirmed first, at runtime.** A dev server on the live DB with a temporary `clinical` account:
`GET /api/wa/qr` → **403**, `GET /api/wa/initial-state` → **`qr: null`** — and `GET /api/sse/whatsapp`
→ **200**, delivering four consecutive `whatsapp_qr_updated` frames each carrying a ~7.9 KB
`data:image/png;base64,…` pairing QR. Run beside an `admin` stream, the frames were byte-identical
and landed in the same millisecond. The server log also showed the clinical stream taking the
subscribe side effect (`QR viewer … registered. Active viewers: 1`).

| # | Finding | What changed |
|---|---|---|
| **F7.13** 🟠 (SSE half) | The pairing QR fanned to every authenticated stream | `services/messaging/sse-whatsapp.ts` now filters the **payload per stream** instead of gating the route. Each stream records **`mayPair`** at open (session role ∈ `FINANCE_ROLES`, no admin bypass — it is a plain membership test), and `broadcast()` takes an optional redactor, applied to `whatsapp_qr_updated` alone, that blanks `qr` for streams that may not pair. The redacted frame is built **lazily**, so a single-audience fan-out still costs one `JSON.stringify`. |

**Why not `authorize()` on the route.** Six of the seven wire events — `whatsapp_client_ready`,
`whatsapp_message_status`, the three `whatsapp_sending_*` frames and `whatsapp_send_unconfirmed` —
drive the send screens and `SendMessage`'s per-patient gate, and **sending is `CLINICAL_ROLES`**.
Gating the route would take all six out for two roles. It would also change *who* calls
`messageState.registerQRViewer()`, and `activeQRViewers > 0` is what gates QR generation and
on-demand init — i.e. it would change when WhatsApp initializes at all. Exactly one event, one
field, is privileged; the filter is scoped to precisely that.

**Why the frame is blanked rather than dropped.** It also carries `clientReady: false`, which is
app-wide state. `GlobalStateContext` previously inferred "not ready" from the *presence* of `qr`, so
a blanked frame would have left every non-finance tab believing WhatsApp was still linked and
`SendMessage` offering a send that could not go out. It now reads the frame's own `clientReady`.

**The QR-viewer count is deliberately unchanged.** Every stream still registers. Making it
finance-only would read better against the name, but sending is `CLINICAL_ROLES`: with only clinical
staff signed in and WhatsApp dropped, `checkAndInitialize` would return false and never self-recover.
The counter is really doing two jobs under one name — *is anyone watching the app* (gates init) and
*is anyone waiting to pair* (gates the QR in `/initial-state`) — and splitting it is a separate
change. There is no residual leak either way: `/initial-state:821` still blanks the QR via `mayPair`.

**Role staleness.** `mayPair` is snapshotted at open, exactly as fresh as every `authorize()` gate —
`req.session.userRole` is written only at login (`auth.ts:94`, `:267`), and `user-management.ts` never
touches live sessions, so a role change already takes effect nowhere until re-login. Each EventSource
reconnect (the `retry` frame, plus the client singleton's visibility/bfcache forced reconnect) re-runs
`authenticate` and re-takes the snapshot, so a demotion lands at the next reconnect at the latest.

**Verified after the fix**, same dual-stream setup, same emit: `front_desk` and `admin` received the
real data URL while `clinical` received **`qr: null`** — and all three still received `clientReady`.
`front_desk` was checked explicitly rather than relying on `admin`, since `mayPair` has no admin
bypass. New regression test `services/messaging/sse-whatsapp.test.ts` (4 cases) pins all four
guarantees; **confirmed failing** with the redactor unwired (2 of 4 fail on the exact bug) and passing
with it.

### Fixed in re-review batch 6 — negative money + the rest of the error leak (2026-09-09)

Two findings from the independent 2026-09-09 re-review, both gaps rather than regressions. Full
reasoning, runtime evidence and the retracted third finding are in *Re-review 2026-09-09* below.
Gate green (**167 tests**, +19 · lint 0 errors · D1 0 / D2 9 · build), then runtime-verified against
the live DB with every write reverted.

| # | Finding | What changed |
|---|---|---|
| **R1** 🟠 | Negative money accepted on the whole payment path (F7.9 covered fractional, never sign) | The non-negative floor went into **`moneyInt` itself**, so all 12 money fields inherit it and a 13th added later does too; `amountPaid` and the aligner `amount_paid` add `.positive()`. `change` needed the floor independently (`calculateValidatedChange` validates only when `> 0`). A lower bound also went into the **locked** write path in `addInvoiceWithBalanceGuard`, whose only test was `> remaining` — which any negative passes — so non-HTTP callers are covered too. `POST /api/addInvoice {"amountPaid":-100000}` inserted a negative invoice that RAISED the work's outstanding balance and skewed every sum over `invoices.amount_paid`, commissions included. |
| **R2** 🟠 | The F4.4 production leak fix dev-gated only `details instanceof Error`, leaving 3 shapes | Hand-built `{ error: err.message }` details (→ 0) and raw `res.json({error: err.message})` (→ 0, which also restored the F2.4 `isClosed` guard on those 10 sites); 5 of 10 raw-message-as-message sites fixed, 5 kept with inline disables because those modules humanize everything they throw. Fell out of it: **F2.5 was incomplete in its own file** (`handleUploadError`'s `else if (err)` still forwarded raw text, and 2 route-local copies were never narrowed) → all three now share `uploadErrorMessage()` + a new `UploadRejectedError` marker; and every `ErrorResponses.*` `details` param widened to accept an `Error`, since only the two 500 helpers did — which is *why* handlers hand-built the unsafe object for a 400/403. Durable half is an ESLint `no-restricted-syntax` selector, not a runtime scrubber (a blanket scrub would have broken `BatchFormDrawer`'s `details.message` and `useApiMutation`'s `details.code`). |

New tests: `shared/money-sign.test.ts` (13) + `utils/error-response.test.ts` (6). The money suite was
**confirmed failing** (5 of 13) with the floor reverted; the leak selector was probed against all
four bug shapes and the three correct forms.

### Still open — not part of this batch

> Re-confirmed unchanged on 2026-09-09: the route is still public and the payload still carries
> `{pid, name, images, latestVisit}`. Current refs: `sse-broadcaster.ts:161` (route),
> `:174` (incumbent eviction), `chair-payload-builder.ts:61` (the `latestVisit` clinical note).
> Listed in *⏭️ Open work* as the one item needing a product decision before any code.

**`/sse/chair-display/:chairId` is public and carries PHI.** Deliberately session-less (the kiosk has
none), but verified at runtime: an unauthenticated listener received a patient's `pid`, **full name**
and intraoral image filenames, and `chair-payload-builder.ts:64` adds `latestVisit {visit_date,
Summary}` — a clinical note — for active orthodontic work. Two aggravating factors:

1. **Stream hijack.** `sse-broadcaster.ts:166` ends the incumbent when a second connection claims the
   same `chairId`. Verified: the incumbent closed at exactly 3.00 s, the moment a second anonymous
   connection arrived, and the newcomer immediately got the 12 h-TTL replay of the loaded patient. An
   unauthenticated client can both eavesdrop and knock the real kiosk off its chair.
2. **`config_cloudflared.yml` routes the whole `remote.shwan-orthodontics.com` host to
   `localhost:3000` with no path filter**, so this is internet-reachable unless a Cloudflare Access
   policy sits in front of that hostname — not determinable from the repo; needs checking in the Zero
   Trust dashboard.

`authenticate` cannot fix it (the kiosk has no session). The shapes that fit are a per-chair bearer
token in the kiosk URL or an interface/IP allowlist — a real design decision, deliberately not
bundled with the QR fix.

> **❌ CORRECTION (batch 7, 2026-09-12): the parenthetical above is FALSE, and it is what kept this
> open.** The kiosk *does* have a session — `/chair-display` is a route of the staff SPA, served by
> `routes/web.ts` from behind `authenticateWeb`, and its `/DolImgs` intraoral images render only
> because the session cookie is sent. `authenticate` was always the fix. The stream now mounts under
> `/api/sse` with the other two. No token scheme, no allowlist. The lesson is the one this tracker
> keeps re-learning: verify the premise in the code before pricing the fix.

**`/api/sse/appointments` is clean.** 401 without a session (verified). `appointments_updated` is
`{date}`; `photos_rendered` is `{personId, tpCode, written, warnings, total}`. Record ids and
counters, and all three roles legitimately use both surfaces. No filter warranted.

### Fixed in batch 7 — every remaining open item except R9's tail (2026-09-12)

Each open item was first **re-verified against the code** rather than taken from this tracker's own
description of it. Three descriptions turned out to be wrong; those corrections are called out below
because they changed what the right fix was. Gate green (typecheck · lint 0 errors · **167 tests** ·
D1 0 / D2 9 · build), then runtime-verified on a dev server against the live DB, every write reverted.

| # | Finding | What changed |
|---|---|---|
| **chair-display** 🟠 (was "needs a product decision") | Public SSE stream carrying PHI | **The premise was false.** The kiosk is NOT session-less: `/chair-display` is a route of the *staff* SPA (`routes.config.tsx`), whose shell `routes/web.ts` serves from behind `authenticateWeb` — its `<img src="/DolImgs/…">` intraoral photos render only because the session cookie rides along (verified: `/chair-display?chair=1` → 302 for an anonymous client). So no token scheme was needed: the router moved to `app.use('/api/sse', …)` with the other two, and the `/sse` mount is gone. Verified 401 anonymous / 200 with a session / stream delivers. The kiosk now also reloads itself when its stream reaches CLOSED (`CLOSED_STREAM_RELOAD_DELAY_MS`), because EventSource never retries after a 4xx — without that an expired session would freeze the display on "Reconnecting…" forever. |
| **R3** 🔵 | 9 reference GETs mounted pre-gate | Both routers moved behind the gate, mounted immediately before `apiRoutes` so path precedence is unchanged. Re-verified behaviour-neutral first: grepped `public/js/portal`, `ChairDisplay.tsx` and `login.html` for all 9 endpoints — **zero unauthenticated consumers**. Now 401 anonymous / 200 with a session. |
| **R4** 🟡 | Mutations with no explicit `authorize()` | **The count was wrong** — the prose said "8 across 6 files", its own table listed **12 endpoints across 7 files**. All 12 gated, resolving alias gates (`clinicalOnly`/`adminOnly`) and path-scoped `router.use` to avoid the first scan's false positives: slideshow ×3 + telegram `/send` + 3Shape initiate-workflow + chair-display ×2 → `CLINICAL_ROLES`; portal-activity ×2 → `ALL_ROLES`; `POST /patients/transliterate-name` → `CLINICAL_ROLES` (it spends money — it calls Gemini); `sync-webhook` ×2 → `ADMIN_ROLES` (no callers anywhere in the repo; debug-only). |
| **R5** 🟡 | `broadcastDays` bypassed; key derived 3 ways | **The headline scenario was not reachable** from the app's own UI: all three senders (`EditAppointmentForm`, `AppointmentForm`, `AppointmentCalendar`) build `YYYY-MM-DDTHH:mm:ss`, so `split('T')[0]` was right for every real caller — latent, not live. Fixed at the root anyway: `app_day` is `GENERATED ALWAYS AS ((app_date)::date) STORED`, so the DB now returns it (`RETURNING "app_day"` on update, `.returning([…, 'app_day'])` on insert) and no JS re-derives it. All six handlers go through `broadcastDays`; `wsEmitter.emit` appears only inside the helper; the 12-line inline `toDateOnly` copy is gone. `appDay` is split off before `sendData`, so every contracted response is byte-identical. |
| **R6** 🔵 | Two listeners, one deadline, wrong number reported | Confirmed precisely: `res.setTimeout(ms, cb)` *replaces the duration but appends the listener*, so on the 5 extended routes the global callback — registered first — fired at the **extended** deadline and wrote `timeout: 30000` into both the 408 body and the log. `requestTimeout` now tracks its callback in a `WeakMap<Response, …>` and removes the previous one before registering; only its own listener is touched, so anything else listening on `'timeout'` is unaffected. |
| **R7** 🟡 | `holiday.routes.ts` mounted twice | The `index.ts` mount + its import deleted; the aggregator's mount (which always won, being registered first) is now the only one, with a note saying so. The route itself is live (`HolidayEditor`, `AppointmentCalendar`) and still resolves. |
| **R8** 🔵 | `db:migrate` resolved its DB differently from the guard gating it | New `scripts/run-migrate.mjs`: resolves through `_pg-connection.mjs` (the same resolver `db:check` uses), exports a fully-specified `DATABASE_URL`, then spawns node-pg-migrate — which loads dotenv itself but never overrides an already-set variable, so its own resolution becomes a no-op. `db:migrate`, `:down` and `:new-migration` all route through it. It prints the target as `user@host:port/db` (never the URL — that carries the password). Verified end to end: guard certifies, migrator connects to the same database, "No migrations to run". |
| **R9(e)** 🔵 | `services/` had no in-repo audit record | New **`docs/services-audit.md`** — coverage map + decision log for the 2026-08-13 and 2026-08-31 sweeps, explicitly labelled as reconstructed, with everything it asserts re-verified against the code. The two deliberate non-fixes (full `auth/drive` scope, anyone-with-the-link PDF sharing) now also carry `AUDIT DECISION` comments **at their call sites** in `google-drive-client.ts`, so the next reader meets the decision where the code is, not only in a doc. |
| **R9(a)** 🟠 (the half that was a bug class) | Routers mounted at `/` with self-prefixed absolute paths | `admin.ts` and `sync-webhook.ts` were mounted at the app root while writing `/api/admin/…` and `/api/sync/…` into every route path. That mismatch — effective URL in one file, gate in another, resolution by hand-ordered registration — is precisely what produced **F6.7** and **R3**. Both now use relative paths and are mounted at their real prefixes (`/api/admin`, `/api/sync`). `admin.ts`'s gate goes back to a plain pathless `router.use(authorize(ADMIN_ROLES))`, which is safe *because* the mount is now correct — the 2026-07-11 incident happened when that same line sat in a root-mounted router. Google's registered OAuth redirect URIs are unchanged (the mount supplies the prefix). Verified: all 5 admin + 5 sync routes resolve, 401 anonymous, and the SPA/portal/TV surfaces are unaffected by the removed root mount. |

**Runtime verification** (dev server, live DB, all writes reverted — `appointments` back to 70,202
rows, 0 leftovers, no `change_log` residue):

- create appointment → SSE frame `{"date":"2027-03-15"}`;
- **update with a space-separated `app_date`** (`"2027-03-16 11:00:00"` — the shape that used to emit
  the whole string as the broadcast key) → two correct frames, `2027-03-15` (day it left) and
  `2027-03-16` (day it landed on);
- delete → `2027-03-16`; quick check-in → today's date from the row's own `app_day`;
- the created/updated responses carry no `appDay`, confirming the contracted payloads are unchanged;
- `/api/sse/chair-display/1`: 401 anonymous, 200 + `retry:` frame with a session; old `/sse/…` path 302s;
- newly gated mutations still 200/202 for an admin session (chair-display, portal-activity, sync trigger).

**Deliberately NOT done in this batch** — the rest of R9. `(b)` moving ~80 SQL statements into the
query modules and `(c)` splitting the god files are incremental, per-domain refactors; doing them as
a bulk sweep at the tail of a security change set is how the next incident gets written. `(a)`'s
remainder (filing 4 correctly-behaved routers) is blocked on a route-table snapshot test, for the
reason given in *Open work*. `(d)` is cosmetic and would have churned 13 importers inside a diff that
reviewers need to read for gate changes.
*(All of the above were done later: `(b)` in B1-B5, and `(a)` + `(d)` + C1/C2/C3 in session S1, both
on 2026-09-13.)*

## Re-review 2026-09-09

An independent second pass over the same scope, on the premise that ~2,800 lines of remediation
code across 5 batches had never themselves been reviewed. Method: re-read the fix code (not the
tracker's description of it), then sweep for classes the first pass could have missed, then verify
at runtime against the live DB.

### Verification of the existing remediation — holds up

Gate re-run green. The high-risk fixes were re-read and are correct:

- **`isUnderClinicRoot`** (F7.1) — normalizes `..` *before* the prefix test, separator- and
  case-insensitive; `sendmedia2`'s real callers only ever pass `clinic1/`-rooted paths (traced
  through `/api/convert-path` → `workingFilePath`). *Residual, unaddressed:* it is a path-STRING
  check, not `realpath`, so a symlink planted inside `clinic1/` would pass. Low probability (the
  tree is a staff-writable share, but Windows symlink creation needs privilege). Noted, not filed.
- **`parseByteRange`** (F4.2) — RFC 9110-correct including suffix ranges, EOF clamping,
  multi-range → 200, and `suffix === 0` / empty file → 416.
- **`formatDatePattern`** (F4.1) — bracket escaping and the un-padded tokens behave as documented.
- **`sse-whatsapp` redactor** (F7.13 SSE half) — per-stream `mayPair`, lazily-built redacted frame,
  frame blanked rather than dropped so `clientReady` still propagates. Sound.
- **`process-env.ts`** (F1.1) — genuinely the first import; an unset `NODE_ENV` now fails safe.
- **Dummy bcrypt hash** (F2.8) — **verified, not assumed**: `getRounds()` on the literal returns
  **12**, matching `hashPassword`. Real timing parity.
- **`sslFromMode`** (F3.3) — libpq semantics correct (`require` encrypts without verifying).
- The 2026-07-11 pathless-gate house rule **still holds**: all 3 pathless `router.use(authorize(…))`
  sit in routers mounted on a real prefix (`/api/users`, `/api/admin`, `/integrations`), verified
  individually.
- Clean sweeps: **0** `parseInt` without radix in the whole backend; no unsafe `sql.raw`/`sql.id`
  (every identifier comes from `LOOKUP_TABLE_CONFIG`, values parameterized, `sql.lit` takes only
  hardcoded 200/500); **all 5** outbound `fetch` calls carry `AbortSignal.timeout`.

### ✅ R1 🟠 FIXED — negative money was accepted on the whole payment path

F7.9 fixed *fractional* money and never considered **sign**, and `payment.contract.ts` was not even
switched to `moneyInt`. Traced to the bottom: `PaymentService.ts` checks only
`requestedAmount > remaining`, and the authoritative locked re-check in
`addInvoiceWithBalanceGuard` also checks only `> remaining` — a negative passes both trivially.
So `POST /api/addInvoice {"amountPaid": -100000}` inserted a negative invoice, which does not merely
record a wrong figure: it **RAISES** the work's outstanding balance and skews every report summing
`invoices.amount_paid`, the doctor-commission figures included. Reachable by `FINANCE_ROLES`, i.e.
any front-desk account. `PaymentModal`'s own client check is `if (!amountPaid)`, which `-500` passes.

| What changed | Where |
|---|---|
| The floor went into **`moneyInt` itself** (`.nonnegative()`), not the 6 forgetful call sites — no money column in the schema legitimately takes a negative, so the safe answer is the default. Docblock records why. | `shared/validation.ts` |
| All four `invoices` money fields now go through `moneyInt`; `amountPaid` adds `.positive()` (0 is not a payment). **`change` needed the floor independently** — `calculateValidatedChange` validates only when `changeAmount > 0`, so a negative slid through unchecked into the column. The cash legs were already service-guarded; stating it at the boundary turns it into a field-level 400 and the service guard stays for non-HTTP callers. | `shared/contracts/payment.contract.ts` |
| Lower bound added to the **locked** write path beside the existing `> remaining` check, so a script / future service / reverse-sink that never crosses the request boundary is covered. New `negative_amount` outcome → `PaymentService` maps it to the **existing** `NEGATIVE_AMOUNT` code (no new synonym). | `payment-queries.ts`, `PaymentService.ts` |
| `.positive()` so the boundary agrees with `AlignerService.validateAndCreatePayment`'s existing `<= 0` throw. | `shared/contracts/aligner.contract.ts` |

**Runtime-verified** (dev server on `:3101` against the live DB): `amountPaid = -100000` → **400**
*"Amount cannot be negative"* + *"must be greater than zero"* · `= 0` → 400 · `= 12.99` → 400 (F7.9
still holds) · `change = -500` → 400 · `iqdReceived = -1` → 400 · `= 5000` → **200**, invoice 43760
created, then deleted. Invoice count 31269 → 31269, work 4's paid total back to 2,750,000.
New `shared/money-sign.test.ts` (13 cases), **confirmed failing** (5 of 13) with the floor reverted.

### ✅ R2 🟠 FIXED — the F4.4 production error-leak fix had three unplugged shapes

`sendError` dev-gates `details` **only** on its `details instanceof Error` branch. Every call site
that hand-built `{ error: err.message }` therefore bypassed the gate and shipped the raw
driver/fs/SQLSTATE text to the browser in production — exactly what
`middleware/error-handler.ts` documents itself as preventing.

- **Group A — hand-built `details` objects → now 0.** The dominant single-key shape went
  mechanically; three needed judgment (`patient.routes.ts` ×2 — the X-ray `note` moved into the
  message, which was the half worth showing; `whatsapp.routes.ts`, whose message was the
  uninformative `'operation failed'`).
- **Group C — raw `res.json({error: err.message})` → now 0.** All 10 in `admin.ts`, `email-api.ts`
  and `sync-webhook.ts` now go through `ErrorResponses`, so they also pick up the `isClosed()`
  guard (F2.4) they were bypassing entirely.
- **Group B — 5 fixed, 5 deliberately kept.** Fixed: `aligner.routes.ts` (raw PDF error
  concatenated into the message), the two route-local multer handlers, `tv-display.routes.ts`
  (`commitUpload`'s fs errors), and `template-api.ts`. Kept, with inline disables naming the
  reason: LocalSend and telegram-auth hand-write every message they throw.

**Two things fell out of doing it properly:**

- **F2.5 was incomplete in its own file.** `handleUploadError`'s `else if (err)` branch still
  forwarded raw messages, so the batch-3 narrowing only ever covered half the paths into that
  function — and `media.routes.ts` / `file-explorer.routes.ts` held unfixed copies of the same
  `'code' in err` test. All three now share **`uploadErrorMessage()`**, and a new
  **`UploadRejectedError`** marker lets a curated `fileFilter` verdict through while an `EACCES`
  off the staging `mkdir` does not. `handleUploadError` now `next(err)`s a non-upload error to the
  global handler instead of relabelling it a 400 "Upload error".
- **`ErrorResponses.*` `details` params widened to `ErrorDetails` (accepts an `Error`).** Only the
  two 500 helpers did before — which is *why* handlers hand-built `{ error: err.message }` for a
  400/403/409: the unsafe form was the only one available. The safe form is now always available.

**The runtime scrubber originally proposed was deliberately NOT built.** A blanket production scrub
of `details.message` would have silently degraded real UI: `BatchFormDrawer.tsx:296` reads
`details.message` first, `useApiMutation.ts:70` reads `details.code`, and `validate()` ships Zod
issues there. The durable half is a **lint ratchet** instead — a `no-restricted-syntax` selector in
the `routes/**` block, probed against all four bug shapes and the three correct forms. It also
caught a site that had been waved through (`template-api.ts` string-matched `'system template'`),
now a typed **`SystemTemplateError`**.

**Runtime-verified:** non-PDF to the aligner PDF upload → 400 *"Only PDF files are allowed"* (the
curated `fileFilter` message survives) · wrong field name → 400 *"Unexpected file field name."* ·
both converted status endpoints still 200 on the success path · no `ERR_HTTP_HEADERS_SENT` in the
log. New `utils/error-response.test.ts` (6 cases) pins the gate in **both** `NODE_ENV` modes,
asserting a constraint name never appears in a production body, plus the `isClosed` no-ops.

**Correction to this session's own first report:** the initial count of "13 group-A sites" was
inflated — the first scanner matched within a fixed character window and swept in adjacent
`log.error({ error: err.message })` calls. Re-written to parse actual call arguments with balanced
delimiters, the real counts were A=3 remaining after the mechanical pass, B=10, C=10.

---

### ✅ R3 🔵 FIXED (batch 7) — 9 reference-data GETs were mounted before the auth gate

`app.use('/api', costPresetRoutes)` and `app.use('/api', lookupRoutes)` are at **`index.ts:314-315`**;
the staff gate `app.use('/api', authenticate)` is at **`:374`**. So these are reachable with **no
session at all**: `GET /api/settings/cost-presets` plus the 8 lookup GETs
(`/referral-sources`, `/patient-types`, `/addresses`, `/genders`, `/alert-types`,
`/implant-manufacturers`, `/shades`, `/labs`).

**This was first reported as 🟠 "the clinic's price list is public" — that framing was WRONG and is
retracted.** The rows were checked: `estimated_cost_presets` is a uniform arithmetic ladder
(2.0M→3.5M IQD in 100k steps, 1500→2500 USD in 100s) — the *range of a dropdown*, not what anyone
was charged. Real prices live in `works.total_required` / `patients.estimated_cost`, both properly
gated. `labs` is two rows (`Atalay`, `Emax`). The Stand analogy used to justify the original
severity does not hold: Stand reads carry actual cost prices, margins, cashier ids and the sales
ledger. **Severity 🔵, on structure, not data.**

What still justifies acting: `cost-preset.routes.ts`'s three mutations are protected **only** because
someone remembered to type `authenticate, authorize(ADMIN_ROLES)` inline on each one, and the file's
own header says so ("each route must add its own … there is no gate above it"). That is a documented
footgun, not a control — the next `router.post` added to either file is silently public. Same failure
mode as F6.7, different file.

**Verified free to fix:** every consumer is a staff-SPA React Query factory
(`public/js/query/queries.ts`, Settings components). Nothing in `ChairDisplay.tsx`, `public/js/portal/`
or `login.html` touches them, so moving both mounts below `:374` is behaviour-neutral and lets the
three inline gates collapse into the normal pattern. **Bundle with R9(a); not worth a standalone
change.**

### ✅ R4 🟡 FIXED (batch 7) — mutations with no explicit `authorize()` (**12**, not 8 — see below)

> **Correction (batch 7):** the "8" below is a miscount of this section's own table, which lists
> **12 endpoints across 7 files**. All 12 were gated.

Batch 4 recorded "~45 mutations … every one now carries an explicit gate". A fresh scan (accounting
for path-scoped `router.use` gates, which the first scan missed) finds the genuine remainders after
excluding the deliberately-open set (auth login/logout/change-password, portal login/logout, the
`client-error` sink, the secret-authenticated 3Shape webhook):

| File:line | Route | Note |
|---|---|---|
| `slideshow.routes.ts:42, :60, :85` | `POST` / `PUT` / `DELETE /slideshow-configs` | Header states the `authenticate`-only posture, but never states a role |
| `telegram.routes.ts:107` | `POST /telegram/send` | Its WhatsApp twin got `CLINICAL_ROLES`; paths are safely resolved via `resolveShareRef`, so this is consistency only |
| `threeshape.routes.ts:44` | `POST /threeshape/patients/:personId/initiate-workflow` | |
| `chair-display.routes.ts:35, :56` | `POST /chair-display/patient-loaded`, `/patient-cleared` | Probably all-clinical by intent; unstated |
| `portal-activity.routes.ts:50, :69` | `PATCH /portal-activity/read`, `/read-all` | Benign (marks bell rows read) |
| `patient.routes.ts:1008` | `POST /patients/transliterate-name` | Calls out to Gemini — an ungated cost path |
| `sync-webhook.ts:44, :75` | `POST /api/sync/trigger`, `/queue-notify` | Both only kick an idempotent drain |

All low blast radius; the value is finishing the stated invariant so the posture is written down
route by route. **`tv-display.routes.ts` is NOT in this list** — it has a correct path-scoped
`router.use('/tv-display', authorize(ALL_ROLES))`, which the first scan false-negatived.

### ✅ R5 🟡 FIXED (batch 7) — `broadcastDays` was bypassed by 4 of 6 handlers, and the key was derived 3 ways

`broadcastDays` (`appointment.routes.ts:68`) says in its own docblock *"Every mutating handler in this
file must call this"*, and batch 1 recorded it as "the single path every mutating handler uses". It is
called at only **:529** and **:587**. Four handlers still emit directly at **:229**, **:291**,
**:367** and **:636**, bypassing the null/duplicate guard the helper exists to provide.

Worse, the broadcast key is computed three different ways, and the newest is the weakest:

1. `appDay ?? toDateOnly(now)` (`:225`, `:288`) — correct, this is the F7.6 fix.
2. A **12-line inline reimplementation of `toDateOnly`** (`:352-366`) — handles both the
   `YYYY-MM-DD` and the `Date` branch, so it is correct but duplicated.
3. **`app_date.split('T')[0]`** in `validateAndUpdateAppointment` (`AppointmentService.ts:397`) —
   the contract for `app_date` is deliberately `z.string().min(1)` ("the AppointmentService owns
   multi-format date parsing"), so a space-separated `'2026-09-10 14:30'` yields **that whole string**
   as the broadcast day. The `UPDATE` succeeds, the frame goes out with a key no client matches, and
   the board silently never refreshes.

**Fix:** `app_day` is a **stored generated column** (`GENERATED ALWAYS AS ((app_date)::date) STORED`,
baseline:540) — have the `UPDATE` do `RETURNING "app_day"` and take the authoritative value, then
route all six handlers through `broadcastDays` and delete the inline copy in favour of `toDateOnly`.

### ✅ R6 🔵 FIXED (batch 7) — the timeout fix had the same phantom one layer up

Batch 4's F2.4 fix is titled "One timeout registration, not two" and correctly collapsed the
`req.setTimeout` + `res.setTimeout` pair inside `requestTimeout`. But the global
`app.use(requestTimeout(TIMEOUTS.DEFAULT))` (`index.ts:253`) and a route-level override register
**two listeners on the same `res`**, recreating the same shape.

**Measured in Node** (not inferred): both listeners fire, at the **last-set** deadline, and the
global one fires **first**:

```
A(300) at 909 ms
B(900) at 909 ms
```

So on the 5 routes with an override — `whatsapp.routes.ts:87` (`whatsappSend`, 5 min), `:539`,
`:571`, `aligner.routes.ts:902`, `file-explorer.routes.ts:492` (all `long`, 2 min) — the 408 body's
`details.timeout` and the `log.warn` both say **`30000ms`** for a request that actually ran 120 s or
300 s. Diagnostic only, no wrong status code, but it misreports the one number the log exists to
carry. Fix: have the route-level preset replace rather than add (track the registered listener on
`res` and remove the prior one), or read the elapsed time instead of the declared value.

### ✅ R7 🟡 FIXED (batch 7) — `holiday.routes.ts` was mounted twice

`routes/api/index.ts:138` (`router.use('/holidays', holidayRoutes)`, reached via
`app.use('/api', apiRoutes)`) **and** `index.ts:415` (`app.use('/api/holidays', holidayRoutes)`).
Both resolve to the same `/api/holidays/*` URLs and both sit after the auth gate, so there is no
security impact — the second mount is simply dead, since Express matches the first. Remove
`index.ts:415`. The file's header also documents three responsibilities for a router that implements
one route (`GET /appointments-on-date`, live — two client callers in `HolidayEditor.tsx` and
`AppointmentCalendar.tsx`).

### ✅ R8 🔵 FIXED (batch 7) — `db:migrate` did not use the F10.1 connection resolver

F10.1 made all nine `scripts/*.mjs` resolve the local DB exactly as `config/pg-connection.ts` does
(discrete `PG_*` win per field), with `config/pg-connection.test.ts` asserting the two agree so
drift fails the gate. But the migrator itself is outside that: `db:check` (wired as
`predb:migrate`) resolves through `scripts/_pg-connection.mjs`, while `db:migrate` is bare
`node-pg-migrate up -m migrations/pg`, which resolves `DATABASE_URL` its own way.

On this box both forms name the same database (`172.20.0.1:5432/shwan`), so it is **latent, not
live**. But it re-opens precisely the hazard F10.1 was filed for — *the guard certifies one database
while the migrator writes another* — on any machine where the two disagree. Fix: have `db:migrate`
take its connection from the same resolver (e.g. export `DATABASE_URL` from
`scripts/_pg-connection.mjs` before invoking `node-pg-migrate`), so one resolver feeds both.

### R9 🟠 PARTLY FIXED (batch 7: the self-prefixed-router half of (a), plus (e)) — organization

Verdict: the backend is **well organized overall** — layer boundaries are explicit, the contract SSoT
is CI-enforced, `utils/` is 18 tight cross-cutting modules, and the Aug-2026 `services/` reorg
recorded its reasoning. Four real problems, in priority order.

> **✅ Half fixed (batch 7).** The *hazardous* half — `admin.ts` and `sync-webhook.ts` mounted at `/`
> while self-prefixing `/api/...` — is gone: relative paths, mounted at `/api/admin` and `/api/sync`.
> `holiday`'s duplicate mount (R7) and the pre-gate reference-data mounts (R3) went with it. What is
> left is filing 4 correctly-behaved routers, which changes no URL and should ride a route-table
> snapshot test — see *Open work*.
>
> **✅ FULLY CLOSED in session S1 (2026-09-13).** The snapshot test was built first
> (`app/mount-routes.test.ts`), then the 4 routers were filed under `routes/api/` with the mounts
> left in place — so the snapshot came back **byte-identical**.

**(a) `routes/` runs two competing conventions, and that is the source of a bug class.**
41 files as `routes/api/*.routes.ts` behind an aggregator; **9 unsuffixed files at `routes/*.ts`**
mounted by hand in a 960-line `index.ts` — of which **6 serve `/api/*` anyway**: `auth.ts`
(`/api/auth`), `calendar.ts`, `email-api.ts`, `user-management.ts`, `template-api.ts`, plus
`admin.ts` and `sync-webhook.ts`, which self-prefix absolute `/api/…` paths **while mounted at `/`**.
Three files *inside* `routes/api/` bypass the aggregator (`cost-preset`, `lookup-admin`,
`threeshape-webhook`) and one (`holiday`) is in it *and* mounted again (R7).

This is not stylistic. **F6.7** (the `/api/admin` gate defeated by mount order) and **R3** (pre-gate
public reads) both exist only because a router's effective URL and its gate live in different files,
ordered by hand. The genuinely different routers are `portal.ts` (own session) and `web.ts` (SPA
shell); everything else is an API router.
→ Move the 6 into `routes/api/` with the `.routes.ts` suffix, register them in the aggregator, and
forbid self-prefixed absolute paths inside a router. Then mount order is structurally irrelevant
instead of a comment. **Fold R3 and R7 into this.**

**(b) The route layer holds ~78 raw SQL statements.** *(Re-counted 2026-09-12: **~80** — 57 plain
`` sql` `` + 23 typed `sql<…>` — across 8 files; 11 route files import `getKysely`.)* 11 route files import `getKysely()`;
`patient.routes.ts` alone holds 38 `sql` templates and is 1,756 lines, while
`services/database/queries/` has 24 modules for exactly this. Also not cosmetic: three of the
audit's own 🟠 findings were inline route SQL — **F7.19** (`estimated_cost = ${estimatedCost || null}`),
**F7.3** (the diagnosis upsert), **F7.5** (the raw appointment `UPDATE` that skipped the
double-booking guard). Invariants get missed when a write does not sit next to its siblings. Inline
writes today: `auth.ts:251`, `user-management.ts` ×5, `payment.routes.ts:459` (`DELETE FROM invoices`
— a money write in a router), `work.routes.ts:1011`, `media.routes.ts`, `appointment.routes.ts:584`,
`patient.routes.ts:1297`.

**(c) God files.** `services/messaging/whatsapp.ts` **3,294** · `aligner-queries.ts` 2,159 ·
`patient.routes.ts` 1,756 · `aligner.routes.ts` 1,504 · `work-queries.ts` 1,279 ·
`AlignerService.ts` 1,263 · `routes/calendar.ts` 1,008 · `index.ts` 960.
*(Re-counted 2026-09-12: add `routes/api/work.routes.ts` **1,165**, missing from this list;
`patient.routes.ts` is now 1,758.)*

**(d) Minor.** `utils/phoneFormatter.ts` is the only camelCase filename in an otherwise kebab-case
directory. `utils/windows-service/*.js` are plain JS in a strict-TS backend (deliberate — run by
bare `node`). `types/api.types.ts` is down to 5 middleware-only symbols and could fold into
`middleware/`.

**(e) ✅ FIXED (batch 7) — Process gap: `services/` has no in-repo audit record.** Now
**`docs/services-audit.md`**: coverage map, the batch-1 structural outcomes (5 directories folded,
the lock-reaper → fencing-token change), batch 2's scope, and the two deliberate non-fixes — which
also gained `AUDIT DECISION` comments at their call sites. Labelled as reconstructed, with every
assertion re-verified against the code on 2026-09-12.

Original text: It is the largest part of the backend
(**125 files, ~37.6k lines**) and this tracker explicitly excludes it. Its two audit batches
(2026-08-13 and 2026-08-31, 31+ findings) exist only in Claude memory plus an artifact link, so a
future session cannot see what was checked or what was deliberately left alone. Worth a
`docs/services-audit-tracker.md` mirroring this file — including the two standing "do not "fix" this"
decisions (the public aligner-PDF link; the full `auth/drive` scope).

---

## Scope inventory

| Area | Files | Lines | Status |
|---|---|---|---|
| `index.ts` | 1 | 953 | ✅ |
| `config/` | 5 | 470 | ✅ |
| `middleware/` | 10 | 1136 | ✅ |
| `utils/` | 20 | 1976 | ✅ |
| `types/` | 7 | 2035 | ✅ |
| `shared/` | 51 | 6558 | ✅ |
| `routes/` root (auth, admin, web, sync-webhook, portal) | 5 | ~1900 | ✅ |
| `routes/api/` — authorization & structural sweep (all 41 files) | 41 | ~16800 | ✅ (cross-cutting only) |
| `routes/api/` — per-file logic read: settings, lookup-admin, file-explorer, cost-preset, sync | 5 | ~1500 | ✅ |
| `routes/api/` — per-file logic read: **remaining 36 files** | 36 | ~15300 | ✅ |
| `routes/` root (calendar, template-api, email-api, user-management) | 4 | ~1980 | ✅ |
| `routes/public/` (video, tv-display) | 2 | 924 | ✅ |
| `scripts/` | 16 | 1800 | ✅ |
| `migrations/` | 4 pg + 28 supabase | — | ✅ |

Legend: ⬜ not started · 🟡 partial · ✅ done

## Findings

_(populated as phases complete; severity: 🔴 bug · 🟠 risk · 🟡 dead/dup · 🔵 note)_

---

## Phase 1 — `index.ts` ✅

**✅ FIXED** **F1.1 🟠 `process.env.NODE_ENV ??= 'production'` (index.ts:4) never runs before the imports it is meant to guard.**
ESM hoists and fully evaluates every `import` (lines 8–73) *before* any module-body statement, so the comment "before any other code runs" is wrong. Consequences when the launcher leaves `NODE_ENV` unset (`npm start` = `cross-env TZ=Asia/Baghdad node dist-server/index.js` — sets TZ only):
- `middleware/csrf.ts:26` `const isProduction = process.env.NODE_ENV === 'production'` → `false` → CSRF cookies get `secure: false`, while `index.ts:179` (runs later, inside `initializeApplication`) computes `true` for the session cookies. Split posture: `shwan.sid` Secure, `shwan.csrf` not.
- `utils/logger.ts:75` adds the Console transport — CLAUDE.md states console is off in production.
- `config/config.ts:15` `.env.development` override decision is made on the un-defaulted value (safe direction, but still load-order dependent).
The Windows-service path is unaffected (node-windows sets `NODE_ENV=production` in its `env` array), so this only bites the documented manual `npm start` path. `csrf.ts`'s own header comment claims load order "never matters" — true for the secret (lazy `getSecret`), false for `isProduction`.

**✅ FIXED** **F1.2 🟡 `index.ts:112–113` — `__filename` / `__dirname` computed, never used.** Dead.

**✅ FIXED** **F1.3 🟡 `index.ts:116` `dotenv.config({ debug: false })` is a no-op.** `config/config.ts` (imported at line 15, evaluated first) already ran `dotenv.config({ path: '.env' })` plus the `.env.development` override; dotenv does not override existing vars, so this second call loads nothing.

**✅ FIXED** **F1.4 🟡 `index.ts:214` `req.path.startsWith('/api/aligner-portal')` matches no route.** Grep finds no `/api/aligner-portal*` mount anywhere. Dead condition — and it is exactly the unbounded-prefix shape CLAUDE.md warns about (would also swallow `/api/aligner-portal-anything`).

**✅ FIXED** **F1.5 🔵 `/health/basic` (index.ts:804) is registered at module body, i.e. before `initializeApplication()` mounts anything.** Express matches in registration order, so it precedes `setupMiddleware` (helmet), the session, the auth gate, CSRF, and the request-timeout middleware. It is public by construction and returns `process.version` + `NODE_ENV`. Probably intended, but it is the only route with no security headers at all.

**✅ FIXED** **F1.6 🔵 `startBackgroundDatabaseRetry()` (index.ts:909) leaks its interval.** Not `unref()`-ed and not registered with `ResourceManager`, so it is never cleared on graceful shutdown (only survives because `gracefulShutdown` ends in `process.exit`).

**✅ FIXED** **F1.7 🔵 `/portal` handler (index.ts:325) double-`sendFile` fallback.** `res.sendFile(builtPath, err => { if (err) res.sendFile(srcPath) })` — an error raised *after* headers/body started streaming triggers a second `sendFile` on a committed response (`ERR_HTTP_HEADERS_SENT`). Only reachable if `dist/portal.html` exists but the read fails mid-stream.

## Phase 2 — `middleware/` ✅

**✅ FIXED** **F2.1 🟠 `middleware/time-based-auth.ts:207` — the invoice edit/delete age guard reads a user-supplied date, not the row's creation time.**
`getInvoiceCreationDate` selects `invoices.date_of_payment` (a `date` column the staff member types into the payment form) and feeds it to `isToday()`. The table has `sys_start_time Generated<Timestamp>` — the actual insert time. So a non-admin can delete or edit a weeks-old invoice simply because its `date_of_payment` was entered as today, and is blocked from touching an invoice genuinely created today that carries a back-dated payment date. `getWorkCreationDate`/`getPatientCreationDate` correctly use `addition_date`/`date_added`.
`getExpenseCreationDate` has the same shape (`expenses.expense_date`) but the table has **no** creation timestamp at all — that one is a schema gap, not a code choice.

**✅ FIXED** **F2.2 🟡 Dead re-exports in `middleware/index.ts`.** Only `setupMiddleware` + `errorHandler` are imported from the barrel (index.ts:25); every route imports `middleware/auth.js`, `validate.js`, `timeout.js`, `time-based-auth.js` directly. Of the barrel's re-exports, these have **zero** importers repo-wide: `customTimeout`, `MemoryFile`, `ResourceType`, `OperationType`, `GetRecordDateFn`, `RecordAgeOptions`, `TimeoutType`, `TimeoutValue`. `customTimeout` (timeout.ts:107) is additionally a one-line alias of `requestTimeout`.

**✅ FIXED** **F2.3 🟡 `middleware/validation-schemas.ts` is a dead barrel.** 11-line `export * from '../shared/validation.js'` whose docblock says it "preserves the existing import sites (10 route files)" — grep finds **0** importers; all 10 migrated to `@shared`/relative `shared/validation.js`.

**✅ FIXED** **F2.4 🔵 `middleware/timeout.ts` — the 408 does not stop the handler.** `requestTimeout` registers both a `req.setTimeout` and a `res.setTimeout` callback on the *same* socket, so both fire; the first sends 408, the second is a no-op via `headersSent`. Neither aborts the in-flight handler or destroys the socket, so a slow handler that later calls `res.json()` throws `ERR_HTTP_HEADERS_SENT` into the global handler.

**✅ FIXED** **F2.5 🔵 `middleware/upload.ts:72` — `'code' in err` over-matches.** Any error carrying a string `code` (pg SQLSTATE, Node `ENOENT`) that reaches `handleUploadError` is reported as `Upload error: <raw message>` with **400**, leaking the raw message the global handler is careful to suppress. Currently only mounted directly behind multer, so not reachable in practice.

**✅ FIXED** **F2.6 🔵 `middleware/time-based-auth.ts` — string PK params bound un-parsed.** `getPatientCreationDate`/`getInvoiceCreationDate`/`getExpenseCreationDate` bind `req.params.*` as text against `integer` PKs (works via PG's parameter type inference, but a non-numeric param raises `22P02` → 500 "Authorization check failed" instead of a 400). `getWorkCreationDate` does `parseInt` — inconsistent.

**✅ FIXED** **F2.7 🔵 `middleware/auth.ts:202` `authenticateWeb` skips on `req.path.startsWith('/api')`** — unbounded prefix; `/apifoo` bypasses the web gate and falls through to the SPA catch-all. No data exposure (shell only), but the same prefix class as F1.4.

**✅ FIXED** **F2.8 🔵 `middleware/auth.ts:133` — no dummy hash on user-not-found.** `verifyCredentials` returns immediately when the username misses, skipping `bcrypt.compare`; the timing delta is a user-enumeration oracle. Mitigated by the 15-min/IP `loginLimiter`.

## Cross-cutting (running) 

**✅ FIXED** **X.1 🟡 `config/ssl.ts` is fully dead (66 lines).** No importer; the `ssl/` directory it points at (`config/../ssl/cert.pem`) does not exist; nothing calls `https.createServer` — TLS is terminated by Caddy / cloudflared.

## Phase 3 — `config/` ✅

**✅ FIXED** **F3.1 🟡 Three `AppConfig` fields have zero consumers.** `config.google` (`GoogleConfig`, lines 123–126 — the Drive/Contacts blocks read `process.env.GOOGLE_CLIENT_ID` directly rather than through it), `config.urls.qrHost` (`QR_HOST_URL`), and `config.dbDriver` (its own comment already says setting it "no longer changes runtime behavior"). All three are still declared in `types/config.types.ts`.

**✅ FIXED** **F3.2 🔵 `envSchema` coercion is parsed and thrown away.** `config.ts:59` keeps only `envResult.success`; `envResult.data` is discarded, so `PORT: z.coerce.number()` never reaches consumers — `config.server.port` (line 148) is `process.env.PORT || 3000`, i.e. a **string** whenever `PORT` is set. Harmless for `server.listen()`, but `AppConfig.server.port` is typed as the union and any arithmetic on it would silently concatenate. Same for `LOCALSEND_PORT`, re-`parseInt`ed at line 177.

**✅ FIXED** **F3.3 🔵 `resolvePgConnection` drops every DATABASE_URL query parameter.** `sslmode`, `application_name`, `connect_timeout` in a `DATABASE_URL` are parsed away (only host/port/db/user/password survive). Fine for a local trusted socket; a deployment that points `DATABASE_URL` at a TLS-requiring managed PG would connect without SSL. Worth a comment at minimum given the commercial multi-deployment direction.

**✅ FIXED** **F3.4 🟡 `config/ssl.ts` dead — see X.1.**

## Phase 4 — `utils/` ✅

**✅ FIXED** **F4.1 🔴 `utils/date.ts#formatDatePattern` mangles literal letters in the pattern.** The single-character tokens `h`, `A`, `a` are matched anywhere in the format string, including inside literal words. Verified against the built module:
```
"DD MMMM YYYY at hh:mm A"  →  "09 March 2026 pmt 02:05 PM"
"dddd [at] h:mm A"         →  "Monday [pmt] 2:05 PM"
```
Reachable from user input: `services/templates/receipt-service.ts:406` passes a **template-author-supplied** format straight through (`{{ field | date:<format> }}` in the GrapesJS document templates). `utils/date.test.ts:78` appears to cover bracket-escaping (`'[on] YYYY'` → `'[on] 2026'`) but passes only because "on" happens to contain no token letter — there is no escaping implementation. Also, no `D`/`M` single-digit tokens exist, so `date:D/M/YYYY` renders the literal `D/M`.

**✅ FIXED** **F4.2 🟠 `utils/stream-file.ts` rejects suffix ranges (`Range: bytes=-500`).** `parts[0]` is `''` → `parseInt` → `NaN` → 416. A suffix range is valid RFC 9110 and is what some players/download managers send to probe a file tail. Multi-range (`bytes=0-10,20-30`) is also mis-parsed: `parseInt('10,20')` = 10, so it silently answers only the first range with a 206.

**✅ FIXED** **F4.3 🟠 `utils/stream-file.ts:72` — the read stream is not destroyed when the client aborts.** `stream.pipe(res)` has no `res.on('close', () => stream.destroy())` (and no `stream.pipeline`), so on a client abort — routine when scrubbing a video — the `fs.ReadStream` keeps reading the file to EOF with nothing consuming it. Wasted I/O + a held fd per abandoned seek on `/api/videos/:id/stream`.

**✅ FIXED** **F4.4 🟠 `utils/error-response.ts:60` leaks `Error.message` in production.** `sendError` dev-gates only `stack`; `details.message` is emitted unconditionally. **142 call sites across 31 files** pass a caught error as `details` (`ErrorResponses.internalError(res, 'Failed to …', error as Error)`), so the raw driver/SQL message reaches the browser — the exact leak `middleware/error-handler.ts` documents itself as preventing ("never the raw Error.message, which historically leaked SQL fragments, file paths, and internal state"). The two layers have opposite postures.

**✅ FIXED** **F4.5 🟡 `utils/phoneFormatter.ts` — 3 identical functions + a dead branch + 6 unused members.**
- `formatForWhatsApp`, `formatForTelegram`, `formatForSMS` (lines 59, 75, 91) have byte-identical bodies.
- `normalizePhoneNumber` lines 34–39: `if (countryCode === '964') { return countryCode + cleaned.substring(1) } else { return countryCode + cleaned.substring(1) }` — both branches identical.
- Unused `PhoneFormatter` members (0 references anywhere, frontend included): `.forSMS`, `.forDatabase`, `.forDisplay`, `.forLocalDisplay`, `.getLocal`, `.extractCountryCode` — 6 of 11.

**✅ FIXED** **F4.6 🟠 `extractCountryCode` misidentifies bare Iraqi mobiles as Russia.** The probe list is ordered `['964','1','44','49','33','39','34','7',…]` and each entry is tested with a bare `startsWith(code)`, so `'7501234567'` (an Iraqi local number without the leading 0) matches `'7'` → returns `'7'`. `normalizePhoneNumber(phone, '7')` then short-circuits on `startsWith(countryCode)` and returns the number unchanged. Currently latent — the function has no callers (F4.5) — but it is exported as a public helper.

**✅ FIXED** **F4.7 🔵 `isValidPhoneNumber` hardcodes an Iraqi carrier-prefix allowlist** (`/^964(75[01]|77[0-9]|78[0-4]|79[0-5])\d{7}$/`). Any prefix outside it is rejected as invalid, which for a multi-deployment product means a new Iraqi carrier block (or a non-Iraq center) fails WhatsApp/Telegram sends with "invalid number". Same class as the Friday-hardcoding in `utils/arabic-day.ts:19`.

**✅ FIXED** **F4.8 🟡 `utils/video-mime.ts` is a strict subset of `utils/file-mime.ts`.** 6 extensions, all present in `FILE_TYPES` with identical MIME values. `file-mime.ts`'s own docblock acknowledges the split. Two tables to keep in sync for no functional difference.

**✅ FIXED (via F6.8)** **F4.9 🟠 `utils/file-mime.ts` maps `.svg` → `image/svg+xml` (category `image`) and `.html`/`.htm` → `text/html` (category `text`).** The file-explorer docblock says these categories drive **inline** rendering (`<img>` / `<iframe>`). Both formats execute script when served inline from the app's own origin, so a file dropped into a patient folder becomes stored XSS against an authenticated staff session. → confirmed in Phase 8 as **F6.8**, and closed there in batch 1: both inline-serve paths now set `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff`, so such a file renders in an opaque origin with scripting off. The MIME table itself is unchanged — the categories are correct, it was the serving headers that were missing.

**✅ FIXED** **F4.10 🟡 Dead exports in `utils/`.** `path-resolver.ts`: `getPathSeparator` (0 refs), `resolvePath` (0 external — used only internally by `createPathResolver`), and the whole `export default {…}` object (no default importer). `pg-errors.ts`: `PG_SQLSTATE`, `asPgError`, `isNotNullViolation`, `isCheckViolation` are exported but referenced only from inside the same file. `middleware/validate.ts`: `ValidationSchemas` type.

**✅ FIXED** **F4.11 🔵 `utils/date.ts:8` docblock is stale.** "The mssql pool runs with `useUTC: false` (see config/config.ts)" — mssql is retired for app reads (PG + the `pg` parsers own this now, per CLAUDE.md).

**✅ FIXED** **F4.12 🔵 `utils/filename-converter.ts:31` truncates at the first dot.** `originalFilename.split('.')[0]` turns `patient.record.i99` into `patient.jpg`, dropping the rest of the base name for any unmapped extension.

## Phase 5 — `types/` + `shared/` ✅

**✅ FIXED** **F5.1 🟡 The hand-written `types/` layer is ~90% dead — and what looks live is shadowed by local copies.**
`types/index.ts` + `api.types.ts` + `config.types.ts` + `services.types.ts` = **992 lines**, consumed by exactly **4 import statements in 4 files**:
```
middleware/auth.ts:12            AuthResult, ApiErrorResponse, SafeUser, UserRole
middleware/time-based-auth.ts:15 ApiErrorResponse
middleware/timeout.ts:15         Middleware
config/config.ts:7               AppConfig
```
That is 6 distinct symbols out of **69 exports**. Worse, 11 of the remainder are not merely unused but **re-declared independently elsewhere**, so the `types/` copy can silently drift from the one actually in force:

| symbol | live declaration | dead copy |
|---|---|---|
| `PoolStats` | `services/database/index.ts:18` | `types/services.types.ts:18` |
| `HealthCheckResult` | `services/monitoring/HealthCheck.ts:12` | `types/services.types.ts:99` |
| `HealthStatus` | `services/monitoring/HealthCheck.ts:33` | `types/services.types.ts:94` |
| `DriveUploadResult` | `services/business/AlignerPdfService.ts:78` | `types/services.types.ts:217` |
| `RegisteredResource` | `utils/resource-manager.ts:10` | `types/services.types.ts:71` |
| `ValidationResult` | 3× (`webceph-service`, `drive-upload`, `work-queries`) | `types/services.types.ts:54` |
| `WorkRelatedCounts` | `services/database/queries/work-queries.ts:1144` | `types/api.types.ts:294` |
| `UploadedFile` | `services/business/AlignerPdfService.ts:70` | `types/api.types.ts:258` |
| `ApiResponse` | `public/js/types/api.types.ts:29` (the one CLAUDE.md names) | `types/api.types.ts:98` |
| `ApiSuccessResponse` | `public/js/utils/whatsapp-validation.ts:21` | `types/api.types.ts:122` |
| `DatabaseConfig` | `services/settings/EnvironmentManager.ts:19` | `types/config.types.ts:43` |

Full dead list — `api.types.ts` (18): `AppSession`, `AppRequest`, `PatientRequest`, `WorkRequest`, `AppointmentRequest`, `PaginatedResponse`, `RouteHandler`, `ErrorMiddleware`, `PaginationQuery`, `DateRangeQuery`, `SearchQuery`, `AppointmentQuery`, `LoginRequest`, `LoginResponse`, `FileUploadRequest`, `TransferWorkRequest`, `TransferWorkResponse`, `TransferPreviewResponse`. `config.types.ts` (21): every `*Config` interface except `AppConfig`/`DatabaseConfig`, plus `DbDriver`, `RequiredEnvVars`, `OptionalEnvVars`, `EnvVars`. `services.types.ts` (12): `ServiceResult`, `ValidationError`, `CleanupFunction`, `ResourceManagerInterface`, `HealthReport`, `SendMessageOptions`, `SendMessageResult`, `BatchMessageRequest`, `BatchMessageResult`, `PdfOptions`, `PdfResult`, `DriveFile`.
(`types/db.d.ts`, `express-session.d.ts`, `modules.d.ts` are all genuinely live — this finding is only about the 4 hand-written modules.)

**F5.2 🟢 `shared/contracts/` is healthy.** All 43 contract modules have ≥1 server importer; only `chair-display.contract` has no client importer, which is correct (the kiosk uses raw `EventSource`/`sendBeacon`). The D2 "Intentionally loose" marker count is **9**, exactly the CLAUDE.md baseline — no drift.

**✅ FIXED** **F5.3 🔵 12 "type-only" request schemas build a runtime Zod object solely to derive a TS type.**
`patientsQuery`, `appointmentQuery`, `calendarQuery`, `paymentQuery`, `visitQuery`, `workQuery`, `getPresetsQuery`, `sendAppointmentsQuery`, `sendByDateQuery`, `dateParams`, `tableParams`, `videoIdParams`. Each is an `export const … = z.object({…})` whose comment says "type-only (handler reads X directly)" — the schema value itself has zero references, so a plain `type` alias would do the same at no runtime cost. Consistent and documented, so not a defect, but it is ~50 lines of Zod constructed at module load for nothing.

**✅ FIXED** **F5.4 🟠 The corollary of F5.3: those endpoints' query strings never cross a validation boundary,** so the route generic is a type-lie. Express's query parser yields an **array** for a repeated key (`?date=a&date=b`) under both `simple` and `extended` modes, and the app sets no `query parser` override. A handler typed `req.query.date: string | undefined` therefore receives `string[]` and passes it on:
- `routes/api/utility.routes.ts:38,59` → `sms.sendSms(dateparam)` / `sms.checksms(dateparam)` with an array.
- `routes/api/stand.routes.ts:306` (`search`), `routes/api/expense.routes.ts:112` (`currency`) — same shape.
`routes/api/whatsapp.routes.ts:75` is safe by accident: its own `dateRegex.test()` stringifies the array to `"a,b"` and 400s. This contradicts CLAUDE.md's "validate untrusted input crossing into the app … request body/params/query".

**✅ FIXED (partly — see batch 3)** **F5.5 🟡 Dead exports in `shared/` non-contract modules.** `shared/validation.ts`: `YMD_RE`, `isRealYmd` (both used only inside the file, by `dateString`), `nonNegInt` (0 references anywhere). `shared/treatment-taxonomy.ts`: `ALIGNER_LAB_WORK_TYPE_ID`, `WorkStatusId`, `PatientTypeId`, `ClassifiableWork`. `shared/photo-views.ts`: `ViewTag`. `shared/google-contacts-accounts.ts`: `GoogleContactAccount`.

**✅ VERIFIED — NOT A DEFECT** **F5.6 🟡 Unreferenced constant arrays in contracts** (declared for a validation/UI purpose that never materialized): `CLOSED_WORK_STATUSES` (aligner), `ANNOUNCEMENT_AUTO_EVENTS`, `APPROVAL_ACTION_TYPES` + `APPROVAL_STATUSES`, `LAB_CASE_EVENT_TYPES` (+ `LabCaseEventType`, `LabStageLocation`), `CLIENT_ERROR_SOURCES` (monitoring), `PORTAL_ACTIVITY_TYPES`, `FIT_MODES` + `COMMAND_ACTIONS` (tv-display). Plus row-schema fragments never composed into a response: `alignerBatchRow`, `alignerNoteRow`, `alignerPhotoRow`, `archformPatientRow`, `alignerSetForMatchRow`, `allSetsRow`, `labCaseRow`, `labCaseBoardRow`, `labCaseEventRow`, `fileEntry`, `fileListing`, `configRow`, `configPayload`, `telegramAccount`, `cloudflareListSyncResult`, `transferStatus`, `alertStatusEnum`, `twilioDate`.
(The many unused `export type XxxResponse = z.infer<…>` aliases are **not** counted here — CLAUDE.md prescribes exporting them.)

## Phase 6 — `routes/` (root + cross-cutting authorization) ✅

**✅ FIXED** **F6.1 🔴 The most privileged endpoints in the app have NO role gate — only `authenticate`.**
`routes/api/settings.routes.ts` and `routes/api/lookup-admin.routes.ts` never call `authorize()`. Both mount **after** the global `app.use('/api', authenticate)` gate (`routes/api/index.ts:124` and `index.ts:390`), so the only requirement is *any valid staff session* — front-desk, assistant, any role. 22 other route files do gate with `authorize()` (`cost-preset.routes.ts` gates the exact same class of operation with `authenticate, authorize(ADMIN_ROLES)`), so this is an omission, not a deliberate posture.

Reachable by any logged-in user:
| endpoint | file:line | effect |
|---|---|---|
| `GET /api/config/database/backup` | settings:328 | **Streams a full `pg_dump` of the clinic database** — every patient, every invoice. Complete PHI exfiltration in one request. |
| `PUT /api/config/database` | settings:245 | Rewrites the PostgreSQL connection configuration. |
| `POST /api/config/database/test` | settings:212 | Probes arbitrary host/port/user/password combinations from the server — an SSRF-flavoured port scanner + credential oracle. |
| `GET /api/config/database` · `/export` | settings:182, 292 | Reads back the DB configuration (password masked). |
| `POST /api/system/restart` | settings:400 | Triggers `gracefulShutdown('api-restart')` → `process.exit(0)`. Trivial repeatable DoS. |
| `PUT /api/options/:optionName` · `/options/bulk` | settings:137, 70 | Rewrites any system option (incl. `PatientsFolder`, `VideosPath`). |
| `POST/PUT/DELETE /api/admin/lookups/:tableName[/:id]` | lookup-admin:104, 156, 213 | Full CRUD on every table in `LOOKUP_TABLE_CONFIG`. |

No compensating server-side check exists in the handlers (verified by reading each), and no client-side role check was found for the Settings screens either — but a client check would not be a control regardless.

**✅ FIXED** **F6.2 🟠 Nine more routers expose mutations with no `authorize()`.** Same shape, lower blast radius; listed for triage rather than as one finding each: `branding.routes.ts` (3 — replace/delete the clinic logo + name), `email-api.ts` (3 — send mail), `template-api.ts` (4 — create/update/delete document templates), `video.routes.ts` (3 — `PUT /:id`, `DELETE /:id`), `localsend.routes.ts` (3), `share.routes.ts` (1), `messaging.routes.ts` (1), `monitoring.routes.ts` (1 — the client-error sink, deliberate), `aligner.routes.ts` (**25** mutating routes, zero `authorize()` calls). Whether each *should* be role-gated is a product call; the point is that it was never made explicitly in these files.

**✅ FIXED** **F6.3 🔵 `routes/auth.ts:252` — `change-password` reports failure after the password has already changed.** The `UPDATE users SET password_hash` runs at line 248; `session.regenerate()` at 255 is inside the same `try`, so a regenerate failure returns `500 "Failed to change password. Please try again."` to a user whose password *did* change — they then retry with the old one and fail. Also, unlike `/login` (line 104) it never `session.save()`s after regenerate.

**✅ FIXED** **F6.4 🔵 `routes/auth.ts:231` — `change-password` bumps `last_login`.** It re-uses `verifyCredentials()`, whose side effect is `UPDATE users SET last_login = LOCALTIMESTAMP` (`middleware/auth.ts:159`), so a password change is recorded as a login.

**✅ FIXED** **F6.5 🔵 `routes/auth.ts:222` — 6-character minimum password** on a system holding PHI, with no complexity or breach check.

**F6.6 🟢 No SQL-injection or path-traversal vectors found in `routes/`.** Every `sql\`\`` interpolation binds a parameter (`sql.join` over already-parameterized fragments in `patient.routes.ts:696,702` and `employee.routes.ts:114,119`); there is no `sql.raw`/`sql.lit`. No `path.join`/`sendFile`/`createReadStream`/`unlink` call takes `req.params`/`req.query`/`req.body` directly.

**✅ FIXED** **F6.7 🔴 `routes/admin.ts:26`'s `/api/admin` admin gate is defeated by mount order.**
`admin.ts` declares `router.use('/api/admin', authorize(ADMIN_ROLES))` and is mounted at the app root — but at **`index.ts:393`**, i.e. *after* `app.use('/api/admin', lookupAdminRoutes)` at **`index.ts:390`**. Express matches in registration order, so every `/api/admin/lookups/*` request is fully handled by `lookupAdminRoutes` and never reaches admin.ts's gate. The surface therefore *looks* admin-only (a router literally named `admin.ts` scoping `authorize(ADMIN_ROLES)` to `/api/admin`) while only admin.ts's own five Google-OAuth routes are actually protected. This is the mechanism behind the lookup-admin half of **F6.1**. Swapping the two mount lines would fix it; note the 2026-07-11 incident comment above line 26 explains why the gate must stay path-scoped, not why it must be registered first.

**✅ FIXED** **F6.8 🟠 Stored XSS via the patient file explorer's inline preview.** (confirms F4.9)
`GET /api/patients/:personId/files/content?path=…` (no `download` flag) does, at `file-explorer.routes.ts:181` + `:207`:
```ts
const mime = getFileMimeType(abs);   // .svg → image/svg+xml ; .html → text/html
res.setHeader('Content-type', mime);
res.sendFile(abs, sendOpts, onDone); // no Content-Disposition
```
So a `.svg` or `.html` file sitting in a patient folder is served **inline, from the app's own origin**, with no `Content-Disposition: attachment` and no CSP (`helmet({ contentSecurityPolicy: false })`, `middleware/index.ts:80`). `X-Content-Type-Options: nosniff` does not help — the declared type is already executable. Any script in that file runs with the viewing staff member's session.
Two ways content gets there: (a) the folder is a live NTFS share the clinic writes to by other means, and (b) `POST /patients/:personId/files/upload` (line 346) — `multer({ storage, limits })` at line 325 with **no `fileFilter`**, so any extension is accepted, 50 files per request. Upload is gated to `FINANCE_ROLES` (`admin` + `front_desk`) but the **read/preview endpoints at lines 126/150/218/241 carry no `authorize()` at all**, so any authenticated role can be the victim — a front-desk account can plant a payload that fires in an admin's browser.
Mitigations that already exist and should be preserved: path resolution is strictly validated (`resolveFileForServe` / `resolveWorkingFile` + per-patient timepoint-code allowlisting) — no traversal was found.

**F6.9 🟢 No missing-`return` double-send bugs.** A structural scan of all 52 route files for an error response inside a non-`catch` block whose next statement is not `return` produced 9 candidates, all of which were verified benign (shared `handleError`/`handleServiceError`/`handleStandError` helpers, or `if (!res.headersSent)` guards, or the final statement of an `if/else` immediately before the block ends).

**✅ FIXED** **F6.10 🔵 `parseInt()` without a radix at 20+ sites** (`user-management.ts:154,181,221,263`, `template-api.ts` ×10, `employee.routes.ts:114,235,241,273`, `media.routes.ts:346`, `approval.routes.ts:138`, …). Harmless for decimal input under ES5+ semantics, but `parseInt('0x10')` still yields 16 — so on the sites that also lack a `validate({ params })` guard, `DELETE /api/users/0x10` addresses user 16.

**✅ FIXED** **F6.11 🔵 `GET /api/sync/supabase-status` builds and tears down a fresh Supabase `pg.Pool` *and* an mssql `ConnectionPool` per request** (`sync-webhook.ts:146,177`). Both are correctly `end()`/`close()`d in `finally`, so there is no leak — but if the Settings screen polls this, it is a TCP connect/TLS handshake to Supabase on every tick.

## Phase 7 — `routes/api/` per-file logic read (the remaining 36) ✅

### Highest impact

**✅ FIXED** **F7.1 🔴 `POST /api/wa/sendmedia2` is an arbitrary-file-read → exfiltration primitive.**
`whatsapp.routes.ts:585` takes `file` as a **comma-separated list of filesystem paths from the request body** and resolves each with a local `resolveWindowsPath()` (line 594) that returns an **absolute path unchanged** (`\\\\…` UNC or `C:\…`) and only joins *relative* ones onto `MACHINE_PATH` — with no containment check of any kind. The resolved path goes to `sendXray_` (`services/messaging/whatsapp-api.ts:86`), which validates only `fs.existsSync` + `R_OK` before `MessageMedia.fromFilePath(file)`, and then to a **phone number also taken from the body**. The contract (`whatsapp.contract.ts:41`) is `file: z.string()`.
So any authenticated staff session (there is no `authorize()` on this router) can do:
`POST /api/wa/sendmedia2  {file: "C:\\ShwNodApp\\.env", phone: "<attacker>", prog: "WhatsApp"}`
and receive the server's `.env` — DB password, `SESSION_SECRET`, Supabase service URL, Twilio/Google/Telegram credentials — on WhatsApp or Telegram. Any readable file on the server or its shares works (`logs/error.log`, the whole `clinic1` tree, Windows system files — the service runs as Administrator per CLAUDE.md).
This is the one place F6.6's "no path traversal in `routes/`" misses: it is not `path.join(req.body)` into a scoped directory, it is a **whole absolute path accepted verbatim**. Contrast `file-explorer.service.ts#resolveFileForServe`, which the media/photo-editor routes use correctly.

**✅ FIXED** **F7.2 🟠 Two GET endpoints perform mass outbound messaging, and the session cookie is `sameSite: 'lax'`.**
- `GET /api/wa/send?date=YYYY-MM-DD` (whatsapp.routes.ts:70) starts the **whole-day WhatsApp reminder batch**.
- `GET /api/sendtwilio?date=…` (utility.routes.ts:36) sends the **day's SMS reminders**.
Both are `GET`, so `middleware/csrf.ts` does not challenge them (csurf ignores safe methods), and `sameSite: 'lax'` (index.ts:197/234) *does* send the session cookie on a top-level cross-site navigation. A staff member who clicks a link to `https://remote.shwan-orthodontics.com/api/wa/send?date=2026-09-08` from any external page fires a real batch send to every patient booked that day. The same shape applies to `GET /api/wa/initialize` (line 927, starts the WhatsApp client) and `GET /api/email/test`.
`whatsapp.isBatchSending()` limits it to one batch at a time but does not prevent the first one.

**✅ FIXED** **F7.3 🟠 `POST /api/diagnosis` upserts without a transaction and without a unique key, so it can create duplicate diagnoses.**
`work.routes.ts:889` does `UPDATE diagnoses … WHERE work_id = $1`, and inserts only when `numAffectedRows === 0`. There is **no unique constraint on `diagnoses.work_id`** — the baseline has only `PRIMARY KEY (id)` and a redundant `UNIQUE (id, work_id)` (`1783100000000_baseline…sql:3311`) — and the two statements are not wrapped in `withPgTransaction`. Two concurrent saves for a work with no existing row both see 0 rows updated and both INSERT. `GET /api/diagnosis/:workId` then returns `rows[0]`, an arbitrary one of the two; `DELETE` removes both. (Later UPDATEs hit both rows, so the divergence self-heals but the duplicate persists.)

**✅ FIXED** **F7.4 🟠 `GET /api/calendar/range` accepts an unbounded date span.**
`calendar.ts:284` reads `start`/`end` from the query; `calendar.contract.ts:135` validates only that each is a date string — no `start <= end` check and no maximum span. `getWeeklyCalendarSlots(start, end, …)` then materialises every slot row in the range into JS objects (`transformToCalendarStructure`), and `getCalendarStats` scans it again. `start=2000-01-01&end=2035-01-01` is ~12,800 days × the configured slots per day, all buffered in memory in one request. `/api/statistics/multi-year` (reports.routes.ts:305–312) already does exactly the right thing — validates `startYear <= endYear` and caps the range at 10 years — so the guard exists in the codebase and is simply absent here.

**✅ FIXED** **F7.5 🟠 `PUT /api/appointments/:appointmentId` bypasses the double-booking guard that `POST` enforces, and neither PUT nor DELETE broadcasts the change.**
Creation goes through `validateAndCreateAppointment`, which raises `APPOINTMENT_CONFLICT` (appointment.routes.ts:361). The update handler (line 484) is a raw `UPDATE appointments SET person_id/app_date/app_detail/dr_id` with no conflict check at all, so a slot that cannot be booked directly can be reached by booking elsewhere and editing. Separately, `POST /appointments`, `quick-checkin`, `updateAppointmentState` and `undoAppointmentState` all `wsEmitter.emit(DATA_UPDATED, …)`; **`PUT` and `DELETE` emit nothing**, so an edited or cancelled appointment stays on every other staff member's Daily Appointments board until they reload.

**✅ FIXED** **F7.6 🟠 The `updateAppointmentState` / `undoAppointmentState` SSE broadcast uses *today's* date, not the appointment's.**
`appointment.routes.ts:189` and `:257` build `appointmentDate` from `new Date()` (the server clock) rather than from the appointment row. Checking in — or undoing a check-in for — a patient whose appointment is on any other day refreshes the wrong day's viewers, and the day that actually changed never updates. `POST /appointments` (line 336) gets this right by deriving the day from `app_date`.

**✅ FIXED** **F7.7 🟠 Four Stand write endpoints take a completely unvalidated `req.body`.**
`PUT /stand/categories/:id` (stand.routes.ts:113) → `updateStandCategory(id, req.body)`, `PUT /stand/items/:id` (line 348) → `updateStandItem(id, req.body)`, `POST /stand/sales` (line 447) → `validateAndCreateSale({...req.body})`, `POST /stand/sales/:id/void` (line 490) reads `req.body.reason`. Each carries `validate({ params })` only — the contract has no `body` schema for them. No mass-assignment risk (`stand-queries.ts:400`/`:260` map explicit columns), but the *values* are untyped: `{costPrice: "abc"}` or `{itemName: {}}` reaches a Kysely `.set()` against an integer/citext column and 500s. This is the CLAUDE.md "every write body is authored once as Zod" mandate not being met, and it is invisible to the gate (see F7.16).

**✅ FIXED** **F7.8 🟠 `PATCH /aligner/batches/:id/{manufacture,deliver}` round-trips a date string through `new Date()`, defeating `toDateOnly`'s pass-through guard.**
The route does `targetDate ? new Date(targetDate) : null` (aligner.routes.ts:689, :736) on a value the contract has already pinned to `'YYYY-MM-DD'` (`targetDateBody` → `optionalDateString`). `new Date('2026-01-05')` parses as **UTC** midnight; `updateBatchStatus` then calls `toDateOnly()`, whose local-getter path shifts it back a day on any negative-UTC-offset host. `utils/date.ts:23-26` exists precisely to avoid this ("Plain date strings pass through untouched … would shift back a day on a negative-offset timezone") and the route destroys the string before that guard can fire. Correct today only because `TZ=Asia/Baghdad` is `+03`; wrong on the first Americas deployment, which the CLAUDE.md product direction anticipates.
Same shape elsewhere: `work.routes.ts:839` (`dx_date`), `visit.routes.ts:196`/`:232` (`visit_date`), `patient.routes.ts:1081`/`:1187` (`date_of_birth`).

**✅ FIXED** **F7.9 🟠 Fractional money is unhandled at the boundary — silently truncated for expenses, a 500 for invoices.**
Every money column is `integer` (baseline: `expenses.amount`, `invoices.amount_paid`/`usd_received`/`iqd_received`/`change`, `works.total_required`/`discount`, `work_items.item_cost`, `patients.estimated_cost`, `sms.exchange_rate`) — a deliberate IQD-first choice. But the contracts accept any number:
- `expense.contract.ts:75` `z.coerce.number().positive()` → `expense.routes.ts:210`/`:363` `parseInt(String(amount))` → **`12.99 USD` is stored as `12`, no error, no warning**. Same for `parseInt(String(unitCost))` in the Stand restock (stand.routes.ts:395).
- `PaymentService.ts:378` passes `amountPaid` straight through, so `12.5` reaches an `integer` column and PG raises `22P02` → a 500 that also leaks the raw driver message (F7.10).
Either reject non-integers at the contract, or move the columns to `numeric` — but the two halves currently disagree.

**✅ FIXED** **F7.10 🟠 Eleven handlers return the raw error message as the client-facing 500 text.**
`payment.routes.ts:207, 257, 288, 326, 413, 479` · `messaging.routes.ts:131, 181` · `email-api.ts:181, 213, 281` all pass `(error as Error).message` as `ErrorResponses.internalError`'s *message* argument. Everywhere else the codebase passes a fixed friendly string and puts the error object in `details` (which the global handler suppresses in production). So a PG failure on the money paths surfaces its SQLSTATE text — table/column names, constraint names, the offending literal — to whatever the client renders via `httpErrorMessage`.

### Authorization gaps found in the per-file read (extends F6.1/F6.2)

**✅ FIXED** **F7.11 🟠 `POST /api/patients` and `PUT /api/patients/:personId` have no `authorize()` and no record-age check.**
`patient.routes.ts:1017` and `:1160` — any authenticated role can create a patient and rewrite every demographic field (name, phone, DOB, address, tag, notes, currency) of any existing patient. The sibling `DELETE /patients/:personId` (line 1219) gates `authorize(FINANCE_ROLES)` **and** `requireRecordAge` with an approval queue. `PUT /patients/:personId/estimated-cost` (line 1265) is gated; the full-record `PUT` above it is not.

**✅ FIXED** **F7.12 🟠 `POST /api/email/config` rewrites the clinic's SMTP credentials with no role gate.**
`email-api.ts:190`, the router has no `authorize()` anywhere. Any authenticated staff account can repoint outbound mail (host/port/user/password/from-address) at a server they control, then use `POST /api/email/send` (line 33). `GET /config` masks the password on read (`email.ts:293`), so this is a write-side gap, not a disclosure one. This is the highest-value entry in the F6.2 list and deserves separating from "send mail".

**✅ FIXED** **F7.13 🔵 Further un-gated surfaces worth a product decision** (each `authenticate`-only): `GET /api/wa/qr` returns the **WhatsApp device-pairing QR** as a data URL — whoever scans it links a device to the clinic account; `POST /api/wa/{restart,unlink,refresh-qr}` (unlink clears the stored session); `POST /api/calendar/regenerate`; `POST /api/health/start|stop`; every `GET /api/stand/*` read (cost prices, margins, cashier ids); `GET /api/getpaymenthistory` + `/getworkforreceipt/:workId`; `GET /api/tasks` + `/tasks/history`.

### Correctness / robustness

**✅ FIXED** **F7.14 🟡 `sendSuccess(res, 'Photo deleted successfully')` passes the message in the `data` slot.**
`aligner.routes.ts:1001`. `sendSuccess(res, data, message?)` (`utils/error-response.ts:81`) — so the response is `{success:true, data:"Photo deleted successfully"}` with **no `message` key**, and `core/http.ts`'s unwrap hands the caller that string as the payload. Every other delete in the file is `sendSuccess(res, null, '…')`.

**✅ FIXED** **F7.15 🔵 `deletePhotoForSet`'s ownership check surfaces as a 500.**
`aligner.routes.ts:988` reads `req.query.path as string` (an array from `?path=a&path=b` makes `key.startsWith` throw) and `aligner-photo.service.ts:139` throws a bare `Error('Forbidden: …')` for a key outside `sets/<id>/`, which the route's catch reports as `500 Failed to delete photo`. The guard is correct; only its HTTP mapping is wrong (should be 400/403).

**✅ FIXED** **F7.16 🟠 The D1 gate is evadable by writing `type` instead of `interface`, and six route files already do.**
Both enforcement points match interfaces only — `eslint.config.js:91` `TSInterfaceDeclaration[id.name=/(Body|Params|Query|Filters?)$/]` and `scripts/contracts-dod.mjs:71` `/\binterface\s+([A-Za-z0-9_]+)/`. A `type X = { … }` with the same suffix is invisible to both, so D1 reports **0** while these hand-written request shapes live in `routes/`:
`admin.ts:34 OAuthCallbackQuery` · `api/expense.routes.ts:45 ExpenseQueryParams` · `api/expense.routes.ts:60 ExpenseFilters` · `api/lookup-admin.routes.ts:40 TableNameIdParams` · `api/cost-preset.routes.ts:49 CostPresetParams` · `api/file-explorer.routes.ts:56 PersonIdParams`.
(Type *aliases of contract exports* — `type WorkQueryParams = workContract.WorkQueryParams` etc. — are fine and not counted.) Widening both selectors to `TSTypeAliasDeclaration` as well would close it.

**✅ FIXED** **F7.17 🟡 The whole `health.routes.ts` router is unreachable at its documented paths and has no callers.**
`routes/api/index.ts:123` mounts it at `/health`, but every route inside re-declares its own `/health…` prefix (`health.routes.ts:19, 33, 48, 65`). The real URLs are therefore `/api/health/health`, `/api/health/health/detailed`, `/api/health/health/start`, `/api/health/health/stop`. Nothing in `public/js/**` or `scripts/**` calls any of them. The same file's comment two lines above (`expenseRoutes`) explicitly warns about this exact double-prefix hazard. (`HealthCheck.start()`/`stop()` are driven from `index.ts:412`/`:716`, so the subsystem works — only its HTTP control surface is dead.)

**✅ FIXED** **F7.18 🔵 Unvalidated numeric params reach the DB as `NaN` → 500 instead of 400.**
`work.routes.ts:753` (`GET /diagnosis/:workId`) · `:983` (`DELETE /diagnosis/:workId`) · `:87` (`getworkdetails?workId=`) · `:530` (`getworkdetailslist?workId=`) · `payment.routes.ts:96, 137` · `messaging.routes.ts:86, 152, 500` (`:date` used raw). Each `parseInt`s without an `isNaN` guard, so a junk id produces PG `22P02` and a 500 rather than a clean 400.

**✅ FIXED** **F7.19 🔵 Small semantic slips.**
`patient.routes.ts:1288` `estimated_cost = ${estimatedCost || null}` turns a legitimate **0** into NULL, and `currency || 'IQD'` silently overwrites the currency when the body sends `''`. `patient.routes.ts:1378-9` `alertTypeId ? parseInt(…) : 1` treats id `0` as "unset". `work.routes.ts:623, 686` `detailId || itemId` treats id `0` as absent. `stand.routes.ts:161` `parseInt(days) || 30` maps `days=0` to 30 and accepts negatives.

### Duplication

**✅ FIXED** **F7.20 🟡 The `MaxAppointmentsPerSlot` option lookup is copy-pasted five times inside `calendar.ts`** (lines 118, 212, 458, 597 and in `/month-availability`) — the same 6-line `SELECT option_value FROM options WHERE option_name = 'MaxAppointmentsPerSlot'` plus `parseInt` plus the literal default `3`. `/range` reads it as part of a batched multi-option query, so the correct shape already exists in the file.

**✅ FIXED** **F7.21 🟡 `parseLocalDate` is defined twice.** `patient.routes.ts:551` duplicates the exported `utils/date.ts#parseLocalDate` that `photo-editor.routes.ts:39` imports; its own comment says "matches photo-editor.routes.ts" rather than importing it.

**✅ FIXED** **F7.22 🟡 `work.routes.ts` imports the same function twice under two names.** `getWorkDetails` (line 24) and `getWorkDetails as getWorkDetailsFromQueries` (line 59), both from `work-queries.js`.

**✅ FIXED (finding partly corrected)** **F7.23 🟡 `ensureCalendarRange(60|90)` runs on every calendar READ** (`/week`, `/month`, `/range`, `/available-slots`, `/month-availability`) — a write executed inside a GET, on every page render of the calendar.

**✅ FIXED** **F7.24 🔵 `reports.routes.ts:328` filters `monthlyData` by `m.Year === year` after calling `getYearlyMonthlyTotals(1, year, …)`,** which returns exactly that year's twelve months — a no-op filter.

**F7.25 🟢 Clean on re-read:** `photo-editor.routes.ts` (view codes allow-listed in `photo-render.service.ts:112`, `sourceRelPath` through `resolveFileForServe`), `media.routes.ts` (WebCeph id always re-read from the DB, never trusted from the client), `lab-case.routes.ts`, `approval.routes.ts`, `reports.routes.ts` (the only fully role-tiered router: FINANCE for the books, ADMIN for per-doctor earnings), `announcement.routes.ts`, `portal-activity.routes.ts`, `threeshape*.routes.ts` (constant-time webhook secret), `telegram.routes.ts` (bounded in-memory job map, both timers `unref`-ed), `branding.routes.ts`, `slideshow.routes.ts`, `localsend.routes.ts`, `chair-display.routes.ts`, `monitoring.routes.ts` (rate-limited), `visit.routes.ts`, `staff.routes.ts`, `employee.routes.ts`, `task.routes.ts`.

## Phase 8 — `routes/` root leftovers (calendar, template-api, email-api, user-management) ✅

Findings recorded above: **F7.4** and **F7.20**/**F7.23** (calendar), **F7.12** and **F7.10** (email-api).

**F8.1 🟢 `user-management.ts` is the correct model for a root-mounted router.** `router.use(authorize(ADMIN_ROLES))` is pathless but the router is mounted at `/api/users` (index.ts:389), so the gate is naturally scoped — the opposite of the `admin.ts` mistake in F6.7. Contract-validated params + bodies throughout, self-demotion/self-deactivation/self-deletion all blocked.

**✅ FIXED** **F8.2 🔵 `template-api.ts` has no `authorize()` on any of its 10 routes** (already counted in F6.2) and `parseInt`s `:templateId`/`:workId` ten times without a NaN guard (F7.18 class). Its receipt/raw-HTML endpoints are deliberately un-enveloped, which is documented.

## Phase 9 — `routes/public/` ✅

**F9.1 🟢 `public/tv-display.routes.ts` is correctly hardened for a session-less surface.** `GET /tv-display/media/:file` resolves through `tv-display-store.ts:684 mediaFilePath`, which takes `path.basename`, rejects `.`/`..`, requires a classified extension, and re-checks containment with `path.relative` — belt and braces. The SSE stream, manifest, settings and page shell expose signage content only.

**✅ FIXED (the escaping half)** **F9.2 🔵 `public/video.routes.ts` is fully public by design** ("No authentication required — videos are educational content") and streams any `videos` row by sequential id. The generated player page escapes `description`/`details` with a real HTML escaper, so no XSS — but note that it interpolates the **HTML-escaped** string into a `<script>` string literal (line ~302, `var videoTitle = '…'`), where `&#039;` is six literal characters rather than an apostrophe. Cosmetic in JS, and the escaping is what makes the `.replace(/'/g, "\\'")` on the same line dead code.

**✅ FIXED** **F9.3 🔵 `normalizePath()` is duplicated** between `routes/public/video.routes.ts:25` and `routes/api/video.routes.ts` (its own comment says "see api/video.routes.ts").

## Phase 10 — `scripts/` ✅

**✅ FIXED** **F10.1 🟠 The DB scripts do not honour `DATABASE_URL`, and the two that do invert the app's precedence.**
`config/pg-connection.ts` is the documented SSoT ("discrete vars win over the URL", CLAUDE.md), but:
- **PG_* only, no URL support:** `db-migrate-check.mjs:26`, `db-baseline-stamp.mjs:44`, `db-baseline-build.mjs:75`, `db-baseline-verify.mjs:32`, `db-baseline-dump.mjs:35`, `reverse-sync-ops.mjs:33`, `_pgenv.mjs:19`.
- **URL first, PG_* as fallback (opposite of the app):** `hash-supabase-mirror.mjs:11`, `diff-supabase-mirror.mjs:14`.
On a deployment configured purely by `DATABASE_URL` — a supported shape — the first group connects with `host: undefined`, falling back to libpq defaults (localhost / unix socket / `$PGDATABASE`). `db-migrate-check.mjs` is wired as `predb:migrate`, so the guard rail built after the 2026-07-30 near-miss can certify a *different* database than the one `db:migrate` is about to write to. On a machine where both forms are set and disagree, `diff-supabase-mirror` compares the wrong local DB against the mirror.

**F10.2 🟢 `db-migrate-check.mjs` is otherwise exactly right** — read-only, distinguishes ghosts / pending / behind-high-water, refuses to certify drift, and explains the repair path.

**F10.3 🟢 `apply-patches.mjs` correctly overrides patch-package's best-effort default** (exact-version gate, `--error-on-fail`, patches copied to a throwaway dir so `patches/` is never mutated).

**✅ FIXED** **F10.4 🔵 `reset-admin-password.js` enforces a 6-character minimum** — same weak floor as `routes/auth.ts:222` (F6.5), for a tool whose whole purpose is resetting an admin credential.

## Phase 11 — `migrations/` ✅

**F11.1 🟢 Ordering and ledger shape are correct.** `migrations/pg/` holds exactly four files; all three post-baseline names sort after `1783100000000_baseline-2026-07-30` (`1785700253568` → 2026-08-02, `1787000000000`, `1787000100000`), so `db:migrate` has no out-of-order hazard and `db:check`'s high-water logic reports them as plain pending/applied.

**F11.2 🟢 Local↔Supabase parity holds for every post-baseline change.** `notnull-timepoint-and-visit-flags` ↔ `migrations/supabase/notnull-timepoint-and-visit-flags-2026-08-02.sql`; `cdc-capture-clock-timestamp` ↔ `migrations/supabase/cdc-capture-clock-timestamp-2026-08-31.sql` (both halves verified to stamp `clock_timestamp()`, with each side's own origin guard). `1787000100000_oauth-account-email` has **no mirror half, correctly** — it alters `integration_oauth_tokens`, which carries no `cdc_capture` trigger precisely so OAuth secrets never replicate; the baseline does contain the table.

**✅ FIXED** **F11.3 🟡 `diagnoses$compindex` is a redundant unique index.** `UNIQUE (id, work_id)` (baseline:3311) where `id` is already the primary key — it can never constrain anything the PK doesn't, and it is *not* the constraint F7.3 needs (that would be `UNIQUE (work_id)`). A SQL-Server-era artefact alongside `tblDiagnosis$tblworktblDiagnosis` (baseline:3815) on the same table.
Both dropped by `1788812600000_diagnoses-unique-workid.sql`: the new `UNIQUE (work_id)` subsumes the plain `(work_id)` btree exactly, and the composite never constrained anything the PK did not.

**✅ FIXED** **F11.4 🔵 `1787000100000_oauth-account-email.sql` cites a file that no longer exists** — "See migrations/pg/1781900000000_integration-oauth-tokens.sql", squashed into the baseline on 2026-07-30.

---

# ✅ AUDIT COMPLETE — 2026-09-07

Every backend file outside `services/` has now been read: `index.ts`, `config/`, `middleware/`, `utils/`, `types/`, `shared/`, all 52 route files (`routes/` root + `routes/api/` + `routes/public/`), `scripts/`, and `migrations/`. No code was changed.

## Consolidated ranking

> **Status:** this ranking is the audit's own output, kept as written on 2026-09-07. **Every entry in
> it is now closed** — but it is NOT the current picture: the 2026-09-09 re-review added findings
> R1-R9, and those are closed too (R9(c) last, in session S2). See *Remediation progress* at the
> top of this file for what changed and where.
> Two entries were corrected rather than fixed (F5.6 was a false positive; F7.23's "write inside a
> read" was really a discarded read), and both are recorded as such in batch 4.

### 🔴 Fix first
| # | Finding | Where |
|---|---|---|
| **F7.1** | `sendmedia2` reads any absolute path and ships it to a caller-chosen phone — full server-secret exfiltration from any staff session | `api/whatsapp.routes.ts:585` + `messaging/whatsapp-api.ts:86` |
| **F6.1** | `pg_dump` of the whole clinic DB, DB-config rewrite, `process.exit`, and full lookup CRUD behind `authenticate` only | `api/settings.routes.ts`, `api/lookup-admin.routes.ts` |
| **F6.7** | `admin.ts`'s `/api/admin` gate is mounted *after* `lookupAdminRoutes`, so it never runs for `/api/admin/lookups/*` | `index.ts:390` vs `:393` |

### 🟠 High
| # | Finding |
|---|---|
| **F7.12** | `POST /api/email/config` rewrites SMTP credentials with no role gate |
| **F7.2** | `GET /api/wa/send` and `GET /api/sendtwilio` do mass messaging on a GET, with `sameSite: 'lax'` cookies |
| **F6.8** | Stored XSS: patient-folder `.svg`/`.html` served inline, same-origin, no CSP; upload has no `fileFilter`, preview has no role gate |
| **F7.11** | `POST`/`PUT /api/patients` ungated while `DELETE` carries role + record-age + approval |
| **F2.1** | Invoice age guard reads the user-typed `date_of_payment`, not `sys_start_time` |
| **F7.3** | `POST /api/diagnosis` upsert is non-transactional with no `UNIQUE(work_id)` → duplicate rows |
| **F7.5** | `PUT /appointments/:id` skips the double-booking guard; PUT+DELETE broadcast nothing |
| **F7.9** | Fractional money silently truncated (expenses) or 500 (invoices) against `integer` columns |
| **F7.4** | `/api/calendar/range` has no span bound (the guard exists in `/statistics/multi-year`) |
| **F10.1** | DB scripts ignore `DATABASE_URL`; the two that read it invert the app's precedence — incl. the `predb:migrate` ledger guard |
| **F7.8** | `new Date('YYYY-MM-DD')` defeats `toDateOnly`'s pass-through — off-by-one day on any negative-UTC-offset deployment |
| **F7.10** | Raw DB error text returned as the client-facing 500 message on the money paths (11 sites) |
| **F7.16** | The D1 contract gate matches `interface` only — 6 hand-written request `type`s in `routes/` are invisible to it |
| **F7.7** | 4 Stand write endpoints accept an unvalidated `req.body` |
| **F7.6** | Check-in SSE broadcasts today's date instead of the appointment's |
| **F6.2 / F7.13** | ~45 more mutations with no `authorize()` — WhatsApp pairing QR + unlink, aligner (25 routes), templates, branding, calendar regenerate, health start/stop |
| **F1.1** | `NODE_ENV ??=` runs after ESM imports → split cookie-Secure posture on the `npm start` path |

### 🟡 Dead / duplicated (safe deletions)
`X.1` `config/ssl.ts` (66 lines, no importer, no `ssl/` dir) · `F2.3` `middleware/validation-schemas.ts` (0 importers) · `F5.1` the hand-written `types/` modules (992 lines, 6 symbols used) · `F7.17` the whole `health.routes.ts` router (mis-prefixed to `/api/health/health`, zero callers) · `F1.2`–`F1.4` dead locals/conditions in `index.ts` · `F2.2` dead barrel re-exports · `F5.5`/`F5.6` dead `shared/` exports and unreferenced contract fragments · `F7.20` the ×5 `MaxAppointmentsPerSlot` lookup · `F7.21` duplicate `parseLocalDate` · `F7.22` double import of `getWorkDetails` · `F9.3` duplicate `normalizePath` · `F11.3` redundant `diagnoses$compindex` (dropped, with `tblDiagnosis$tblworktblDiagnosis`, by the batch-2 `UNIQUE (work_id)` migration).

### 🟢 Verified clean
No SQL injection, no `sql.raw`/dynamic identifiers, no missing-`return` double-sends (F6.6, F6.9). Path handling is correct everywhere it goes through `resolveFileForServe` / `mediaFilePath` / `patientPath` — **F7.1 is the sole exception, and it bypasses those helpers entirely.** `reports.routes.ts` is the reference for role tiering; `user-management.ts` for a safely-scoped root router; `db-migrate-check.mjs` + `apply-patches.mjs` for guard-rail scripts; migrations are correctly ordered and mirror-consistent (F11.1, F11.2).

## Themes
1. **Authorization is opt-in per route, and the opt-in was often skipped.** ~24 routers gate, ~17 don't; the un-gated set includes the most privileged endpoints in the app. A default-deny posture (allowlist the deliberately-open reads) would have prevented F6.1, F7.11, F7.12 and F7.13 as a class.
2. **The contract mandate is enforced only against `interface`.** F7.16 and F7.7 are the same hole seen from two sides.
3. **Date and money both cross the boundary as loosely-typed scalars.** F7.8 (UTC parse) and F7.9 (fractional into `integer`) are latent on this deployment and become real on the next one — exactly the multi-deployment risk CLAUDE.md's product-direction note calls out.
4. **The realtime broadcast is hand-wired per handler**, so it is wrong (F7.6) or missing (F7.5) wherever someone forgot; the `respondWithState` helper in `tv-display.routes.ts` shows the shape that stops this.

## Open questions — answered 2026-09-08

- **F6.1 / F6.7 / F7.11 / F7.12 / F6.2 / F7.13 — was the missing role gate deliberate?**
  A genuine gap. Decision: **an explicit `authorize()` on every mutation**, so the posture is written
  down route by route rather than inferred from silence. Most keep the reach they already had
  (`CLINICAL_ROLES` = all three roles); the clinic-configuration and money surfaces moved up a tier.
  The WhatsApp device surface is **FINANCE_ROLES (the front-desk/"secretary" tier), not admin-only** —
  front desk runs the reminder batches and re-links the phone. See *Posture changes worth confirming
  with the clinic* in batch 4 for the four user-visible narrowings.
- **F5.1 — delete the hand-written `types/` modules, or repopulate them?**
  **Delete the dead parts.** 984 lines → 347; `services.types.ts` gone entirely; `config.types.ts`
  exports only `AppConfig`. Nothing was repopulated: contracts own request/response shapes, `db.d.ts`
  owns row shapes, and each service owns its own types — the deleted copies existed only to drift.
- **F7.9 — reject non-integer money, or migrate the columns to `numeric`?**
  **Reject at the contract** (`moneyInt`). The `integer` money schema is a deliberate IQD-first
  choice and stays; what changed is that the boundary now agrees with it instead of truncating.
  Migrating to `numeric(18,2)` for real USD-cents support remains available as a separate project —
  it would touch ~10 columns on both DBs plus every query, contract and client-side money
  calculation, which is well beyond the audit's remit.
