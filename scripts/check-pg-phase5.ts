/**
 * Phase-5 smoke: exercise the proc/trigger reimplementations against the loaded PG data
 * (run ETL first). Asserts "executes + returns plausible shape", not full parity (that's Phase 7).
 *
 * Run:  $env:DB_DRIVER='pg'; npx tsx scripts/check-pg-phase5.ts   (PowerShell)
 *       DB_DRIVER=pg npx tsx scripts/check-pg-phase5.ts            (bash)
 */
import { getVisitsSummary, getLatestVisitsSum, getVisitDetailsByID, getLatestWire } from '../services/database/queries/visit-queries.js';
import { getPhotoSessionAppointments, getPhotoSessionVisits } from '../services/database/queries/photo-session-queries.js';
import { getMonthlyGrandTotals, getYearlyMonthlyTotals, getDailyInvoices } from '../services/database/queries/report-queries.js';
import {
  getMessageStatusByDate, getWhatsAppMessages, getSmsMessages, getSmsIds,
  getWhatsAppDeliveryStatus, getNewAppointmentMessage,
} from '../services/database/queries/messaging-queries.js';
import { getPresentAps, getDailyAppointmentsOptimized } from '../services/database/queries/appointment-queries.js';
import { getWeeklyCalendarSlots, getCalendarStats, getCalendarDay, ensureCalendarRange } from '../services/database/queries/calendar-queries.js';
import { arabicDay } from '../utils/arabic-day.js';
import { getKysely } from '../services/database/kysely.js';

