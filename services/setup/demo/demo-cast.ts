/**
 * The demo clinic's cast: staff, patients and each patient's treatment story, as pure data.
 *
 * Everything here is fictional: the names are common Iraqi/Kurdish given names paired at random,
 * phones come from a reserved range that reaches nobody (demo-plan.ts#demoPhone), emails are
 * example.com. Dates are RELATIVE (days/months ago, working days ahead) so a seed always tells the
 * story around "today": appointments today and tomorrow, balances overdue, a case finished last
 * month. The one case with photos (`photos: true`) uses the demo photo pack in data/demo/photos/.
 *
 * Coverage is deliberate — every derived patient type (shared/treatment-taxonomy.ts) appears at
 * least once: Active Ortho (braces, phase 1, aligners), Former Patient (finished, discontinued),
 * New / No Works, Consult (paid + free), X-ray, Active Non-Ortho (crown/bridge, endo, implant).
 *
 * No imports — the CI gate tests this file without a database (demo-cast.test.ts).
 */

export type DoctorKey = 'sara' | 'karwan' | 'lana';
export type StaffKey = 'assistant' | 'reception';
export type Currency = 'IQD' | 'USD';

export const DEMO_CLINIC = {
  clinicName: 'Demo Orthodontic Clinic',
  messageName: 'Demo Orthodontic Clinic',
  messageNameAr: 'عيادة التقويم التجريبية',
  whatsappGroup: 'Demo Orthodontic Clinic',
  currency: 'IQD' as Currency,
  /** USD → IQD rate recorded for today (Statistics converts USD works with the latest rate). */
  exchangeRate: 1450,
};

/** The tag on every demo patient (`tag_options` / `patients.tag_id`) — visible in the UI. */
export const DEMO_TAG = 'Demo';

/** The seed's PRNG seed: same number → the same visits, slots and wires on every install. */
export const DEMO_RNG_SEED = 20260929;

/** Names WITHOUT a "Dr." prefix: the screens add it (WorkCard, the aligner doctor cards). */
export const DEMO_DOCTORS: ReadonlyArray<{ key: DoctorKey; name: string; color: string; commission: number | null }> = [
  { key: 'sara', name: 'Sara Ahmed', color: '#2e86de', commission: 30 },
  { key: 'karwan', name: 'Karwan Omar', color: '#10ac84', commission: null },
  { key: 'lana', name: 'Lana Hassan', color: '#e17055', commission: 25 },
];

export const DEMO_STAFF: ReadonlyArray<{ key: StaffKey; name: string; position: 'Assistant' | 'Receptionist' }> = [
  { key: 'assistant', name: 'Nour Ali', position: 'Assistant' },
  { key: 'reception', name: 'Hana Kareem', position: 'Receptionist' },
];

/** Aligner cases are prescribed by an `aligner_doctors` row (the lab/portal side of the app). */
export const DEMO_ALIGNER_DOCTOR = 'Sara Ahmed';

export const DEMO_CITIES: ReadonlyArray<{ city: string; zones: readonly string[] }> = [
  { city: 'Baghdad', zones: ['Karrada', 'Mansour', 'Zayouna'] },
  { city: 'Erbil', zones: ['Ankawa', 'Italian Village'] },
  { city: 'Basra', zones: ['Al-Ashar'] },
];

export const DEMO_REFERRALS: readonly string[] = ['Instagram', 'Friend or family', 'Another doctor', 'Google Maps'];

export const DEMO_LAB = 'Demo Dental Lab';

/** A day the clinic is closed, this many working days ahead (the calendar shows it; nothing books on it). */
export const DEMO_HOLIDAY = { inWorkingDays: 12, name: 'Demo holiday (clinic closed)' };

/** A booking: `inWorkingDays` 0 = today; `slot` indexes the configured time slots (clamped). */
export type DemoBooking = { inWorkingDays: number; slot: number; type: string; doctor: DoctorKey };

