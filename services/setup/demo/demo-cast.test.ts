/**
 * @vitest-environment node
 *
 * The demo cast is data, so these check it against the rest of the app: every vocabulary value it
 * names must exist on a fresh install, and the stories must land every patient into the type the
 * classifier would give them — so the demo shows each patient-type badge.
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PATIENT_TYPE_IDS,
  WORK_STATUS,
  WORK_TYPE_IDS,
  classifyPatient,
  type ClassifiableWork,
} from '../../../shared/treatment-taxonomy.js';
import { VIEW_CODES } from '../../../shared/photo-views.js';
import {
  STARTER_APPOINTMENT_TYPES,
  STARTER_EXPENSE_CATEGORIES,
  STARTER_WIRES,
} from '../starter-vocabulary.js';
import {
  DEMO_CITIES,
  DEMO_DOCTORS,
  DEMO_EXPENSES,
  DEMO_PATIENTS,
  DEMO_REFERRALS,
  WIRE_SEQUENCE,
  type DemoPatient,
} from './demo-cast.js';

const PHOTOS = fileURLToPath(new URL('../../../data/demo/photos/', import.meta.url));

/** The works a story creates, as the classifier sees them. */
function worksOf(p: DemoPatient): ClassifiableWork[] {
  const s = p.story;
  switch (s.kind) {
    case 'new':
      return [];
    case 'intake':
      return [{ type_of_work: s.intake === 'consult' ? WORK_TYPE_IDS.CONSULT : WORK_TYPE_IDS.OPG, status: WORK_STATUS.FINISHED }];
    case 'ortho':
      return [{
        type_of_work: s.workType,
        status: s.finishedMonthsAgo != null ? WORK_STATUS.FINISHED : s.discontinuedMonthsAgo != null ? WORK_STATUS.DISCONTINUED : WORK_STATUS.ACTIVE,
      }];
    case 'treatment':
      return [{ type_of_work: s.workType, status: s.finishedDaysAgo != null ? WORK_STATUS.FINISHED : WORK_STATUS.ACTIVE }];
  }
}

describe('demo cast', () => {
  it('patient names are unique (patients.patient_name has a unique index)', () => {
    const names = DEMO_PATIENTS.map((p) => p.nameAr);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(DEMO_PATIENTS.map((p) => p.key)).size).toBe(DEMO_PATIENTS.length);
  });

  it('covers every patient type except Aligner Lab (a portal case)', () => {
    const types = new Set(DEMO_PATIENTS.map((p) => classifyPatient(worksOf(p))));
    for (const [name, id] of Object.entries(PATIENT_TYPE_IDS)) {
      if (id === PATIENT_TYPE_IDS.ALIGNER_LAB) continue;
      expect(types, name).toContain(id);
    }
  });

  it('names only vocabulary a fresh install has (starter lists + migration rows)', () => {
    const apptTypes = new Set(STARTER_APPOINTMENT_TYPES);
    const wires = new Set(STARTER_WIRES);
    const categories = new Set([...STARTER_EXPENSE_CATEGORIES.map((c) => c.name), 'Employees', 'Lab']);
    const doctors = new Set(DEMO_DOCTORS.map((d) => d.key));
    for (const p of DEMO_PATIENTS) {
      if (p.next) {
        expect(apptTypes, `${p.key} booking`).toContain(p.next.type);
        expect(doctors).toContain(p.next.doctor);
      }
      if (p.story.kind === 'treatment') expect(apptTypes, `${p.key} sessions`).toContain(p.story.sessionType);
      if (p.story.kind === 'ortho' || p.story.kind === 'treatment') expect(doctors).toContain(p.story.doctor);
      expect(DEMO_CITIES[p.address[0]]?.zones[p.address[1]], `${p.key} address`).toBeDefined();
      expect(DEMO_REFERRALS[p.referral], `${p.key} referral`).toBeDefined();
    }
    for (const [upper, lower] of WIRE_SEQUENCE) {
      expect(wires).toContain(upper);
      if (lower) expect(wires).toContain(lower);
    }
    for (const e of DEMO_EXPENSES) expect(categories, e.note).toContain(e.category);
  });

  it('books today and the reminder days (1–2 working days ahead), never a past day', () => {
    const days = DEMO_PATIENTS.flatMap((p) => (p.next ? [p.next.inWorkingDays] : []));
    expect(days.every((d) => d >= 0)).toBe(true);
    expect(days.filter((d) => d === 0).length).toBeGreaterThanOrEqual(4);
    expect(days).toContain(1);
    expect(days).toContain(2);
  });

  it('the photo pack has all eight views for each of its four timepoints', () => {
    const dirs = readdirSync(PHOTOS).sort();
    expect(dirs).toEqual(['01-initial', '02-progress', '03-progress', '04-final']);
    for (const d of dirs) for (const v of VIEW_CODES) expect(existsSync(`${PHOTOS}${d}/${v}.jpg`), `${d}/${v}`).toBe(true);
    expect(DEMO_PATIENTS.filter((p) => p.story.kind === 'ortho' && p.story.photos)).toHaveLength(1);
  });
});
