# Phase 3 — Response Modeling Progress

## Current state (2026-06-06) — ✅ PHASE 3 COMPLETE

D2: **41** (started at 107; baseline 103; `BASELINE.D2` ratcheted to **41** — all 41 remaining markers fully
modeled-or-allowlisted). **Full gate green + heaviest-tightened groups (aligner, patient) runtime-smoked on real
data** (Session 15 — see `docs/shared-contract-progress.md`). Only **Phase 5 (lock-in)** remains for the overall rollout.

Run `npm run contracts:check -- --verbose` for the exact per-file breakdown.

## Groups completed

### Group 1: Aligner — DONE (107 → 91)
- All 11 `anyArray` response slots → typed row schemas (`z.array(<rowSchema>)`)
- Row schemas converted: `alignerSetRow`, `alignerBatchRow`, `alignerNoteRow`, `alignerDoctorRow`, `archformPatientRow`, `alignerSetForMatchRow` → `z.looseObject` with full nullability
- `allSets` uses new `allSetsRow = z.looseObject({ aligner_set_id, person_id, work_id })` (v_allsets view has extra computed cols not in alignerSetRow)
- Interface → type flips: `AlignerSet`, `AlignerSetWithDetails`, `AlignerSetForMatch` in `aligner-queries.ts`
- `AlignerService.searchPatients()` return type annotation removed (was masking wrong shape)
- Frontend cascade fixes: `PatientSets.tsx` (null-coalesces `set_sequence??0`, url fields `??undefined`, `AlignerDoctorName??undefined`), `PaymentFormDrawer.tsx` and `LabelPreviewModal.tsx` prop types accept `| null`

### Group 2: Patient — DONE (91 → 82)
- `patientInfo.response` → `patientInfoRow` (full looseObject, all consumer fields)
- `timepoints` → `z.array(timepointRow)`
- `timepointImages` → `z.array(z.string())`
- `gallery` → `z.array(galleryImageRow)` (elements nullable)
- `patientPhones` → `z.array(patientPhoneRow)` (phone is `string | null`)
- `alerts` → `z.array(alertRow)` (`creation_date` uses `timestampString`)
- `patientById` → KEPT `z.unknown()`: `// Intentionally loose: merged patient+alerts shape; FK columns diverge`
- Interface → type flips: `PatientInfoResult`, `TimePointResult` (PatientService.ts), `Alert` (alert-queries.ts), `ImageDimension` (imaging/index.ts), `PatientPhone` (patient-queries.ts, phone changed to `string|null`)
- Runtime smoke: `GET /api/patients/:personId/info` + `/phones` + `/alerts` → 200 ✅

### Group 3: File-Explorer + Expense — DONE (82 → 71)

**File-explorer (`shared/contracts/file-explorer.contract.ts`):**
- Removed `const anyArray` const
- All 6 loose slots get `// Intentionally loose: filesystem service object — dynamic fields`
- `workingFiles.entries` and `upload.files` use inline `z.array(z.unknown())`

**Expense (`shared/contracts/expense.contract.ts`):**
- `expenseList.response` → `z.array(expenseRow)`
- `expenseCategories.response` → `z.array(expenseCategoryRow)`
- `expenseSubcategories.response` → `z.array(expenseSubcategoryRow)`
- `expenseById.response` → `expenseRow`
- `expenseSummary` KEPT loose: `// Intentionally loose: rollup aggregate — computed server-side, structure varies by filter combination`
- Interface → type flips: `Expense`, `ExpenseCategory`, `ExpenseSubcategory` in `expense-queries.ts`
- Gate: `typecheck:all` ✅ (0 errors)
- Runtime smoke ✅ (this session):
  - `GET /api/expenses` → 200, 3994 rows, correct field names (`id`, `expense_date`, etc.)
  - `GET /api/expenses/categories` → 200, 7 categories with correct `{ category_id, category_name }`
  - `GET /api/expenses/subcategories/:categoryId` → 200 (0 results for category 3 — no subs)
  - `GET /api/expenses/:id` (expense 4055) → 200, keys match `expenseRow` schema
  - `GET /api/patients/92/files` → 200, `{ path, parent, flat, truncated, entries }`
  - `GET /api/patients/92/working-files` → 200, `{ entries: [...19 items] }`

### Group 4: Video — DONE (71 → 64 combined with Groups 5/6)

**Tightened (`shared/contracts/video.contract.ts`):**
- Added `videoCategoryRow = z.looseObject({ id: z.number(), name: z.string() })`
- Added `videoRow = z.looseObject({ id, description, Video, Image, category, details })` (all 6 consumer fields)
- `list.response` → `z.array(videoRow)` (was `anyArray`)
- `categories.response` → `z.array(videoCategoryRow)` (was `anyArray`)
- `byId.response` → `videoRow.nullable()` (was `z.unknown()`)
- `create.response` / `update.response` → KEPT `z.unknown()` + `// Intentionally loose:` (consumer does not use these responses — calls `loadVideos()` after)
- Removed unused `const anyArray` definition
- Docblock updated to not contain loose-marker patterns (was triggering D2 hits)
- Interface → type flips: `Video`, `VideoCategory` in `video-queries.ts`
- Gate: `typecheck:all` ✅ (0 errors)
- Runtime smoke ✅: `GET /api/videos` → 200, 38 videos, all 6 fields present; `GET /api/videos/categories` → 200, 9 categories; `GET /api/videos/1054` → 200, `{ id, description, Video, Image, category, details }` ✅