export type OrthoStory = {
  kind: 'ortho';
  workType: 1 | 2 | 19; // Ortho (Braces) · Ortho Phase 1 · Ortho (Aligners)
  doctor: DoctorKey;
  startMonthsAgo: number;
  /** Finished (debond) this many months ago → a Former Patient. */
  finishedMonthsAgo?: number;
  /** Stopped this many months ago → status Discontinued. */
  discontinuedMonthsAgo?: number;
  total: number;
  currency: Currency;
  /** Share of `total` paid so far (1 = settled), spread over the treatment's pay days. */
  paidShare: number;
  /** The most recent pay days skipped — a patient who has fallen behind. */
  missedPayments?: number;
  /** Days between visits (±4 days jitter). */
  everyDays: number;
  /** The demo photo pack: Initial, two Progress and Final timepoints on the matching visits. */
  photos?: boolean;
  /** Fill the Diagnosis page. */
  diagnosis?: boolean;
  aligner?: {
    upper: number;
    lower: number;
    days: number;
    batches: ReadonlyArray<{ upper: number; lower: number; madeDaysAgo: number; delivered: boolean; last?: boolean }>;
    labNotes: readonly string[];
  };
};

export type IntakeStory = { kind: 'intake'; intake: 'consult' | 'xray'; fee: number; daysAgo: number };
export type NewStory = { kind: 'new'; daysAgo: number };

export type TreatmentItem = {
  teeth: readonly string[];
  material?: string;
  shadeSystem?: 'Vita Classic' | '3D Master';
  shade?: string;
  lab?: boolean;
  canals?: number;
  workingLength?: string;
  implantLength?: number;
  implantDiameter?: number;
  note?: string;
};

export type TreatmentStory = {
  kind: 'treatment';
  workType: 3 | 5 | 9 | 15 | 17; // Scaling · Endo · Veneers · Implant · Crown/Bridge
  doctor: DoctorKey;
  startDaysAgo: number;
  finishedDaysAgo?: number;
  total: number;
  currency: Currency;
  paidShare: number;
  /** Attended sessions (appointments) between start and finish/today. */
  sessions: number;
  sessionType: string;
  items: readonly TreatmentItem[];
};

export type DemoPatient = {
  key: string;
  /** `patients.patient_name` — Arabic, as the clinic stores it. */
  nameAr: string;
  first: string;
  last: string;
  gender: 1 | 2;
  age: number;
  /** 0 Arabic · 1 English · 2 Kurdish (shared/patient-language.ts). */
  language: 0 | 1 | 2;
  /** [city index, zone index] into DEMO_CITIES. */
  address: readonly [number, number];
  /** Index into DEMO_REFERRALS. */
  referral: number;
  email?: boolean;
  notes?: string;
  alert?: { type: string; severity: 1 | 2 | 3; text: string };
  story: OrthoStory | IntakeStory | NewStory | TreatmentStory;
  next?: DemoBooking;
};

