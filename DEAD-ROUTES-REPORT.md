# Dead Route Sweep — Report

**Branch:** `fix/backend-audit-remediation`
**Method:** A subagent fleet built an exact inventory of all 335 mounted backend routes, adversarially searched the entire repo (staff app, patient portal, external aligner portal, scripts, services, configs, docs) for any consumer of each, and traced the downstream code that dies with each confirmed-dead route. Every DEAD verdict was then independently re-verified by hand (frontend + whole-repo grep) before removal.

**Result:** 335 routes → **275 USED**, **26 DEAD (removed)**, **34 UNCERTAIN (kept)**.

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

## Kept despite no React-staff-app caller (34 UNCERTAIN) — these are NOT dead

These are reached by non-frontend consumers (the exact reason "unused by the frontend" ≠ "deletable"). Left untouched:

- **Ops / sync / health:** `/api/sync/trigger`, `/api/sync/queue-notify`, `/api/sync/status`, `/api/health/*`.
- **External batch / cron:** `/api/sendtwilio`, `/api/checktwilio`.
- **OAuth / Google:** `/api/admin/google-drive/auth-url`, `/api/admin/google-drive/test`, `/api/admin/google-drive/status`.
- **External aligner portal (Cloudflare Access):** `/api/aligner-portal`, `/api/aligner-portal/token`, `/api/aligner-portal/doctors`.
- **Public video / kiosk:** `/v/:id/info`, `/api/videos/:id`.
- **WhatsApp/messaging status & activity:** `/api/wa/status`, `/api/messaging/circuit-breaker-status`, `/api/messaging/reset-circuit-breaker`, `/api/messaging/batch-status-update`, `/api/messaging/details/:date`, aligner activity routes.
- **Calendar / templates / misc** built via dynamic paths the static search couldn't fully resolve: `/api/calendar/time-slots`, `/api/calendar/day/:date`, `/api/calendar/ensure-range`, `/api/templates/document-types/:typeId`, `/api/templates/default/:documentTypeId`, `/api/getLatestwire`, `/api/auth/status`, `/api/settings/cost-presets/currencies`.

> Some of these (e.g. cost-presets/currencies, calendar/time-slots) may in fact be callable via dynamically-built frontend URLs; they were kept precisely because that could not be ruled out with certainty. Re-audit individually if you want a second pass.