### Group 5: Reports — DONE (71 → 64 combined with Groups 4/6)

**Allowlisted (`shared/contracts/reports.contract.ts`):**
- All 4 response slots documented with `// Intentionally loose: computed aggregate — … structure varies by filter`
- Fixed docblock (lines 10–11 previously contained `anyArray`/`z.unknown()` text that triggered D2 hits) → cleaned to plain prose
- D2 count: was 7 (including 2 comment-line hits from docblock) → 5 (only const def + 4 response lines)
- Gate: `typecheck:all` ✅ (0 errors)
- Runtime smoke ✅: `GET /api/statistics?month=5&year=2026` → 200, `{ dailyData: [22 rows], summary: {…} }`; `GET /api/statistics/yearly` → 200, `{ monthlyData: [6 rows], summary: {…} }`

### Group 6: Calendar — DONE (71 → 64 combined with Groups 4/5)

**Allowlisted (`shared/contracts/calendar.contract.ts`):**
- All 5 response slots documented with `// Intentionally loose: hierarchical … assembled by calendar service — structure varies by filter/range`
- Docblock extended to explain Group 6 allowlist rationale
- D2 count unchanged at 6 (all 6 are legitimately loose hierarchical shapes)
- Gate: `typecheck:all` ✅ (0 errors)
- Runtime smoke ✅: `GET /api/calendar/week?date=2026-06-06` → 200, `{ days: [6] }`; `GET /api/calendar/available-slots?date=2026-06-06` → 200, `{ slots: [22] }`

## Groups completed (D2: 64 → 41)

### Group 7: Visit — DONE (5 → 0)
- Flipped `interface wire`, `interface LatestWireDetails`, `interface Visit` → `type` in `visit-queries.ts`
- `getWires.response` → `z.array(z.looseObject({ id: z.number() }))`
- `latestWires.response` → `z.looseObject({ upper_wire_id, lower_wire_id, UpperWireName, LowerWireName })` (all nullable)
- `visitsByWork.response` → `z.array(z.looseObject({ id: z.number() }))`
- `visitById.response` → `z.looseObject({ id: z.number() }).nullable()`
- Removed `const anyArray` (no longer used)
- Runtime smoke ✅: getWires (29 rows, `{id, name}`), latestWires (`{upper_wire_id,…}`), visitsByWork (4 rows), visitById (`{id,...}`)

### Group 8: User Management — DONE (2 → 0)
- Flipped `interface UserResult` → `type UserResult` in `user-management.ts`
- Added `userRow = z.looseObject({ userId, username, …, lastLogin: timestampString.nullable(), createdAt: timestampString })`
- `usersList.response` → `z.object({ users: z.array(userRow) })`
- Removed `const anyArray`
- Runtime smoke ✅: `/api/users` (2 users, all 7 fields present, timestamps as ISO strings)

### Group 9: Holiday — DONE (2 → 0)
- Flipped `interface AppointmentOnDate` → `type AppointmentOnDate` in `holiday-queries.ts`
- Added `appointmentOnDateRow = z.looseObject({ appointment_id: z.number(), app_date: timestampString })`
- `appointmentsOnDate.response.appointments` → `z.array(appointmentOnDateRow)`
- Removed `const anyArray`
- Runtime smoke ✅: `/api/holidays/appointments-on-date?date=2026-06-06` (23 results, `{appointment_id, app_date, …}`)

### Group 10: Photo-Editor photo-dates — DONE (2 → 0)
- Flipped `interface PhotoSessionAppointment`, `interface PhotoSessionVisit` → `type` in `photo-session-queries.ts`
- `photoDates.response` → `z.object({ appointments: z.array(z.looseObject({ date: z.string() })), visits: z.array(z.looseObject({ visitDate: z.string() })) })`
- Removed `const anyArray`
- Runtime smoke ✅: `/api/photo-editor/92/photo-dates` (26 appointments, 0 visits)

### Group 11: Settings + Options — DONE (5 → 2)
- Fixed comment hit (removed `z.unknown()` from docblock)
- Flipped `interface Option` → `type Option` in `options-queries.ts`
- Added `optionRow = z.looseObject({ option_name: z.string(), option_value: z.string().nullable() })`
- `getOptions.response` → `z.object({ options: z.array(optionRow) })`
- Removed `const anyArray`
- Kept `getDatabaseConfig.response.config: z.unknown()` and `exportDatabaseConfig.response.config: z.unknown()` — both are intentionally loose (dynamic masked DB config maps)
- Runtime smoke ✅: `/api/options` (23 options, `{option_name, option_value}`)