export const DEMO_PATIENTS: readonly DemoPatient[] = [
  {
    key: 'yousif', nameAr: 'يوسف كريم حسن', first: 'Yousif', last: 'Kareem', gender: 1, age: 16, language: 0,
    address: [0, 0], referral: 0, email: true,
    notes: 'Showcase case: crowding + crossbite, 25 months in fixed appliances. Photos at every stage.',
    story: {
      kind: 'ortho', workType: 1, doctor: 'sara', startMonthsAgo: 26, finishedMonthsAgo: 1,
      total: 1_750_000, currency: 'IQD', paidShare: 1, everyDays: 35, photos: true, diagnosis: true,
    },
    next: { inWorkingDays: 15, slot: 5, type: 'Follow Up', doctor: 'sara' },
  },
  {
    key: 'zahraa', nameAr: 'زهراء محمود علي', first: 'Zahraa', last: 'Mahmood', gender: 2, age: 14, language: 0,
    address: [0, 1], referral: 1, email: true,
    alert: { type: 'Financial', severity: 2, text: 'Two installments overdue — discuss at the next visit.' },
    story: {
      kind: 'ortho', workType: 1, doctor: 'sara', startMonthsAgo: 11, total: 1_750_000, currency: 'IQD',
      paidShare: 0.45, missedPayments: 2, everyDays: 35, diagnosis: true,
    },
    next: { inWorkingDays: 1, slot: 4, type: 'Follow Up', doctor: 'sara' },
  },
  {
    key: 'ahmed', nameAr: 'أحمد سالم جاسم', first: 'Ahmed', last: 'Salim', gender: 1, age: 17, language: 0,
    address: [0, 2], referral: 0,
    alert: { type: 'Appliance', severity: 2, text: 'Loose bracket on UR3 — rebond at the next visit.' },
    story: {
      kind: 'ortho', workType: 1, doctor: 'karwan', startMonthsAgo: 19, total: 2_000_000, currency: 'IQD',
      paidShare: 0.85, everyDays: 35,
    },
    next: { inWorkingDays: 0, slot: 3, type: 'Follow Up', doctor: 'karwan' },
  },
  {
    key: 'maryam', nameAr: 'مريم جواد كاظم', first: 'Maryam', last: 'Jawad', gender: 2, age: 13, language: 0,
    address: [0, 0], referral: 2,
    story: {
      kind: 'ortho', workType: 1, doctor: 'karwan', startMonthsAgo: 2, total: 1_750_000, currency: 'IQD',
      paidShare: 0.3, everyDays: 30,
    },
    next: { inWorkingDays: 0, slot: 9, type: 'Follow Up', doctor: 'karwan' },
  },
  {
    key: 'hawraa', nameAr: 'حوراء علي حسين', first: 'Hawraa', last: 'Ali', gender: 2, age: 10, language: 0,
    address: [0, 1], referral: 1,
    notes: 'Phase 1: maxillary expansion before full braces.',
    story: {
      kind: 'ortho', workType: 2, doctor: 'lana', startMonthsAgo: 5, total: 900_000, currency: 'IQD',
      paidShare: 0.5, everyDays: 42,
    },
    next: { inWorkingDays: 2, slot: 7, type: 'Follow Up', doctor: 'lana' },
  },
  {
    key: 'rawand', nameAr: 'رواند عزيز محمد', first: 'Rawand', last: 'Aziz', gender: 1, age: 24, language: 2,
    address: [1, 0], referral: 3, email: true,
    story: {
      kind: 'ortho', workType: 19, doctor: 'sara', startMonthsAgo: 4, total: 1_900, currency: 'USD',
      paidShare: 0.74, everyDays: 42,
      aligner: {
        upper: 20, lower: 18, days: 10,
        batches: [
          { upper: 8, lower: 8, madeDaysAgo: 118, delivered: true },
          { upper: 8, lower: 8, madeDaysAgo: 40, delivered: true },
          { upper: 4, lower: 2, madeDaysAgo: 6, delivered: false, last: true },
        ],
        labNotes: [
          'Attachments on UR3, UL3, LR4 — templates included with batch 1.',
          'IPR 0.3 mm between UR2/UR3 before aligner 5.',
        ],
      },
    },
    next: { inWorkingDays: 0, slot: 6, type: 'Follow Up', doctor: 'sara' },
  },
  {
    key: 'rusul', nameAr: 'رسل حميد كاظم', first: 'Rusul', last: 'Hameed', gender: 2, age: 15, language: 0,
    address: [0, 1], referral: 0,
    story: {
      kind: 'ortho', workType: 1, doctor: 'lana', startMonthsAgo: 7, total: 1_800_000, currency: 'IQD',
      paidShare: 0.45, everyDays: 35,
    },
    next: { inWorkingDays: 1, slot: 13, type: 'Follow Up', doctor: 'lana' },
  },
  {
    key: 'murtadha', nameAr: 'مرتضى سعد جبار', first: 'Murtadha', last: 'Saad', gender: 1, age: 16, language: 0,
    address: [0, 2], referral: 1,
    story: {
      kind: 'ortho', workType: 1, doctor: 'karwan', startMonthsAgo: 13, total: 2_000_000, currency: 'IQD',
      paidShare: 0.6, everyDays: 35,
    },
    next: { inWorkingDays: 2, slot: 12, type: 'Follow Up', doctor: 'karwan' },
  },
  {
    key: 'noor', nameAr: 'نور هادي عباس', first: 'Noor', last: 'Hadi', gender: 2, age: 22, language: 0,
    address: [2, 0], referral: 1,
    story: {
      kind: 'ortho', workType: 1, doctor: 'lana', startMonthsAgo: 34, finishedMonthsAgo: 10,
      total: 1_600_000, currency: 'IQD', paidShare: 1, everyDays: 38,
    },
  },
  {
    key: 'mustafa', nameAr: 'مصطفى جبار ناصر', first: 'Mustafa', last: 'Jabbar', gender: 1, age: 15, language: 0,
    address: [0, 2], referral: 0,
    notes: 'Family moved abroad; treatment stopped at the parents’ request.',
    story: {
      kind: 'ortho', workType: 1, doctor: 'karwan', startMonthsAgo: 14, discontinuedMonthsAgo: 6,
      total: 1_750_000, currency: 'IQD', paidShare: 0.35, everyDays: 35,
    },
  },
  {
    key: 'tabarak', nameAr: 'تبارك عدنان فاضل', first: 'Tabarak', last: 'Adnan', gender: 2, age: 12, language: 0,
    address: [0, 1], referral: 0,
    story: { kind: 'new', daysAgo: 0 },
    next: { inWorkingDays: 0, slot: 15, type: 'First Time', doctor: 'sara' },
  },
  {
    key: 'ali', nameAr: 'علي حسين كريم', first: 'Ali', last: 'Hussein', gender: 1, age: 30, language: 0,
    address: [0, 0], referral: 3,
    story: { kind: 'new', daysAgo: 3 },
    next: { inWorkingDays: 6, slot: 2, type: 'Exam', doctor: 'karwan' },
  },
  {
    key: 'fatima', nameAr: 'فاطمة خالد إبراهيم', first: 'Fatima', last: 'Khalid', gender: 2, age: 26, language: 0,
    address: [0, 2], referral: 0, email: true,
    story: { kind: 'intake', intake: 'consult', fee: 25_000, daysAgo: 5 },
    next: { inWorkingDays: 4, slot: 8, type: 'Follow Up', doctor: 'sara' },
  },
  {
    key: 'omar', nameAr: 'عمر فيصل سعيد', first: 'Omar', last: 'Faisal', gender: 1, age: 19, language: 1,
    address: [1, 1], referral: 1,
    story: { kind: 'intake', intake: 'consult', fee: 0, daysAgo: 14 },
  },
  {
    key: 'layla', nameAr: 'ليلى صباح نوري', first: 'Layla', last: 'Sabah', gender: 2, age: 35, language: 0,
    address: [0, 1], referral: 2,
    story: { kind: 'intake', intake: 'xray', fee: 15_000, daysAgo: 8 },
  },
  {
    key: 'hassan', nameAr: 'حسن مجيد عبد الله', first: 'Hassan', last: 'Majeed', gender: 1, age: 48, language: 0,
    address: [0, 0], referral: 2,
    alert: { type: 'Clinical', severity: 3, text: 'Penicillin allergy.' },
    story: {
      kind: 'treatment', workType: 17, doctor: 'lana', startDaysAgo: 20, total: 600_000, currency: 'IQD',
      paidShare: 0.5, sessions: 2, sessionType: 'Bridge',
      items: [{ teeth: ['UR2', 'UR1', 'UL1'], material: 'Zirconia', shadeSystem: 'Vita Classic', shade: 'A2', lab: true, note: '3-unit bridge UR2–UL1' }],
    },
    next: { inWorkingDays: 0, slot: 1, type: 'Bridge', doctor: 'lana' },
  },
  {
    key: 'zainab', nameAr: 'زينب قاسم محمد', first: 'Zainab', last: 'Qasim', gender: 2, age: 38, language: 0,
    address: [0, 2], referral: 1,
    story: {
      kind: 'treatment', workType: 5, doctor: 'lana', startDaysAgo: 8, total: 150_000, currency: 'IQD',
      paidShare: 0.5, sessions: 1, sessionType: 'Endo First',
      items: [{ teeth: ['LL6'], canals: 3, workingLength: '21 / 20.5 / 21 mm' }],
    },
    next: { inWorkingDays: 1, slot: 10, type: 'Endo Second', doctor: 'lana' },
  },
  {
    key: 'karim', nameAr: 'كريم عباس جواد', first: 'Karim', last: 'Abbas', gender: 1, age: 29, language: 1,
    address: [1, 0], referral: 0, email: true,
    story: {
      kind: 'treatment', workType: 9, doctor: 'lana', startDaysAgo: 75, finishedDaysAgo: 40, total: 1_200,
      currency: 'USD', paidShare: 1, sessions: 3, sessionType: 'Follow Up',
      items: [{ teeth: ['UR2', 'UR1', 'UL1', 'UL2'], material: 'E.max', shadeSystem: 'Vita Classic', shade: 'A1', lab: true }],
    },
    next: { inWorkingDays: 0, slot: 12, type: 'Exam', doctor: 'lana' },
  },
  {
    key: 'dana', nameAr: 'دانا ريبوار أحمد', first: 'Dana', last: 'Rebwar', gender: 2, age: 27, language: 2,
    address: [1, 1], referral: 0,
    story: {
      kind: 'treatment', workType: 3, doctor: 'karwan', startDaysAgo: 35, finishedDaysAgo: 35, total: 50_000,
      currency: 'IQD', paidShare: 1, sessions: 1, sessionType: 'Follow Up', items: [],
    },
  },
  {
    key: 'ibrahim', nameAr: 'إبراهيم ناصر يوسف', first: 'Ibrahim', last: 'Nasser', gender: 1, age: 55, language: 0,
    address: [0, 1], referral: 2,
    story: {
      kind: 'treatment', workType: 15, doctor: 'karwan', startDaysAgo: 60, total: 900_000, currency: 'IQD',
      paidShare: 0.5, sessions: 2, sessionType: 'Implant',
      items: [{ teeth: ['LR6'], implantLength: 10, implantDiameter: 4.5, note: 'Healing abutment placed' }],
    },
    next: { inWorkingDays: 8, slot: 11, type: 'Implant', doctor: 'karwan' },
  },
];

