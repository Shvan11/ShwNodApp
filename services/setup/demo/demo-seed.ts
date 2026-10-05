/**
 * `npm run db:seed:demo` — fill an EMPTY install with a believable demo clinic (demo-cast.ts).
 *
 * THROUGH THE APP, NOT AROUND IT. Every clinical row is written by the same function the matching
 * screen calls: patients by createPatientWithIntake (which derives the patient type), works by
 * validateAndCreateWork / finishWork / discontinueWork, visits by addVisitByWorkId (whose photo
 * flags roll up into the work's photo and debond dates), payments by validateAndCreateInvoice /
 * validateAndCreatePayment (balance guards included), appointments by validateAndCreateAppointment
 * (holiday, doctor and same-day checks) + updatePresent, aligner sets and batches by their
 * services, photos through the photo editor's own render path (demo-photos.ts). A seed is therefore
 * also a smoke test of those write paths on a fresh schema. Direct writes are limited to lookup
 * rows and to BACKDATING (the services stamp "now"; a demo needs history).
 *
 * The one deliberate bypass: the aligner doctor is created with the query, not the service,
 * because the service schedules a Cloudflare Zero-Trust doctor-list sync — a demo must never
 * touch a real center's portal access list.
 *
 * GUARDED (demo-plan.ts#demoRefusals): an empty database, an empty photo volume, sync capture
 * off, an admin present, and no earlier seed. Everything created is recorded in a manifest
 * (options.DEMO_SEED_MANIFEST) that `npm run db:seed:demo -- remove` (demo-remove.ts) undoes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { getKysely } from '../../database/kysely.js';
import { clinicRoot, workingDir } from '../../files/clinic-paths.js';
import { createPatientWithIntake } from '../../business/PatientService.js';
import { validateAndCreateWork } from '../../business/WorkService.js';
import { validateAndCreateInvoice } from '../../business/PaymentService.js';
import { validateAndCreateAppointment } from '../../business/AppointmentService.js';
import { validateAndCreateSet } from '../../business/AlignerSetService.js';
import { markBatchDelivered, markBatchManufactured, validateAndCreateBatch } from '../../business/AlignerBatchService.js';
import { validateAndCreateNote } from '../../business/AlignerNoteService.js';
import { validateAndCreatePayment } from '../../business/AlignerPaymentService.js';
import { createDoctor as createAlignerDoctor } from '../../database/queries/aligner-doctor-queries.js';
import { finishWork, discontinueWork } from '../../database/queries/work-queries.js';
import { addVisitByWorkId } from '../../database/queries/visit-queries.js';
import { updatePresent } from '../../database/queries/appointment-queries.js';
import { addWorkDetail } from '../../database/queries/work-item-queries.js';
import { upsertDiagnosis } from '../../database/queries/diagnosis-queries.js';
import { createAlert } from '../../database/queries/alert-queries.js';
import { addExpense } from '../../database/queries/expense-queries.js';
import { createEmployee } from '../../database/queries/employee-queries.js';
import { getConfiguredTimeSlots } from '../../database/queries/calendar-queries.js';
import { updateExchangeRateForDate } from '../../database/queries/payment-queries.js';
import { getOption, upsertOption } from '../../database/queries/options-queries.js';
import { ROLES } from '../../../shared/auth/roles.js';
import { WORK_TYPE_IDS } from '../../../shared/treatment-taxonomy.js';
import {
  DEFAULT_CLINIC_MESSAGE_NAME,
  DEFAULT_CLINIC_MESSAGE_NAME_AR,
} from '../../settings/clinic-identity-defaults.js';
import { CLINIC_MESSAGE_NAME_AR_OPTION, CLINIC_MESSAGE_NAME_OPTION } from '../../settings/clinic-identity.js';
import { GROUP_NAME_OPTION } from '../../messaging/group-settings.js';
import {
  CLINIC_NAME_OPTION,
  DEFAULT_WORK_CURRENCY_OPTION,
  applyClinicIdentity,
  applyDefaultCurrency,
  applyStarterVocabularies,
  generateCalendar,
  readIdentity,
} from '../install-setup.js';
import { STARTER_TIME_SLOTS } from '../starter-vocabulary.js';
import {
  DEMO_ALIGNER_DOCTOR,
  DEMO_CITIES,
  DEMO_CLINIC,
  DEMO_DOCTORS,
  DEMO_EXPENSES,
  DEMO_HOLIDAY,
  DEMO_LAB,
  DEMO_PATIENTS,
  DEMO_REFERRALS,
  DEMO_RNG_SEED,
  DEMO_STAFF,
  DEMO_TAG,
  WIRE_SEQUENCE,
  type Currency,
  type DemoBooking,
  type DemoPatient,
  type DoctorKey,
  type OrthoStory,
  type TreatmentStory,
} from './demo-cast.js';
import {
  addDays,
  addMonths,
  arrivalFor,
  demoEmail,
  demoPhone,
  demoRefusals,
  installments,
  isPatientVolumeEntry,
  makeRng,
  nthWorkingDayAfter,
  paidAmount,
  toMinutes,
  visitDates,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  ymd,
} from './demo-plan.js';
import { DEMO_PHOTO_TIMEPOINTS, demoPhotoRoot, placeDemoTimepoint } from './demo-photos.js';

export const DEMO_MANIFEST_OPTION = 'DEMO_SEED_MANIFEST';

/** What a seed created — everything `remove` needs, nothing more. */
export type DemoManifest = {
  version: 1;
  seededAt: string;
  complete: boolean;
  patients: number[];
  employees: number[];
  alignerDoctors: number[];
  expenses: number[];
  holidays: number[];
  labs: number[];
  cities: number[];
  addresses: number[];
  referrals: number[];
  tags: number[];
  exchangeRateDates: string[];
  /** Option rows the seed set to demo values (remove clears them if still unchanged). */
  identity: Record<string, string>;
};

