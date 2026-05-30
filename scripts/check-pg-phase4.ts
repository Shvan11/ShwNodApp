/**
 * Phase-4 smoke test: confirm the translated Kysely query modules emit SQL that is
 * VALID against the live PostgreSQL schema (shwan_test). Tables may be empty pre-ETL
 * (Phase 6), so this asserts only "executes without error", not row content — it
 * catches column-name/casing mistakes, bad casts, citext LIKE issues, date-param
 * inference, and the inlined-view rewrites (V_Videos, V_rptNoWork, qryLast*wire).
 *
 * Run (forces the pg path; the modules call getKysely() directly):
 *   $env:DB_DRIVER='pg'; npx tsx scripts/check-pg-phase4.ts   (PowerShell)
 *   DB_DRIVER=pg npx tsx scripts/check-pg-phase4.ts           (bash)
 *
 * READ-ONLY: only SELECT-path functions are exercised. Write/upsert/proc functions
 * (markPrivate, create*, stored-proc-backed batch ops, etc.) are intentionally skipped.
 */
import { getTimePoints, getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { listPrivateForPatient, listPrivateForTimepoint } from '../services/database/queries/private-photos-queries.js';
import { isDateHoliday, getHolidaysInRange, getAppointmentsOnDate, getAllHolidays } from '../services/database/queries/holiday-queries.js';
import { getCostPresets, getCostPresetCurrencies } from '../services/database/queries/cost-preset-queries.js';
import { getAllOptions, getOption, getOptionsByPattern } from '../services/database/queries/options-queries.js';
import { getAlertsByPersonId, getAlertTypes } from '../services/database/queries/alert-queries.js';
import { getAuthRow } from '../services/database/queries/patient-portal-auth-queries.js';
import { getAllVideos, getVideoById, getVideoCategories } from '../services/database/queries/video-queries.js';
import { getPayments, getActiveWorkForInvoice, getCurrentExchangeRate, listExchangeRates, getPaymentHistoryByWorkId } from '../services/database/queries/payment-queries.js';
import { getAllExpenses, getExpenseCategories, getExpenseSubcategories, getExpenseSummary, getExpenseTotalsByCurrency } from '../services/database/queries/expense-queries.js';
import { getDocumentTypes, getDocumentTemplates } from '../services/database/queries/template-queries.js';
import { getWorksByPatient, getWorkTypes, getToothNumbers, getActiveWork, getWorkRelatedCounts } from '../services/database/queries/work-queries.js';
import { getInfos, getPatientsPhones, getReferralSources, getPatientTypes, getAddresses, getGenders, getPatientById, getPatientNoWorkReceiptData, hasNextAppointment } from '../services/database/queries/patient-queries.js';
import { getWires, getLatestWiresByWorkId, getVisitsByWorkId, getVisitById } from '../services/database/queries/visit-queries.js';
import { getAppointmentForNotification } from '../services/database/queries/appointment-queries.js';
import { getPatientForPhotoSession, getExistingPhotoDate } from '../services/database/queries/photo-session-queries.js';
import { getStandCategories, getStandItems, getLowStockItems, getExpiringItems, getStandDashboardKPIs, getStandSalesSummary, getTopSellingItems } from '../services/database/queries/stand-queries.js';
import { getAllDoctors, getDoctorsWithUnreadCounts, getAllAlignerSets, getAlignerSetsByWorkId, getAlignerSetById, getAllAlignerPatients, searchAlignerPatients, getBatchesBySetId, getNotesBySetId, getUnreadActivitiesBySetId, getAlignerSetBalance, getSetsWithArchformIds } from '../services/database/queries/aligner-queries.js';
import { getKysely } from '../services/database/kysely.js';

let failures = 0;
async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? `${r.length} row(s)` : r === null || r === undefined ? 'null' : 'ok';
    console.log(`  ✅ ${name} → ${n}`);
  } catch (err) {
    failures++;
    console.error(`  ❌ ${name} → ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log('Phase-4 Kysely module smoke (executes against live PG schema):\n');

  // batch 1 (already verified earlier)
  await run('timepoint.getTimePoints', () => getTimePoints('1'));
  await run('timepoint.getTimePointImgs', () => getTimePointImgs('1', '0'));
  await run('privatePhotos.listPrivateForPatient', () => listPrivateForPatient(1));
  await run('privatePhotos.listPrivateForTimepoint', () => listPrivateForTimepoint(1, '0'));
  await run('holiday.isDateHoliday', () => isDateHoliday('2026-01-01'));
  await run('holiday.getHolidaysInRange', () => getHolidaysInRange('2026-01-01', '2026-12-31'));
  await run('holiday.getAppointmentsOnDate', () => getAppointmentsOnDate('2026-01-01'));
  await run('holiday.getAllHolidays', () => getAllHolidays());
  await run('costPreset.getCostPresets', () => getCostPresets());
  await run('costPreset.getCostPresetCurrencies', () => getCostPresetCurrencies());
  await run('options.getAllOptions', () => getAllOptions());
  await run('options.getOption', () => getOption('VideosPath'));
  await run('options.getOptionsByPattern', () => getOptionsByPattern('%'));

  // pure modules (agents)
  await run('alert.getAlertsByPersonId', () => getAlertsByPersonId(1));
  await run('alert.getAlertTypes', () => getAlertTypes());
  await run('portalAuth.getAuthRow', () => getAuthRow(1));
  await run('video.getAllVideos [inlined V_Videos]', () => getAllVideos());
  await run('video.getVideoById [inlined V_Videos]', () => getVideoById(1));
  await run('video.getVideoCategories', () => getVideoCategories());
  await run('payment.getPayments', () => getPayments(1));
  await run('payment.getActiveWorkForInvoice', () => getActiveWorkForInvoice(1));
  await run('payment.getCurrentExchangeRate', () => getCurrentExchangeRate());
  await run('payment.listExchangeRates', () => listExchangeRates('2026-01-01', '2026-12-31'));
  await run('payment.getPaymentHistoryByWorkId', () => getPaymentHistoryByWorkId(1));
  await run('expense.getAllExpenses', () => getAllExpenses({}));
  await run('expense.getExpenseCategories', () => getExpenseCategories());
  await run('expense.getExpenseSubcategories', () => getExpenseSubcategories());
  await run('expense.getExpenseSummary', () => getExpenseSummary('2026-01-01', '2026-12-31'));
  await run('expense.getExpenseTotalsByCurrency', () => getExpenseTotalsByCurrency('2026-01-01', '2026-12-31'));
  await run('template.getDocumentTypes', () => getDocumentTypes());
  await run('template.getDocumentTemplates', () => getDocumentTemplates());
  await run('work.getWorksByPatient', () => getWorksByPatient(1));
  await run('work.getWorkTypes', () => getWorkTypes());
  await run('work.getToothNumbers', () => getToothNumbers());
  await run('work.getActiveWork', () => getActiveWork(1));
  await run('work.getWorkRelatedCounts', () => getWorkRelatedCounts(1));

  // bypassers + proc-mixed direct-SQL
  await run('patient.getInfos [big join]', () => getInfos(1));
  await run('patient.getPatientsPhones', () => getPatientsPhones());
  await run('patient.getReferralSources', () => getReferralSources());
  await run('patient.getPatientTypes', () => getPatientTypes());
  await run('patient.getAddresses', () => getAddresses());
  await run('patient.getGenders', () => getGenders());
  await run('patient.getPatientById', () => getPatientById(1));
  await run('patient.getPatientNoWorkReceiptData [inlined V_rptNoWork]', () => getPatientNoWorkReceiptData(1));
  await run('patient.hasNextAppointment [inlined V_rptNoWork]', () => hasNextAppointment(1));
  await run('visit.getWires', () => getWires());
  await run('visit.getLatestWiresByWorkId [inlined qryLast*wire]', () => getLatestWiresByWorkId(1));
  await run('visit.getVisitsByWorkId', () => getVisitsByWorkId(1));
  await run('visit.getVisitById', () => getVisitById(1));
  await run('appointment.getAppointmentForNotification', () => getAppointmentForNotification(1));
  await run('photoSession.getPatientForPhotoSession', () => getPatientForPhotoSession('1'));
  await run('photoSession.getExistingPhotoDate', () => getExistingPhotoDate('1'));
  await run('stand.getStandCategories', () => getStandCategories());
  await run('stand.getStandItems', () => getStandItems({}));
  await run('stand.getLowStockItems', () => getLowStockItems());
  await run('stand.getExpiringItems', () => getExpiringItems(30));
  await run('stand.getStandDashboardKPIs', () => getStandDashboardKPIs());
  await run('stand.getStandSalesSummary', () => getStandSalesSummary('2026-01-01', '2026-12-31'));
  await run('stand.getTopSellingItems', () => getTopSellingItems('2026-01-01', '2026-12-31', 5));

  // aligner (direct-SQL reads; proc-backed batch ops are Phase 5 and skipped here)
  await run('aligner.getAllDoctors', () => getAllDoctors());
  await run('aligner.getDoctorsWithUnreadCounts', () => getDoctorsWithUnreadCounts());
  await run('aligner.getAllAlignerSets [inlined v_allsets]', () => getAllAlignerSets());
  await run('aligner.getAlignerSetsByWorkId [inlined vw_AlignerSetPayments]', () => getAlignerSetsByWorkId(1));
  await run('aligner.getAlignerSetById', () => getAlignerSetById(1));
  await run('aligner.getAllAlignerPatients', () => getAllAlignerPatients());
  await run('aligner.searchAlignerPatients', () => searchAlignerPatients('a'));
  await run('aligner.getBatchesBySetId', () => getBatchesBySetId(1));
  await run('aligner.getNotesBySetId', () => getNotesBySetId(1));
  await run('aligner.getUnreadActivitiesBySetId', () => getUnreadActivitiesBySetId(1));
  await run('aligner.getAlignerSetBalance [inlined vw_AlignerSetPayments]', () => getAlignerSetBalance(1));
  await run('aligner.getSetsWithArchformIds', () => getSetsWithArchformIds());

  await getKysely().destroy();
  console.log(`\n${failures === 0 ? '✅ All Phase-4 module queries executed cleanly.' : `❌ ${failures} failure(s).`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