/** Upper / lower archwire by visit, round NiTi → rectangular → SS (null = arch not bonded yet). */
export const WIRE_SEQUENCE: ReadonlyArray<readonly [string, string | null]> = [
  ['14 NiTi', null],
  ['14 NiTi', '14 NiTi'],
  ['16 NiTi', '14 NiTi'],
  ['16 NiTi', '16 NiTi'],
  ['16 x 22 NiTi', '16 NiTi'],
  ['16 x 22 NiTi', '16 x 22 NiTi'],
  ['17 x 25 NiTi', '16 x 22 NiTi'],
  ['17 x 25 NiTi', '17 x 25 NiTi'],
  ['19 x 25 NiTi', '17 x 25 NiTi'],
  ['19 x 25 SS', '19 x 25 NiTi'],
  ['19 x 25 SS', '19 x 25 SS'],
];

export type DemoExpense = {
  category: string;
  daysAgo: number;
  amount: number;
  currency: Currency;
  note: string;
  monthly?: boolean;
  staff?: StaffKey;
  lab?: boolean;
};

/**
 * Two months of running costs, sized to the demo's own income (about 55–60% of what it takes in per
 * 30 days, in each currency) so the Statistics screen shows a small practice that pays its way —
 * the owner-occupied building has no rent line. Category names match the starter / migration rows;
 * `staff` / `lab` exercise the Employees / Lab entity pickers.
 */
