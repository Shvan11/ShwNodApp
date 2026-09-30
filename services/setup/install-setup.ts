/**
 * First-run setup for a NEW deployment — everything a fresh `npm run db:migrate` leaves for the
 * clinic to decide: the first login, the clinic's identity, its default currency, the starter
 * vocabularies, and the materialised calendar.
 *
 * Driven by `npm run db:setup` (services/setup/setup-cli.ts) and reused by the demo seeder
 * (services/setup/demo/). The migrations own the rows the CODE names (1789460400000 +
 * 1789460500000); this module owns the ones the CLINIC names.
 *
 * SAFE AGAINST AN EXISTING DEPLOYMENT, step by step:
 *  - vocabularies are filled only while their table is still empty (see starter-vocabulary.ts);
 *  - the first admin is created only while `users` is empty;
 *  - identity / currency change only when the caller passes a value;
 *  - fillCalendar() is the same idempotent "add missing future slots" the Calendar screen runs.
 * So re-running setup, or pointing it at a live clinic by mistake, adds nothing that is there.
 */
import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
import { createUser } from '../database/queries/user-queries.js';
import { fillCalendar } from '../database/queries/calendar-queries.js';
import { getOptions, upsertOption } from '../database/queries/options-queries.js';
import { defaultVideosPath } from '../files/clinic-paths.js';

/** The educational-videos folder option (read by services/database/queries/video-queries.ts). */
const VIDEOS_PATH_OPTION = 'VideosPath';
import { hashPassword } from '../../middleware/auth.js';
import { ROLES } from '../../shared/auth/roles.js';
import { MIN_PASSWORD_LENGTH } from '../../shared/validation.js';
import { parseWorkCurrency, type WorkCurrency } from '../../shared/work-currency.js';
import {
  DEFAULT_CLINIC_MESSAGE_NAME,
  DEFAULT_CLINIC_MESSAGE_NAME_AR,
} from '../settings/clinic-identity-defaults.js';
import { CLINIC_MESSAGE_NAME_AR_OPTION, CLINIC_MESSAGE_NAME_OPTION } from '../settings/clinic-identity.js';
import { GROUP_NAME_OPTION } from '../messaging/group-settings.js';
import {
  DOCTOR_POSITION,
  SEEDED_EXPENSE_CATEGORY_IDS,
  STARTER_ALERT_TYPES,
  STARTER_APPOINTMENT_TYPES,
  STARTER_EXPENSE_CATEGORIES,
  STARTER_POSITIONS,
  STARTER_TIME_SLOTS,
  STARTER_WAIT_REASONS,
  STARTER_WIRES,
} from './starter-vocabulary.js';

/** One line of the setup report. `applied` = rows written; `skipped` = left as found. */
export type SetupStep = { step: string; outcome: 'applied' | 'skipped'; detail: string };

/** The header display name (Settings → General; UniversalHeader falls back to the original clinic's). */
export const CLINIC_NAME_OPTION = 'CLINIC_NAME';
export const DEFAULT_WORK_CURRENCY_OPTION = 'DEFAULT_WORK_CURRENCY';

/**
 * The identity a fresh install ships with. The baseline + 1789460200000 seeded the ORIGINAL
 * clinic's wording into these rows (so its own reminders stayed byte-identical), which means a new
 * center that skips setup sends its patients another clinic's name. `identityWarnings()` flags them.
 */
const ORIGINAL_CLINIC_VALUES: Record<string, string> = {
  [CLINIC_MESSAGE_NAME_OPTION]: DEFAULT_CLINIC_MESSAGE_NAME,
  [CLINIC_MESSAGE_NAME_AR_OPTION]: DEFAULT_CLINIC_MESSAGE_NAME_AR,
  [GROUP_NAME_OPTION]: 'Shwan Orthodontics',
};

// ── Starter vocabularies ──────────────────────────────────────────────────────

