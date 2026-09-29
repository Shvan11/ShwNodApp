/**
 * `npm run db:seed:demo -- remove` — undo a demo seed, so a center that trained on the demo can
 * go live on the same install.
 *
 * Works only from the seed's manifest (options.DEMO_SEED_MANIFEST): it deletes exactly the rows
 * the seed created, never "anything that looks like demo data". Patients go through
 * deletePatientCascade — the same path as deleting a patient on screen — so their works, visits,
 * payments, appointments, aligner sets, alerts, timepoints, photo folder, rendered gallery files
 * and thumbnails all go with them.
 *
 * Shared rows (staff, lookups, the tag) are deleted one by one and KEPT if something real now
 * points at them (an FK violation): a center that booked a real patient with "Dr. Sara Ahmed"
 * after the demo keeps that doctor, and the report says so. Identity/currency options the seed set
 * are cleared only if they still hold the demo value.
 */
import { getKysely } from '../../database/kysely.js';
import { deletePatientCascade } from '../../business/PatientService.js';
import { upsertOption } from '../../database/queries/options-queries.js';
import { isForeignKeyViolation } from '../../../utils/pg-errors.js';
import { readIdentity } from '../install-setup.js';
import { DEMO_CLINIC } from './demo-cast.js';
import { DEMO_MANIFEST_OPTION, readManifest } from './demo-seed.js';

type Report = (line: string) => void;

export async function removeDemo(report: Report): Promise<void> {
  const m = await readManifest();
  if (!m) throw new Error('No demo seed is recorded in this database — nothing to remove.');
  const db = getKysely();

  let folderFailures = 0;
  for (const personId of m.patients) {
    const exists = await db.selectFrom('patients').select('person_id').where('person_id', '=', personId).executeTakeFirst();
    if (!exists) continue;
    const { folderRemoved } = await deletePatientCascade(personId);
    if (!folderRemoved) folderFailures++;
  }
  report(`  ✓ Patients: ${m.patients.length} removed (with their works, visits, payments, appointments and photos)`);
  if (folderFailures > 0) report(`  ! ${folderFailures} photo folder(s) could not be deleted — see the log`);

  if (m.expenses.length > 0) await db.deleteFrom('expenses').where('id', 'in', m.expenses).execute();
  if (m.holidays.length > 0) await db.deleteFrom('holidays').where('id', 'in', m.holidays).execute();
  if (m.exchangeRateDates.length > 0) {
    // Only the rows still holding the demo rate — a rate someone has since corrected is theirs.
    await db
      .deleteFrom('sms')
      .where('date', 'in', m.exchangeRateDates)
      .where('exchange_rate', '=', DEMO_CLINIC.exchangeRate)
      .execute();
  }
  report(`  ✓ Expenses: ${m.expenses.length} · holidays: ${m.holidays.length} removed`);

  // Shared rows: delete each, keep what real data now references.
  const kept: string[] = [];
  const tryDelete = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (err) {
      if (!isForeignKeyViolation(err)) throw err;
      kept.push(label);
    }
  };
  for (const id of m.alignerDoctors) await tryDelete(`aligner doctor #${id}`, () => db.deleteFrom('aligner_doctors').where('dr_id', '=', id).execute());
  for (const id of m.employees) await tryDelete(`employee #${id}`, () => db.deleteFrom('employees').where('id', '=', id).execute());
  for (const id of m.labs) await tryDelete(`lab #${id}`, () => db.deleteFrom('labs').where('id', '=', id).execute());
  for (const id of m.addresses) await tryDelete(`address #${id}`, () => db.deleteFrom('addresses').where('id', '=', id).execute());
  for (const id of m.cities) await tryDelete(`city #${id}`, () => db.deleteFrom('cities').where('id', '=', id).execute());
  for (const id of m.referrals) await tryDelete(`referral #${id}`, () => db.deleteFrom('referrals').where('id', '=', id).execute());
  for (const id of m.tags) await tryDelete(`tag #${id}`, () => db.deleteFrom('tag_options').where('id', '=', id).execute());
  report(`  ✓ Staff and lookups removed${kept.length > 0 ? ` (kept, still in use: ${kept.join(', ')})` : ''}`);

  const current = await readIdentity();
  const cleared: string[] = [];
  for (const [option, value] of Object.entries(m.identity)) {
    if (current[option] === value) {
      await upsertOption(option, '');
      cleared.push(option);
    }
  }
  if (cleared.length > 0) report(`  ✓ Demo identity cleared: ${cleared.join(', ')} — set yours with "npm run db:setup"`);

  await db.deleteFrom('options').where('option_name', '=', DEMO_MANIFEST_OPTION).execute();
}