### Group 12: Appointment — DONE (5 → 2)
- Fixed 2 comment hits (removed `z.unknown()` text from comment lines 67+112)
- Tightened `createAppointment.response` from `z.object({…, appointment: z.unknown()})` to `z.looseObject({ appointment_id: z.number().optional() })` — `appointment` preserved in loose tail
- Marked `webApps.response` and `quickCheckin.response` as intentionally loose with comments
- Runtime smoke ✅: `/api/getWebApps?PDate=2026-06-06` (200, `{appointments,all,present,waiting,completed}`)

### Group 13: Cleanup + Allowlisting — DONE (various → allowlisted)
- **messaging** (5→4): fixed comment hit; inlined `z.array(z.unknown())` + removed `const anyArray`; added intentionally-loose comments to count/reset
- **lookup-admin** (5→4): fixed comment hit ("anyArray" → "loose arrays"); added intentionally-loose comments for tables/items/createItem
- **media** (4→3): fixed comment hit; added intentionally-loose comments for patientLink/photoTypes
- **template** (4→3): removed `const anyArray`; inlined `z.array(z.unknown())` for getTemplates/documentTypes; added intentionally-loose comments
- **utility** (2→1): removed `const anyArray`; inlined `z.array(z.unknown())` for google
- **email-api** (1→1): added intentionally-loose comment for config
- **payment** (1→1): added intentionally-loose inline comment for updateExchangeRate.result

## Remaining D2 allowlist (41 hits — all documented as intentionally loose)
```
6  shared/contracts/calendar.contract.ts       ← hierarchical service objects — all allowlisted
6  shared/contracts/file-explorer.contract.ts  ← filesystem service objects — all allowlisted
5  shared/contracts/reports.contract.ts        ← computed aggregates — all allowlisted
4  shared/contracts/lookup-admin.contract.ts   ← dynamic per-tableName rows — all allowlisted
3  shared/contracts/media.contract.ts          ← WebCeph API objects — all allowlisted
3  shared/contracts/messaging.contract.ts      ← WhatsApp delivery objects — all allowlisted
3  shared/contracts/template.contract.ts       ← DocumentTemplate rows — all allowlisted
2  shared/contracts/appointment.contract.ts    ← webApps/quickCheckin service objects — allowlisted
2  shared/contracts/settings.contract.ts       ← dynamic DB config maps — allowlisted
2  shared/contracts/video.contract.ts          ← create/update responses, consumer unused — allowlisted
1  shared/contracts/email-api.contract.ts      ← dynamic SMTP config map — allowlisted
1  shared/contracts/expense.contract.ts        ← expenseSummary aggregate — allowlisted
1  shared/contracts/patient.contract.ts        ← patientById merged shape — allowlisted
1  shared/contracts/payment.contract.ts        ← Kysely UpdateResult[] — allowlisted
1  shared/contracts/utility.contract.ts        ← Google Contacts API dynamic rows — allowlisted
```

## After all groups done — ✅ ALL DONE (Session 15, 2026-06-06)
1. ✅ Lowered `BASELINE.D2` in `scripts/contracts-dod.mjs` 103 → **41** (final allowlisted count).
2. ✅ Full gate green: `typecheck:all` (EXIT 0) + `build` (29 contracts emitted) + `lint` (0 errors) +
   `contracts:check --strict` (D1=0 ≤ 33, D2=41 ≤ 41 — no regression).
3. ✅ Updated `docs/shared-contract-progress.md` — Session 15 entry + Verification-log row + tier-status line.

**Not part of Phase 3 (deferred to Phase 5 — lock-in):** ratchet `BASELINE.D1` 33 → 0; extend the ESLint
`routes/**` interface-ban to `*Params|*Query|*Filters`; add `require-schema-on-reads`; flip `STRICT` in CI +
add `.github/workflows/gate.yml`.

## Key patterns / gotchas (hard-won)
- PG `timestamp` columns → `timestampString`; PG `date` columns → `z.string()`
- Always-null-capable columns → `.nullable()` NOT `.optional()` (`.optional()` fail-louds when null is present)
- `z.looseObject` everywhere for rows with unmodeled long-tail fields (NOT `z.object` — it strips)
- `sendData` source must be `type` not `interface` (looseObject index-sig TS2345)
- Check `extends`/`implements` before flipping interface→type; use `type Foo = Bar & { ... }` pattern
- Row schemas that already exist as `z.object` (e.g. old aligner rows) need conversion to `z.looseObject` before wiring into responses
- After conversion: verify `Pick<>`/`WithAliases` types still compile (aligner.types.ts pattern)
- Docblock/comment text containing `anyArray` or `z.unknown()` triggers D2 hits — keep those patterns out of comments
- The `const anyArray` definition line itself counts as 1 D2 hit; remove it when all usages are inlined or replaced
- When the consumer doesn't use a mutation response (re-fetches after), it's safe to keep `z.unknown()` + allowlist comment