async function tableRowCount(
  table: 'times' | 'details' | 'alert_types' | 'wires' | 'wait_reasons'
): Promise<number> {
  const row = await getKysely()
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Fill each starter vocabulary whose table is still empty. Idempotent: a table with any row at all
 * (the clinic's own, or a previous run's) is reported and left alone.
 */
export async function applyStarterVocabularies(): Promise<SetupStep[]> {
  const db = getKysely();
  const steps: SetupStep[] = [];

  const fill = async (
    step: string,
    count: () => Promise<number>,
    insert: () => Promise<unknown>,
    size: number
  ): Promise<void> => {
    const existing = await count();
    if (existing > 0) {
      steps.push({ step, outcome: 'skipped', detail: `already has ${existing} row(s)` });
      return;
    }
    await insert();
    steps.push({ step, outcome: 'applied', detail: `${size} default row(s)` });
  };

  await fill(
    'Calendar time slots',
    () => tableRowCount('times'),
    () => db.insertInto('times').values(STARTER_TIME_SLOTS.map((t) => ({ my_time: t }))).execute(),
    STARTER_TIME_SLOTS.length
  );
  await fill(
    'Appointment types',
    () => tableRowCount('details'),
    () => db.insertInto('details').values(STARTER_APPOINTMENT_TYPES.map((d) => ({ detail: d }))).execute(),
    STARTER_APPOINTMENT_TYPES.length
  );
  await fill(
    'Alert types',
    () => tableRowCount('alert_types'),
    () => db.insertInto('alert_types').values(STARTER_ALERT_TYPES.map((t) => ({ type_name: t }))).execute(),
    STARTER_ALERT_TYPES.length
  );
  await fill(
    'Wires',
    () => tableRowCount('wires'),
    () => db.insertInto('wires').values(STARTER_WIRES.map((w) => ({ wire: w }))).execute(),
    STARTER_WIRES.length
  );
  // expense_categories always holds the migration's two code-constant rows (5 Employees, 7 Lab).
  await fill(
    'Expense categories',
    async () => {
      const row = await db
        .selectFrom('expense_categories')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('category_id', 'not in', [...SEEDED_EXPENSE_CATEGORY_IDS])
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
    () =>
      db
        .insertInto('expense_categories')
        .values(STARTER_EXPENSE_CATEGORIES.map((c) => ({ category_name: c.name, category_name_ar: c.nameAr })))
        .execute(),
    STARTER_EXPENSE_CATEGORIES.length
  );
  await fill(
    'Waiting-list reasons',
    () => tableRowCount('wait_reasons'),
    () => db.insertInto('wait_reasons').values(STARTER_WAIT_REASONS.map((w) => ({ wait_type: w }))).execute(),
    STARTER_WAIT_REASONS.length
  );
  // positions always holds the migration's 'Doctor', so "empty" here means "nothing else".
  await fill(
    'Staff positions',
    async () => {
      const row = await db
        .selectFrom('positions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('position_name', '<>', DOCTOR_POSITION)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
    () => db.insertInto('positions').values(STARTER_POSITIONS.map((p) => ({ position_name: p }))).execute(),
    STARTER_POSITIONS.length
  );

  return steps;
}

/**
 * Materialise the appointment calendar (date × time-slot rows for the next year, Fridays and
 * holidays excluded) — the same fillCalendar() behind Calendar → Regenerate. Needs the time slots.
 */
export async function generateCalendar(): Promise<SetupStep> {
  const { DaysAdded } = await fillCalendar();
  return DaysAdded > 0
    ? { step: 'Calendar', outcome: 'applied', detail: `${DaysAdded} future slot(s) generated` }
    : { step: 'Calendar', outcome: 'skipped', detail: 'already up to date (or no time slots configured)' };
}

/**
 * Give the install a `VideosPath` row, set to the default videos folder under
 * MACHINE_PATH, when it has none — so the folder is visible and editable in
 * Settings → General like every other path (audit FE-F11-16). The server falls
 * back to the same default when the row is missing, so this only makes it
 * visible; an existing row is never touched.
 */
export async function ensureVideosFolderOption(): Promise<SetupStep> {
  const current = (await getOptions([VIDEOS_PATH_OPTION])).get(VIDEOS_PATH_OPTION);
  if (current && current.trim()) {
    return { step: 'Videos folder', outcome: 'skipped', detail: `already set (${current})` };
  }
  const value = defaultVideosPath();
  await upsertOption(VIDEOS_PATH_OPTION, value);
  return { step: 'Videos folder', outcome: 'applied', detail: value };
}

// ── Identity + currency ───────────────────────────────────────────────────────

export type ClinicIdentity = {
  /** Header display name (Settings → General). */
  clinicName?: string;
  /** The name inside English patient messages. */
  messageName?: string;
  /** The name inside Arabic patient messages. */
  messageNameAr?: string;
  /** The WhatsApp group the daily appointment list is posted to. */
  whatsappGroup?: string;
};

/** Write whichever identity fields were given (trimmed; blank values are ignored, not cleared). */
export async function applyClinicIdentity(identity: ClinicIdentity): Promise<SetupStep[]> {
  const pairs: Array<[string, string | undefined, string]> = [
    [CLINIC_NAME_OPTION, identity.clinicName, 'Clinic name (header)'],
    [CLINIC_MESSAGE_NAME_OPTION, identity.messageName, 'Clinic name in English messages'],
    [CLINIC_MESSAGE_NAME_AR_OPTION, identity.messageNameAr, 'Clinic name in Arabic messages'],
    [GROUP_NAME_OPTION, identity.whatsappGroup, 'WhatsApp group name'],
  ];
  const steps: SetupStep[] = [];
  for (const [option, raw, label] of pairs) {
    const value = raw?.trim();
    if (!value) continue;
    await upsertOption(option, value);
    steps.push({ step: label, outcome: 'applied', detail: value });
  }
  return steps;
}

/** Set the currency new works default to (Settings → General). Throws on anything but IQD/USD. */
export async function applyDefaultCurrency(currency: string): Promise<SetupStep> {
  const parsed: WorkCurrency | null = parseWorkCurrency(currency);
  if (!parsed) throw new Error(`Unknown currency "${currency}" — expected IQD or USD.`);
  await upsertOption(DEFAULT_WORK_CURRENCY_OPTION, parsed);
  return { step: 'Default work currency', outcome: 'applied', detail: parsed };
}

/** The identity + currency rows as they stand, for prompts and the closing summary. */
export async function readIdentity(): Promise<Record<string, string>> {
  const names = [
    CLINIC_NAME_OPTION,
    CLINIC_MESSAGE_NAME_OPTION,
    CLINIC_MESSAGE_NAME_AR_OPTION,
    GROUP_NAME_OPTION,
    DEFAULT_WORK_CURRENCY_OPTION,
  ];
  const rows = await getOptions(names);
  return Object.fromEntries(names.map((n) => [n, (rows.get(n) ?? '').trim()]));
}

/**
 * Human-readable warnings for identity settings a new center must not leave as they are: still
 * blank (the header then shows the built-in fallback) or still the original clinic's wording.
 */
export function identityWarnings(current: Record<string, string>): string[] {
  const warnings: string[] = [];
  if (!current[CLINIC_NAME_OPTION]) {
    warnings.push('The clinic name is not set, so the header shows the built-in default.');
  }
  for (const [option, original] of Object.entries(ORIGINAL_CLINIC_VALUES)) {
    if (current[option] === original) {
      warnings.push(`${option} still holds the original clinic's value ("${original}").`);
    }
  }
  if (!current[DEFAULT_WORK_CURRENCY_OPTION]) {
    warnings.push('No default work currency is set; clinical staff cannot add works until one is.');
  }
  return warnings;
}

// ── First admin ───────────────────────────────────────────────────────────────

export async function countUsers(): Promise<number> {
  const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM users`.execute(getKysely());
  return rows[0]?.n ?? 0;
}

/**
 * Create the first admin — only while `users` is empty. After that, users are managed in
 * Settings → Users (and a lost admin password is `npm run auth:emergency-reset`).
 */
export async function createFirstAdmin(admin: {
  username: string;
  password: string;
  fullName?: string;
}): Promise<SetupStep> {
  if ((await countUsers()) > 0) {
    return { step: 'First admin', outcome: 'skipped', detail: 'users already exist' };
  }
  const username = admin.username.trim();
  if (!username) throw new Error('The admin username is empty.');
  if (admin.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The admin password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  await createUser({
    username,
    passwordHash: await hashPassword(admin.password),
    fullName: admin.fullName?.trim() || username,
    role: ROLES.ADMIN,
    createdBy: 'db:setup',
  });
  return { step: 'First admin', outcome: 'applied', detail: `"${username}" (admin)` };
}
