# Dead Route Sweep — Report

**Branch:** `fix/backend-audit-remediation`
**Method:** A subagent fleet built an exact inventory of all 335 mounted backend routes, adversarially searched the entire repo (staff app, patient portal, external aligner portal, scripts, services, configs, docs) for any consumer of each, and traced the downstream code that dies with each confirmed-dead route. Every DEAD verdict was then independently re-verified by hand (frontend + whole-repo grep) before removal.

**Result (two passes):** 335 routes → **276 USED**, **45 DEAD (removed)**, **14 still-kept (external/operational)**.
- **Pass 1** (first sweep): 275 USED · 26 DEAD removed · 34 UNCERTAIN kept.
- **Pass 2** (re-audit of the 34 UNCERTAIN, incl. a deep read of the `aligner-portal-external` consumer): **19 removed**, **1 reclassified USED** (`/api/videos/:id`), **14 kept** (genuinely external/operational). See [Pass 2](#pass-2--re-audit-of-the-34-uncertain) below.

Rule applied: a route is removed **only** if used by *nothing* — frontend, portal, kiosk, batch/cron, OAuth, sync/ops, browser-print, scripts, or docs. Anything uncertain was kept.

Verification after removal: `npm run typecheck:all` ✅ · `npm run lint:fix` ✅ · `npm run build` ✅. (Live boot smoke test deferred — a prod server is running on :3000; restarting it is a deployment step for the maintainer.)

---

## Removed routes (26) + the downstream code deleted with them

| # | Method | Route | Router file | Downstream removed (orphaned only) |
|---|--------|-------|-------------|-------------------------------------|
| 1 | GET | `/api/patients/:personId/qrcode` | patient.routes.ts | `imaging.generateQRCode` (services/imaging/index.ts) + `QRCodetoFile` (services/imaging/qrcode.ts) + its now-unused `fs`/`createPathResolver` imports |
| 2 | POST | `/api/patients/:personId/portal/set-pin` | patient.routes.ts | — (`PatientPortalService.setPin` kept: used internally by `resetToDefaultPin`) |
| 3 | GET | `/api/AppsUpdated` | appointment.routes.ts | — (emitter/types shared by live handlers) |
| 4 | GET | `/api/getpayments` | payment.routes.ts | import only (`getPayments` query kept: used by portal + scripts) |
| 5 | POST | `/api/updateExchangeRate` | payment.routes.ts | `updateExchangeRate` query (payment-queries.ts) + `ExchangeRateBody` interface |
| 6 | GET | `/api/getwork/:workId` | work.routes.ts | `WorkResult` interface |
| 7 | GET | `/api/workstatuses` | work.routes.ts | — (`WORK_STATUS` kept: shared) |
| 8 | GET | `/api/getactivework` | work.routes.ts | — (`getActiveWork` kept: used by another live handler + services) |
| 9 | GET | `/api/work/item/:itemId/teeth` | work.routes.ts | `getWorkItemTeeth` query (work-queries.ts) |
| 10 | GET | `/api/work/:workId/items` | work.routes.ts | `getWorkItems` alias (work-queries.ts) |
| 11 | POST | `/api/work/:workId/items` | work.routes.ts | `addWorkItem` alias (work-queries.ts) |
| 12 | PUT | `/api/work/item/:itemId` | work.routes.ts | `updateWorkItem` alias (work-queries.ts) |
| 13 | DELETE | `/api/work/item/:itemId` | work.routes.ts | `deleteWorkItem` alias (work-queries.ts) |
| 14 | GET | `/api/visitsSummary` | visit.routes.ts | import only (`getVisitsSummary` query kept: used by portal + scripts) |
| 15 | GET | `/api/getVisitDetailsByID` | visit.routes.ts | import only (`getVisitDetailsByID` query kept: used by scripts) |
| 16 | GET | `/api/wa/send-to-patient` | whatsapp.routes.ts | `SendToPatientQuery` interface + now-unused `getNewAppointmentMessage` import (query kept: used by scripts) |
| 17 | GET | `/api/wa/sendxrayfile` | whatsapp.routes.ts | `SendXrayQuery` interface (`sendXray_` kept: used by `/sendmedia2`) |
| 18 | GET | `/api/wa/detailed-status` | whatsapp.routes.ts | — (`messageState` shared) |
| 19 | GET | `/api/options/pattern/:pattern` | settings.routes.ts | `PatternParams` interface + now-unused `getOptionsByPattern` import (query kept: used by scripts) |
| 20 | GET | `/api/config/database/status` | settings.routes.ts | `DatabaseConfigService.getConfigurationStatus()` |
| 21 | POST | `/api/config/database/backup` | settings.routes.ts | `DatabaseConfigService.createBackup()` |
| 22 | POST | `/api/config/database/restore` | settings.routes.ts | `DatabaseConfigService.restoreFromBackup()` |
| 23 | GET | `/api/config/database/presets` | settings.routes.ts | `DatabaseConfigService.getConnectionPresets()` |
| 24 | GET | `/api/clear` | utility.routes.ts | — |
| 25 | GET | `/api/holidays/range` | holiday.routes.ts | `DateRangeQuery` interface + now-unused `getHolidaysInRange` import (query kept: used by calendar + scripts) |
| 26 | GET | `/api/holidays/check-date` | holiday.routes.ts | now-unused `isDateHoliday` import (query kept: used by AppointmentService + scripts) |

**Notes**
- No router file was fully emptied, so no `index.ts` mount lines changed.
- Query/service functions that other code still calls were **kept**; only the dead route handler and any symbol whose *sole* remaining reference was that handler were removed.
- `EnvironmentManager.createBackup/restoreFromBackup` were intentionally **not** removed (createBackup is shared by `updateConfiguration`); only the `DatabaseConfigService` wrappers were deleted. Worth a future look if you want to prune `EnvironmentManager.restoreFromBackup` too.

---

## Pass 2 — re-audit of the 34 UNCERTAIN

The 34 routes Pass 1 kept were re-examined individually, including a deep read of **`aligner-portal-external/`** as a potential consumer. **Decisive finding:** that external app consumes **zero** main-app `/api/*` routes — it talks only to its own Supabase Edge Function (`/functions/v1/aligner-portal-auth/{token,doctors}`, which its own header calls the *"always-on replacement for the main app's `/api/aligner-portal/{token,doctors}`"*) and to PostgREST. This flipped the two `aligner-portal` routes from "kept for the external portal" to confirmed dead.

### Removed in Pass 2 (19) + downstream code deleted

| # | Method | Route | Router file | Downstream removed (orphaned only) |
|---|--------|-------|-------------|-------------------------------------|
| 1 | POST | `/api/aligner-portal/token` | portal-aligner.routes.ts | **whole file deleted** (only 2 routes) + `index.ts` mount + `getDoctorById`, `getDoctorByEmail` (aligner-queries.ts) |
| 2 | GET | `/api/aligner-portal/doctors` | portal-aligner.routes.ts | (same file) — `getAllDoctors` kept (used by `aligner.routes.ts` + a script) |
| 3 | GET | `/api/aligner/activity/:setId` | aligner.routes.ts | `getUnreadActivitiesBySetId` + `AlignerActivity` interface (aligner-queries.ts) |
| 4 | PATCH | `/api/aligner/activity/:activityId/mark-read` | aligner.routes.ts | `markActivityAsRead` (aligner-queries.ts) |
| 5 | PATCH | `/api/aligner/activity/set/:setId/mark-all-read` | aligner.routes.ts | `markAllActivitiesAsRead` (aligner-queries.ts) |
| 6 | GET | `/v/:id/info` | public/video.routes.ts | — (`/v/:id/stream` + `/download` kept: referenced by the `/v/:id` share page) |
| 7 | GET | `/api/wa/status` | whatsapp.routes.ts | — (`getStatus`/`messageState` shared by `/initial-state`) |
| 8 | GET | `/api/messaging/circuit-breaker-status` | messaging.routes.ts | `getCircuitBreakerStatus` (messaging-queries.ts) |
| 9 | POST | `/api/messaging/reset-circuit-breaker` | messaging.routes.ts | `resetCircuitBreaker` (messaging-queries.ts) |
| 10 | POST | `/api/messaging/batch-status-update` | messaging.routes.ts | `batchUpdateMessageStatuses` (messaging-queries.ts) + local `statusToAck`, `convertToStatusUpdateMessage`, 3 interfaces |
| 11 | GET | `/api/messaging/details/:date` | messaging.routes.ts | `getMessageDetails` import only (kept in MessagingService) |
| 12 | GET | `/api/calendar/time-slots` | calendar.ts | `TimeSlot` interface + `formatTimeForDisplay` |
| 13 | GET | `/api/calendar/day/:date` | calendar.ts | `getCalendarDay` + `CalendarDayRow` (calendar-queries.ts) + `DateParams` interface |
| 14 | POST | `/api/calendar/ensure-range` | calendar.ts | `EnsureRangeBody` interface (`ensureCalendarRange` kept: called internally by `/week`+`/month`) |
| 15 | GET | `/api/templates/document-types/:typeId` | template-api.ts | `getDocumentTypeById` (template-queries.ts) + `TypeIdParams` interface |
| 16 | GET | `/api/templates/default/:documentTypeId` | template-api.ts | `getDefaultTemplate` (template-queries.ts) + `DocumentTypeIdParams` interface |
| 17 | GET | `/api/getLatestwire` | visit.routes.ts | `getLatestWire` + `LatestWire` interface (visit-queries.ts). Note: frontend uses the **plural** `/api/getlatestwires` (a different, live route) |
| 18 | GET | `/api/auth/status` | auth.ts | — (frontend uses `/api/auth/me`) |
| 19 | GET | `/api/settings/cost-presets/currencies` | cost-preset.routes.ts | `getCostPresetCurrencies` (cost-preset-queries.ts) |

> Queries 13/17/19/3 were initially **kept** in Pass 2 because checked-in PG-migration scripts still imported them; they were pruned only after those scripts were removed (see next section).

### Reclassified USED (1)

- **`/api/videos/:id`** — actually called by `Videos.tsx` (staff app); it was mis-grouped as uncertain. **Kept.**

### Still kept (14) — "no in-repo caller" ≠ dead

External/operational consumers the static search can't see; left untouched:
- **Ops / sync / health:** `/api/sync/trigger`, `/api/sync/queue-notify`, `/api/sync/status`, `/api/health/*` (hit by Supabase nudge / manual drain / monitoring infra).
- **External batch / cron:** `/api/sendtwilio`, `/api/checktwilio` (plausibly an external scheduler).
- **OAuth / Google:** `/api/admin/google-drive/auth-url`, `/api/admin/google-drive/test`, `/api/admin/google-drive/status` (`auth-url` is opened in a browser during one-time OAuth consent — no code caller by design).
- **Public video / kiosk:** `/v/:id` share page (+ its `/stream` and `/download`).

---

## Migration-tooling cleanup (Postgres cutover complete)

With the Postgres cutover declared complete, the one-off `postgres-migration-plan.md` tooling was removed (it was the *only* remaining consumer of 4 query functions kept above). **14 scripts deleted** (~2,500 LOC): `check-pg.ts`, `check-pg-phase4.ts`, `check-pg-phase5.ts`, `etl-mssql-to-pg.ts`, `parity-lib.ts`, `parity-diff.ts`, `parity-write.ts`, `probe-sysstarttime.ts`, `probe-prod-mssql.ts`, `check-schema-parity.ts`, `diff-sandbox-vs-prod.ts`, and `scripts/schema-rename/{build-mapping,emit-migration,apply-codemod}.ts`.

- **Kept:** `mssql` package + `services/database/pool.ts` — the Dolphin sink is their sole remaining runtime importer.
- **Doc updated:** `CLAUDE.md`'s "mssql on disk" + `DB_*` env notes now reflect the cutover and the removals.

Verification after Pass 2 + cleanup: `npm run typecheck:all` ✅ · `npm run lint:fix` ✅ · `npm run build` ✅.