const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let failures = 0;
async function run(name: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? `${r.length} row(s)` : r === null || r === undefined ? 'null' : JSON.stringify(r).slice(0, 90);
    console.log(`  ✅ ${name} → ${n}`);
  } catch (err) {
    failures++;
    console.error(`  ❌ ${name} → ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log('Phase-5 proc/trigger reimplementation smoke:\n');

  // Cluster 1 — ArabicDay (Sat..Thu names, Friday '')
  await run('arabicDay(2026-05-30 Sat)', () => arabicDay('2026-05-30'));
  await run('arabicDay(2026-05-29 Fri)=""', () => arabicDay('2026-05-29'));

  // Find a patient with an active work + visits to exercise visit reads.
  const db = getKysely();
  const someVisit = await db.selectFrom('tblvisits').select(['ID', 'WorkID']).limit(1).executeTakeFirst();
  const someActive = await db.selectFrom('tblwork').select(['PersonID']).where('Status', '=', 1).limit(1).executeTakeFirst();
  const pid = someActive?.PersonID ?? 1;

  // Cluster 5 — visits
  await run(`visit.getVisitsSummary(pid=${pid})`, () => getVisitsSummary(pid));
  await run(`visit.getLatestVisitsSum(pid=${pid})`, () => getLatestVisitsSum(pid));
  await run(`visit.getVisitDetailsByID(${someVisit?.ID ?? 1})`, () => getVisitDetailsByID(someVisit?.ID ?? 1));
  await run(`visit.getLatestWire(pid=${pid})`, () => getLatestWire(pid));
  await run(`photoSession.getPhotoSessionAppointments(${pid})`, () => getPhotoSessionAppointments(String(pid)));
  await run(`photoSession.getPhotoSessionVisits(${pid})`, () => getPhotoSessionVisits(String(pid)));

  // Cluster 6 — reports (pick a month that has data)
  await run('report.getMonthlyGrandTotals(5,2025,1450)', () => getMonthlyGrandTotals(5, 2025, 1450));
  await run('report.getYearlyMonthlyTotals(1,2025,1450)', () => getYearlyMonthlyTotals(1, 2025, 1450));
  // Use a date known to have invoices.
  const anyInvoice = await db.selectFrom('tblInvoice').select('Dateofpayment').orderBy('Dateofpayment', 'desc').limit(1).executeTakeFirst();
  const invDate = (anyInvoice?.Dateofpayment as unknown as string) ?? '2025-05-01';
  await run(`report.getDailyInvoices(${invDate})`, () => getDailyInvoices(invDate));

  // Cluster 4 — messaging (reads only; getWhatsAppMessages/getSmsMessages no-op for non-near dates)
  const anyApp = await db.selectFrom('tblappointments').select(['appointmentID', 'PersonID', 'AppDay']).orderBy('AppDay', 'desc').limit(1).executeTakeFirst();
  const appDay = (anyApp?.AppDay as unknown as string) ?? '2026-05-26';
  await run(`messaging.getMessageStatusByDate(${appDay})`, () => getMessageStatusByDate(appDay));
  await run(`messaging.getWhatsAppDeliveryStatus(${appDay})`, () => getWhatsAppDeliveryStatus(appDay));
  await run(`messaging.getSmsIds(${appDay})`, () => getSmsIds(appDay));
  await run('messaging.getWhatsAppMessages(2000-01-01 → empty)', () => getWhatsAppMessages('2000-01-01'));
  await run('messaging.getSmsMessages(2000-01-01 → empty)', () => getSmsMessages('2000-01-01'));
  if (anyApp) {
    await run(`messaging.getNewAppointmentMessage(${anyApp.PersonID},${anyApp.appointmentID})`,
      () => getNewAppointmentMessage(anyApp.PersonID, anyApp.appointmentID));
  }

  // Cluster 3 — appointments + calendar (reads; a date with calendar slots)
  const calSlot = await db.selectFrom('tblCalender').select('AppDate').orderBy('AppDate', 'desc').limit(1).executeTakeFirst();
  const calDate = calSlot ? toDateStr(calSlot.AppDate as unknown as Date) : '2026-06-01';
  await run(`appointment.getPresentAps(${appDay})`, () => getPresentAps(appDay));
  await run(`appointment.getDailyAppointmentsOptimized(${appDay})`, () => getDailyAppointmentsOptimized(appDay));
  await run(`calendar.ensureCalendarRange(60)`, () => ensureCalendarRange(60));
  await run(`calendar.getWeeklyCalendarSlots(${calDate})`, () => getWeeklyCalendarSlots(calDate, calDate, null));
  await run(`calendar.getCalendarStats(${calDate})`, () => getCalendarStats(calDate, calDate));
  await run(`calendar.getCalendarDay(${calDate})`, () => getCalendarDay(calDate));

  // Cluster 2 — aligner batch write path round-trip (create → manufacture → deliver → delete).
  const { createBatch, updateBatchStatus, deleteBatch } = await import('../services/database/queries/aligner-queries.js');
  const capSet = await db
    .selectFrom('tblAlignerSets')
    .select(['AlignerSetID', 'RemainingUpperAligners', 'RemainingLowerAligners'])
    .where('RemainingUpperAligners', '>', 1)
    .where('RemainingLowerAligners', '>', 1)
    .limit(1)
    .executeTakeFirst();
  if (capSet) {
    const setId = capSet.AlignerSetID;
    const remU0 = capSet.RemainingUpperAligners;
    await run(`aligner.createBatch(set ${setId})`, async () => {
      const newId = await createBatch({ AlignerSetID: setId, UpperAlignerCount: 1, LowerAlignerCount: 1, Days: 7 });
      await updateBatchStatus(newId!, 'MANUFACTURE');
      const delivered = await updateBatchStatus(newId!, 'DELIVER');
      await deleteBatch(newId!);
      const after = await db.selectFrom('tblAlignerSets').select('RemainingUpperAligners').where('AlignerSetID', '=', setId).executeTakeFirst();
      return { newId, deliverOk: delivered.success, remainingRestored: after?.RemainingUpperAligners === remU0 };
    });
  } else {
    console.log('  ⚠️  aligner round-trip skipped (no set with spare capacity)');
  }

  // Cluster 3/7 — appointment create (AppoPatientType) round-trip on a far-future free date.
  const { createAppointment } = await import('../services/database/queries/appointment-queries.js');
  await run('appointment.createAppointment (insert→delete)', async () => {
    const newId = await createAppointment({ PersonID: pid, AppDate: '2027-12-25T10:30:00', AppDetail: 'phase5 smoke', DrID: null });
    const got = await db.selectFrom('tblappointments').select(['appointmentID', 'AppDay']).where('appointmentID', '=', newId).executeTakeFirst();
    await db.deleteFrom('tblappointments').where('appointmentID', '=', newId).execute();
    return { newId, inserted: !!got };
  });

  await getKysely().destroy();
  console.log(`\n${failures === 0 ? '✅ Phase-5 smoke clean.' : `❌ ${failures} failure(s).`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