type Report = (line: string) => void;

export async function readManifest(): Promise<DemoManifest | null> {
  const raw = await getOption(DEMO_MANIFEST_OPTION);
  if (!raw) return null;
  return JSON.parse(raw) as DemoManifest;
}

async function saveManifest(m: DemoManifest): Promise<void> {
  await upsertOption(DEMO_MANIFEST_OPTION, JSON.stringify(m));
}

// ── Preconditions ─────────────────────────────────────────────────────────────

/** Names under the clinic volume that already belong to patients (see demoRefusals). */
async function volumePatientEntries(): Promise<string[]> {
  const found: string[] = [];
  const top = await fs.readdir(clinicRoot(), { withFileTypes: true }).catch(() => []);
  for (const e of top) if (e.isDirectory() && isPatientVolumeEntry(e.name)) found.push(`clinic1/${e.name}/`);
  const working = await fs.readdir(workingDir()).catch(() => [] as string[]);
  for (const name of working) if (/\.i\d+$/i.test(name)) found.push(`working/${name}`);
  return found;
}

export async function demoPreconditionFailures(): Promise<string[]> {
  const db = getKysely();
  const { rows } = await sql<{ patients: number; admins: number }>`
    SELECT (SELECT count(*)::int FROM patients) AS patients,
           (SELECT count(*)::int FROM users WHERE role = ${ROLES.ADMIN} AND is_active IS NOT FALSE) AS admins
  `.execute(db);
  const sinks = await db.selectFrom('cdc_sink_control').select('sink').where('enabled', '=', true).execute();
  return demoRefusals({
    patientCount: rows[0].patients,
    adminCount: rows[0].admins,
    enabledSinks: sinks.map((s) => s.sink),
    volumePatientEntries: await volumePatientEntries(),
    hasManifest: (await getOption(DEMO_MANIFEST_OPTION)) != null,
  });
}

// ── The seed ──────────────────────────────────────────────────────────────────