export const DEMO_EXPENSES: readonly DemoExpense[] = [
  { category: 'Employees', daysAgo: 57, amount: 300_000, currency: 'IQD', note: 'Salary', monthly: true, staff: 'assistant' },
  { category: 'Employees', daysAgo: 27, amount: 300_000, currency: 'IQD', note: 'Salary', monthly: true, staff: 'assistant' },
  { category: 'Dental Supplies', daysAgo: 50, amount: 90_000, currency: 'IQD', note: 'Brackets and buccal tubes' },
  { category: 'Lab', daysAgo: 45, amount: 60_000, currency: 'IQD', note: 'Retainers × 2', lab: true },
  { category: 'Utilities', daysAgo: 40, amount: 90_000, currency: 'IQD', note: 'Electricity + generator' },
  { category: 'Lab', daysAgo: 38, amount: 300, currency: 'USD', note: 'E.max veneers × 4', lab: true },
  { category: 'Cleaning', daysAgo: 20, amount: 25_000, currency: 'IQD', note: 'Cleaning supplies' },
  { category: 'Dental Supplies', daysAgo: 16, amount: 60_000, currency: 'IQD', note: 'Gloves and masks' },
  { category: 'Marketing', daysAgo: 15, amount: 50, currency: 'USD', note: 'Instagram promotion' },
  { category: 'Lab', daysAgo: 12, amount: 120_000, currency: 'IQD', note: 'Zirconia bridge (3 units)', lab: true },
  { category: 'Utilities', daysAgo: 10, amount: 85_000, currency: 'IQD', note: 'Electricity + generator' },
];