export async function seedDemo(report: Report, now: Date = new Date()): Promise<DemoManifest> {
  const refusals = await demoPreconditionFailures();
  if (refusals.length > 0) throw new Error(`Not seeding:\n  - ${refusals.join('\n  - ')}`);

  const db = getKysely();
  const rng = makeRng(DEMO_RNG_SEED);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const m: DemoManifest = {
    version: 1, seededAt: now.toISOString(), complete: false, patients: [], employees: [], alignerDoctors: [],
    expenses: [], holidays: [], labs: [], cities: [], addresses: [], referrals: [], tags: [],
    exchangeRateDates: [], identity: {},
  };
  await saveManifest(m); // from here on, a failure leaves a manifest `remove` can clean up after

  // 1. Vocabulary, calendar, identity — the parts of `db:setup` a demo needs, applied the same way.
  for (const s of await applyStarterVocabularies()) if (s.outcome === 'applied') report(`  ✓ ${s.step}: ${s.detail}`);
  await generateCalendar();
  await applyDemoIdentity(m, report);
  if (!(await db.selectFrom('sms').select('id').where('date', '=', sql<string>`${ymd(today)}`).executeTakeFirst())) {
    await updateExchangeRateForDate(ymd(today), DEMO_CLINIC.exchangeRate);
    m.exchangeRateDates.push(ymd(today));
  }

  // 2. Lookups the demo patients point at.
  const tagId = (await db.insertInto('tag_options').values({ tag: DEMO_TAG }).returning('id').executeTakeFirstOrThrow()).id;
  m.tags.push(tagId);
  const addressIds: number[][] = [];
  for (const c of DEMO_CITIES) {
    const cityId = (await db.insertInto('cities').values({ city: c.city }).returning('id').executeTakeFirstOrThrow()).id;
    m.cities.push(cityId);
    const zoneIds: number[] = [];
    for (const zone of c.zones) {
      const id = (await db.insertInto('addresses').values({ city_id: cityId, zone }).returning('id').executeTakeFirstOrThrow()).id;
      m.addresses.push(id);
      zoneIds.push(id);
    }
    addressIds.push(zoneIds);
  }
  const referralIds: number[] = [];
  for (const r of DEMO_REFERRALS) {
    const id = (await db.insertInto('referrals').values({ referral: r }).returning('id').executeTakeFirstOrThrow()).id;
    m.referrals.push(id);
    referralIds.push(id);
  }
  const labId = (await db.insertInto('labs').values({ lab_name: DEMO_LAB, is_active: true }).returning('id').executeTakeFirstOrThrow()).id;
  m.labs.push(labId);

  const holidays = new Set((await db.selectFrom('holidays').select('holiday_date').execute()).map((h) => h.holiday_date));
  const holidayDate = nthWorkingDayAfter(today, DEMO_HOLIDAY.inWorkingDays, holidays);
  const holidayId = (
    await db
      .insertInto('holidays')
      .values({ holiday_date: sql<string>`${ymd(holidayDate)}`, holiday_name: DEMO_HOLIDAY.name, description: 'Demo data' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  m.holidays.push(holidayId);
  holidays.add(ymd(holidayDate));
  await saveManifest(m);
  report(`  ✓ Lookups: tag "${DEMO_TAG}", ${m.cities.length} cities, ${m.referrals.length} referral sources, 1 lab, 1 holiday`);

  // 3. Staff.
  const positions = new Map(
    (await db.selectFrom('positions').select(['id', 'position_name']).execute()).map((p) => [p.position_name ?? '', p.id])
  );
  const doctorIds = {} as Record<DoctorKey, number>;
  for (const [i, d] of DEMO_DOCTORS.entries()) {
    doctorIds[d.key] = await createEmployee({
      employee_name: d.name, position: positionId(positions, 'Doctor'), email: null, phone: null,
      percentage: d.commission != null, commission_percentage: d.commission, receive_email: false,
      get_appointments: true, is_active: true, sort_order: i + 1, appointment_color: d.color,
    });
    m.employees.push(doctorIds[d.key]);
  }
  const staffIds: Record<string, number> = {};
  for (const [i, s] of DEMO_STAFF.entries()) {
    staffIds[s.key] = await createEmployee({
      employee_name: s.name, position: positionId(positions, s.position), email: null, phone: null,
      percentage: false, commission_percentage: null, receive_email: false, get_appointments: false,
      is_active: true, sort_order: DEMO_DOCTORS.length + i + 1, appointment_color: null,
    });
    m.employees.push(staffIds[s.key]);
  }
  const alignerDrId = await createAlignerDoctor({ doctor_name: DEMO_ALIGNER_DOCTOR });
  m.alignerDoctors.push(alignerDrId);
  await saveManifest(m);
  report(`  ✓ Staff: ${DEMO_DOCTORS.length} doctors, ${DEMO_STAFF.length} staff, 1 aligner doctor`);

  // 4. Patients and their stories.
  const slots = (await getConfiguredTimeSlots()).length > 0 ? await getConfiguredTimeSlots() : [...STARTER_TIME_SLOTS];
  const wires = new Map((await db.selectFrom('wires').select(['wire_id', 'wire']).execute()).map((w) => [w.wire, w.wire_id]));
  const teeth = new Map((await db.selectFrom('tooth_numbers').select(['id', 'tooth_code']).execute()).map((t) => [t.tooth_code, t.id]));
  const alertTypes = new Map(
    (await db.selectFrom('alert_types').select(['alert_type_id', 'type_name']).execute()).map((a) => [a.type_name, a.alert_type_id])
  );
  const ctx: StoryContext = {
    today, nowMin, rng, holidays, slots, wires, teeth, doctorIds, operatorId: staffIds.assistant, labId, alignerDrId, report,
  };

  for (const [seq, p] of DEMO_PATIENTS.entries()) {
    const personId = await createDemoPatient(p, seq + 1, ctx, addressIds, referralIds);
    m.patients.push(personId);
    await saveManifest(m);
    await db.updateTable('patients').set({ tag_id: tagId }).where('person_id', '=', personId).execute();

    const started = await playStory(p, personId, ctx);
    await db
      .updateTable('patients')
      .set({ date_added: started })
      .where('person_id', '=', personId)
      .execute();

    if (p.alert) {
      await createAlert({
        person_id: personId, alert_type_id: alertTypes.get(p.alert.type) ?? null,
        alert_severity: p.alert.severity, alert_details: p.alert.text,
      });
    }
    if (p.next) await book(personId, p.next, ctx, true);
  }
  report(`  ✓ Patients: ${m.patients.length}, with works, visits, payments, appointments and one photographed case`);

  // 5. Running costs.
  const categories = new Map(
    (await db.selectFrom('expense_categories').select(['category_id', 'category_name']).execute()).map((c) => [c.category_name, c.category_id])
  );
  for (const e of DEMO_EXPENSES) {
    const categoryId = categories.get(e.category);
    if (categoryId == null) {
      report(`  · skipped an expense: no "${e.category}" category`);
      continue;
    }
    const { NewID } = await addExpense({
      expense_date: ymd(workingDayOnOrBefore(addDays(today, -e.daysAgo), holidays)),
      amount: e.amount, currency: e.currency, note: e.note, categoryId,
      employeeId: e.staff ? staffIds[e.staff] : undefined,
      labId: e.lab ? labId : undefined,
      isMonthly: e.monthly ?? false,
    });
    m.expenses.push(NewID);
  }
  report(`  ✓ Expenses: ${m.expenses.length}`);

  m.complete = true;
  await saveManifest(m);
  return m;
}

function positionId(positions: Map<string, number>, name: string): number {
  const id = positions.get(name);
  if (id == null) throw new Error(`No "${name}" position — run "npm run db:setup" first.`);
  return id;
}

/** Give the demo its own identity where the install still has none (or the original clinic's). */
async function applyDemoIdentity(m: DemoManifest, report: Report): Promise<void> {
  const current = await readIdentity();
  const unset = (option: string, original?: string) => !current[option] || current[option] === original;
  const identity = {
    clinicName: unset(CLINIC_NAME_OPTION) ? DEMO_CLINIC.clinicName : undefined,
    messageName: unset(CLINIC_MESSAGE_NAME_OPTION, DEFAULT_CLINIC_MESSAGE_NAME) ? DEMO_CLINIC.messageName : undefined,
    messageNameAr: unset(CLINIC_MESSAGE_NAME_AR_OPTION, DEFAULT_CLINIC_MESSAGE_NAME_AR) ? DEMO_CLINIC.messageNameAr : undefined,
    whatsappGroup: unset(GROUP_NAME_OPTION, 'Shwan Orthodontics') ? DEMO_CLINIC.whatsappGroup : undefined,
  };
  const optionOf = {
    clinicName: CLINIC_NAME_OPTION,
    messageName: CLINIC_MESSAGE_NAME_OPTION,
    messageNameAr: CLINIC_MESSAGE_NAME_AR_OPTION,
    whatsappGroup: GROUP_NAME_OPTION,
  } as const;
  for (const [k, v] of Object.entries(identity)) if (v) m.identity[optionOf[k as keyof typeof optionOf]] = v;
  const steps = await applyClinicIdentity(identity);
  if (!current[DEFAULT_WORK_CURRENCY_OPTION]) {
    steps.push(await applyDefaultCurrency(DEMO_CLINIC.currency));
    m.identity[DEFAULT_WORK_CURRENCY_OPTION] = DEMO_CLINIC.currency;
  }
  for (const s of steps) report(`  ✓ ${s.step}: ${s.detail}`);
}

// ── Stories ───────────────────────────────────────────────────────────────────

type StoryContext = {
  today: Date;
  nowMin: number;
  rng: () => number;
  holidays: Set<string>;
  slots: string[];
  wires: Map<string, number>;
  teeth: Map<string, number>;
  doctorIds: Record<DoctorKey, number>;
  operatorId: number;
  labId: number;
  alignerDrId: number;
  report: Report;
};

async function createDemoPatient(
  p: DemoPatient,
  seq: number,
  ctx: StoryContext,
  addressIds: number[][],
  referralIds: number[]
): Promise<number> {
  const { phone, countryCode } = demoPhone(seq);
  const dob = addDays(addMonths(ctx.today, -12 * p.age), -Math.floor(ctx.rng() * 300));
  const patientData = {
    patientName: p.nameAr,
    firstName: p.first,
    lastName: p.last,
    phone,
    countryCode,
    email: p.email ? demoEmail(`${p.first}.${p.last}`) : undefined,
    dateOfBirth: ymd(dob),
    gender: p.gender,
    addressID: addressIds[p.address[0]][p.address[1]],
    referralSourceID: referralIds[p.referral],
    notes: p.notes,
    language: p.language,
  };
  const s = p.story;
  if (s.kind === 'intake') {
    const intake = s.intake === 'consult'
      ? { kind: 'consult' as const, fee: s.fee, currency: 'IQD' as const }
      : { kind: 'xray' as const, workTypeId: WORK_TYPE_IDS.OPG, fee: s.fee, currency: 'IQD' as const };
    const { personId, workId } = await createPatientWithIntake(patientData, intake);
    // The intake stamps "today"; move the work and its invoice back to the story's day.
    if (workId) await backdateWork(workId, workingDayOnOrBefore(addDays(ctx.today, -s.daysAgo), ctx.holidays));
    return personId;
  }
  return (await createPatientWithIntake(patientData)).personId;
}

/** Plays a patient's story; returns the day they first came (their registration date). */
async function playStory(p: DemoPatient, personId: number, ctx: StoryContext): Promise<Date> {
  const s = p.story;
  switch (s.kind) {
    case 'new':
    case 'intake':
      return workingDayOnOrBefore(addDays(ctx.today, -s.daysAgo), ctx.holidays);
    case 'ortho':
      return playOrtho(personId, s, ctx);
    case 'treatment':
      return playTreatment(personId, s, ctx);
  }
}

async function playOrtho(personId: number, s: OrthoStory, ctx: StoryContext): Promise<Date> {
  const { today, holidays, rng } = ctx;
  const start = workingDayOnOrBefore(addMonths(today, -s.startMonthsAgo), holidays);
  const endMonths = s.finishedMonthsAgo ?? s.discontinuedMonthsAgo;
  const end = endMonths != null ? addMonths(today, -endMonths) : addDays(today, -7);
  const visits = visitDates(start, end, s.everyDays, holidays, rng);
  const finished = s.finishedMonthsAgo != null;
  const dr = ctx.doctorIds[s.doctor];

  const { work_id: workId } = await validateAndCreateWork(
    { person_id: personId, dr_id: dr, type_of_work: s.workType, total_required: s.total, currency: s.currency, start_date: ymd(start) },
    ROLES.ADMIN
  );
  await backdateWork(workId, start);

  // Photo timepoints on the first, ~⅓, ~⅔ and last visit.
  const photoVisits = s.photos ? [0, Math.round((visits.length - 1) / 3), Math.round((2 * (visits.length - 1)) / 3), visits.length - 1] : [];

  let setId: number | null = null;
  if (s.aligner) {
    setId = await validateAndCreateSet({
      work_id: workId, aligner_dr_id: ctx.alignerDrId, set_sequence: 1, type: 'Moderate', is_active: true,
      upper_aligners_count: s.aligner.upper, lower_aligners_count: s.aligner.lower, days: s.aligner.days,
      set_cost: s.total, currency: s.currency,
    }, { mayPrice: true });
    await getKysely().updateTable('aligner_sets').set({ creation_date: sql<string>`${ymd(start)}` }).where('aligner_set_id', '=', setId).execute();
  }

  for (const [i, date] of visits.entries()) {
    const last = i === visits.length - 1;
    await book(personId, { inWorkingDays: -1, slot: Math.floor(rng() * ctx.slots.length), type: i === 0 ? (s.workType === 19 ? 'First Time' : 'Bonding') : finished && last ? 'Removal' : 'Follow Up', doctor: s.doctor }, ctx, false, date);
    await addVisitByWorkId({
      work_id: workId,
      visit_date: ymd(date),
      operator_id: ctx.operatorId,
      opg: i === 0 && s.workType !== 19,
      i_photo: s.photos === true && i === 0,
      p_photo: s.photos === true && photoVisits.slice(1, -1).includes(i),
      f_photo: s.photos === true && last && finished,
      appliance_removed: finished && last,
      ...orthoVisitContent(s, i, visits.length, finished, ctx),
    });
  }

  if (s.aligner && setId != null) {
    for (const b of s.aligner.batches) {
      const { newBatchId } = await validateAndCreateBatch({
        aligner_set_id: setId, upper_aligner_count: b.upper, lower_aligner_count: b.lower, days: s.aligner.days,
        is_last: b.last ?? false, is_active: false, // delivery activates it (ck_alignerbatches_active_requires_delivery)
      });
      const made = workingDayOnOrBefore(addDays(today, -b.madeDaysAgo), holidays);
      await markBatchManufactured(newBatchId, ymd(made));
      if (b.delivered) await markBatchDelivered(newBatchId, ymd(nthWorkingDayAfter(made, 2, holidays)));
    }
    for (const note of s.aligner.labNotes) await validateAndCreateNote(setId, note);
  }

  // A down payment at the first visit, then an installment at the visits after it (how ortho is paid
  // here: a little at each adjustment), spread over the whole treatment. A patient who has fallen
  // behind skips the most recent ones.
  const paid = paidAmount(s.total, s.paidShare, s.currency);
  const allPayDays = visits;
  const payDays = allPayDays.slice(0, Math.max(1, allPayDays.length - (s.missedPayments ?? 0)));
  const amounts = installments(paid, Math.min(payDays.length, 24), s.currency);
  for (const [k, amount] of amounts.entries()) {
    const at = amounts.length === 1 ? 0 : Math.round((k * (payDays.length - 1)) / (amounts.length - 1));
    const date = ymd(payDays[at]);
    if (setId != null) {
      await validateAndCreatePayment({ workid: workId, aligner_set_id: setId, amount_paid: amount, date_of_payment: date });
    } else {
      await pay(workId, amount, s.currency, date);
    }
  }

  if (s.diagnosis) await upsertDiagnosis(showcaseDiagnosis(workId, start));
  if (s.photos) {
    for (const [k, tp] of DEMO_PHOTO_TIMEPOINTS.entries()) {
      await placeDemoTimepoint(personId, tp.name, visits[photoVisits[k]], path.join(demoPhotoRoot(), tp.dir));
    }
  }
  if (finished) await finishWork(workId);
  else if (s.discontinuedMonthsAgo != null) await discontinueWork(workId);
  return start;
}

/** What the doctor wrote at visit `i` of `n` — wires, elastics, notes — by appliance type. */
function orthoVisitContent(s: OrthoStory, i: number, n: number, finished: boolean, ctx: StoryContext) {
  const last = i === n - 1;
  const at = (share: number) => i === Math.round((n - 1) * share);
  if (s.workType === 2) {
    const notes = ['Expander cemented; instructions given', 'Expander activated — 2 turns a week', 'Expansion on track', 'Expansion complete; expander kept as retainer'];
    return { others: notes[Math.min(i, notes.length - 1)] };
  }
  if (s.workType === 19) {
    return i === 0
      ? { others: 'Scans reviewed; attachments bonded; aligners 1–8 delivered', next_visit: 'Aligner check' }
      : { others: at(0.5) ? 'IPR 0.3 mm UR2/UR3' : 'Aligner check — tracking well', next_visit: 'Continue aligners' };
  }
  const [upper, lower] = WIRE_SEQUENCE[Math.min(i, WIRE_SEQUENCE.length - 1)];
  const content: {
    upper_wire_id?: number; lower_wire_id?: number; others?: string; next_visit?: string;
    elastics?: string; bracket_change?: string; wire_bending?: string;
  } = {
    upper_wire_id: ctx.wires.get(upper),
    lower_wire_id: lower ? ctx.wires.get(lower) : undefined,
  };
  if (i === 0) Object.assign(content, { others: 'Upper arch bonded (MBT 0.022)', next_visit: 'Bond lower arch' });
  else if (i === 1) content.others = 'Lower arch bonded';
  if (n > 6 && i >= Math.round(n * 0.4) && i <= Math.round(n * 0.75)) content.elastics = 'Class II 3/16" medium, full time';
  if (n > 6 && at(0.55)) content.bracket_change = 'UL2 rebonded';
  if (n > 6 && at(0.85)) content.wire_bending = 'Detailing bends UR2, UL2';
  if (finished && last) Object.assign(content, { others: 'Debonded — upper and lower retainers delivered', upper_wire_id: undefined, lower_wire_id: undefined, elastics: undefined });
  return content;
}

async function playTreatment(personId: number, s: TreatmentStory, ctx: StoryContext): Promise<Date> {
  const { today, holidays } = ctx;
  const start = workingDayOnOrBefore(addDays(today, -s.startDaysAgo), holidays);
  const end = s.finishedDaysAgo != null ? workingDayOnOrBefore(addDays(today, -s.finishedDaysAgo), holidays) : workingDayOnOrBefore(addDays(today, -1), holidays);
  const { work_id: workId } = await validateAndCreateWork(
    { person_id: personId, dr_id: ctx.doctorIds[s.doctor], type_of_work: s.workType, total_required: s.total, currency: s.currency, start_date: ymd(start) },
    ROLES.ADMIN
  );
  await backdateWork(workId, start);

  for (const item of s.items) {
    await addWorkDetail({
      work_id: workId,
      material: item.material ?? null,
      shade_system: item.shadeSystem ?? null,
      shade: item.shade ?? null,
      lab_id: item.lab ? ctx.labId : null,
      canals_no: item.canals ?? null,
      working_length: item.workingLength ?? null,
      implant_length: item.implantLength ?? null,
      implant_diameter: item.implantDiameter ?? null,
      note: item.note ?? null,
      start_date: ymd(start),
      completed_date: s.finishedDaysAgo != null ? ymd(end) : null,
      TeethIds: item.teeth.map((code) => {
        const id = ctx.teeth.get(code);
        if (id == null) throw new Error(`Unknown tooth code ${code}`);
        return id;
      }),
    });
  }

  // Sessions spread from start to end, each an attended appointment.
  const sessions: Date[] = [];
  for (let k = 0; k < s.sessions; k++) {
    const share = s.sessions === 1 ? 0 : k / (s.sessions - 1);
    const d = workingDayOnOrBefore(addDays(start, Math.round(((end.getTime() - start.getTime()) / 86_400_000) * share)), holidays);
    if (!sessions.some((x) => ymd(x) === ymd(d))) sessions.push(d);
  }
  for (const d of sessions) {
    await book(personId, { inWorkingDays: -1, slot: Math.floor(ctx.rng() * ctx.slots.length), type: s.sessionType, doctor: s.doctor }, ctx, false, d);
  }
  const amounts = installments(paidAmount(s.total, s.paidShare, s.currency), sessions.length, s.currency);
  for (const [k, amount] of amounts.entries()) await pay(workId, amount, s.currency, ymd(sessions[Math.min(k, sessions.length - 1)]));
  if (s.finishedDaysAgo != null) await finishWork(workId);
  return start;
}

// ── Building blocks ───────────────────────────────────────────────────────────

/**
 * Book an appointment. Future ones (`inWorkingDays` ≥ 0) land on the n-th working day; past ones
 * pass `on`. A past visit is fully attended; today's is wherever the clock says (demo-plan#arrivalFor).
 */
async function book(personId: number, b: DemoBooking, ctx: StoryContext, future: boolean, on?: Date): Promise<void> {
  const day = on ?? (b.inWorkingDays === 0 ? workingDayOnOrAfter(ctx.today, ctx.holidays) : nthWorkingDayAfter(ctx.today, b.inWorkingDays, ctx.holidays));
  const time = ctx.slots[Math.min(Math.max(0, b.slot), ctx.slots.length - 1)];
  const { appointment_id: id } = await validateAndCreateAppointment({
    person_id: personId,
    app_date: `${ymd(day)}T${time}:00`,
    app_detail: b.type,
    dr_id: ctx.doctorIds[b.doctor],
  });
  if (id == null) throw new Error(`Booking ${ymd(day)} ${time} for patient ${personId} returned no id`);
  const isToday = ymd(day) === ymd(ctx.today);
  if (future && !isToday) return;
  const arrival = arrivalFor(toMinutes(time), isToday ? ctx.nowMin : Number.POSITIVE_INFINITY);
  if (arrival.present) await updatePresent(id, 'present', arrival.present);
  if (arrival.seated) await updatePresent(id, 'seated', arrival.seated);
  if (arrival.dismissed) await updatePresent(id, 'dismissed', arrival.dismissed);
}

/** One cash payment in the work's own currency (no change due). */
async function pay(workId: number, amount: number, currency: Currency, date: string): Promise<void> {
  await validateAndCreateInvoice({
    workid: workId,
    amountPaid: amount,
    paymentDate: date,
    usdReceived: currency === 'USD' ? amount : 0,
    iqdReceived: currency === 'IQD' ? amount : 0,
    change: 0,
  });
}

/** Move a work (and any invoice the intake wrote with it) back to the day it really started. */
async function backdateWork(workId: number, day: Date): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('works')
    .set({ start_date: sql<string>`${ymd(day)}`, addition_date: day })
    .where('work_id', '=', workId)
    .execute();
  await db
    .updateTable('invoices')
    .set({ date_of_payment: sql<string>`${ymd(day)}` })
    .where('work_id', '=', workId)
    .where('date_of_payment', '>', sql<string>`${ymd(day)}`)
    .execute();
}

function showcaseDiagnosis(workId: number, start: Date) {
  return {
    work_id: workId,
    dx_date: start,
    chief_complain: 'Crooked front teeth; a top tooth sits behind the bottom ones.',
    diagnosis: 'Class II division 1 malocclusion on a mild skeletal Class II base, with moderate upper and mild lower crowding and an anterior crossbite of UL2.',
    treatment_plan: 'Upper and lower fixed appliances (MBT 0.022), non-extraction. Transpalatal and lingual arches for anchorage, Class II elastics, then detailing. Retention: bonded lower 3–3, removable upper Essix.',
    appliance: 'Fixed appliances, MBT 0.022',
    f_antero_posterior: 'Convex profile',
    f_vertical: 'Average',
    f_transverse: 'Symmetric',
    f_lip_competence: 'Competent',
    f_naso_labial_angle: 'Normal',
    f_upper_incisor_show_rest: '3 mm',
    f_upper_incisor_show_smile: '100%',
    i_teeth_present: '7654321 | 1234567 (both arches)',
    i_dental_health: 'Good; no caries',
    i_upper_crowding: 'Moderate (5 mm)',
    i_lower_crowding: 'Mild (3 mm)',
    i_upper_incisor_inclination: 'Retroclined UL2',
    i_lower_incisor_inclination: 'Normal',
    i_curveof_spee: 'Moderate',
    o_incisor_relation: 'Class II div 1',
    o_overjet: '5 mm',
    o_overbite: '50%, complete',
    o_centerlines: 'Upper on the face; lower 1 mm left',
    o_molar_relation: 'Class II ½ unit bilaterally',
    o_canine_relation: 'Class II',
    o_functional_occlusion: 'Anterior crossbite UL2, no shift',
    c_sna: '82',
    c_snb: '77',
    c_anb: '5',
    c_wits: '3',
    c_fma: '26',
    c_uimx: '104',
    c_li_md: '95',
  };
}
