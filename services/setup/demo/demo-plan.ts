/**
 * Pure planning helpers for the demo seeder: dates on the clinic's week, deterministic "random"
 * choices, arrival states, contact details that reach nobody, and the refuse-to-run rules.
 *
 * No imports and no I/O — the CI gate has no database or .env (see demo-plan.test.ts). Everything
 * that touches the database or the disk lives in demo-seed.ts / demo-photos.ts / demo-remove.ts.
 */

// ── Dates on the clinic week ──────────────────────────────────────────────────

/** The clinic week is Sat–Thu: Friday (`getDay() === 5`) is the only day off (CLAUDE.md). */
export const DAY_OFF = 5;

/** Local-calendar 'YYYY-MM-DD' (never toISOString — that is UTC and shifts the day). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of `d` plus `n` calendar days. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** `d` moved by whole calendar months, the day clamped to the target month's length. */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}

export function isWorkingDay(d: Date, holidays: ReadonlySet<string>): boolean {
  return d.getDay() !== DAY_OFF && !holidays.has(ymd(d));
}

/** The nearest working day on or before `d`. */
export function workingDayOnOrBefore(d: Date, holidays: ReadonlySet<string>): Date {
  let x = addDays(d, 0);
  while (!isWorkingDay(x, holidays)) x = addDays(x, -1);
  return x;
}

/** The nearest working day on or after `d`. */
export function workingDayOnOrAfter(d: Date, holidays: ReadonlySet<string>): Date {
  let x = addDays(d, 0);
  while (!isWorkingDay(x, holidays)) x = addDays(x, 1);
  return x;
}

/** The `n`-th working day strictly after `d` (n = 1 → the next working day). */
export function nthWorkingDayAfter(d: Date, n: number, holidays: ReadonlySet<string>): Date {
  let x = addDays(d, 0);
  for (let i = 0; i < n; i++) x = workingDayOnOrAfter(addDays(x, 1), holidays);
  return x;
}

/**
 * Visit dates from `start` to `end`, about every `everyDays` (±4 days, like real rebookings), each
 * on a working day, always ending ON `end` (snapped back to a working day) — the debond, or the
 * latest check-up. A visit that would land within a week of `end` is dropped in its favour.
 * Deterministic for a given rng.
 */
export function visitDates(
  start: Date,
  end: Date,
  everyDays: number,
  holidays: ReadonlySet<string>,
  rng: () => number
): Date[] {
  const first = workingDayOnOrAfter(start, holidays);
  const last = workingDayOnOrBefore(end, holidays);
  if (last <= first) return [first];
  const out: Date[] = [];
  let x = first;
  while (x < last) {
    out.push(x);
    const jitter = Math.round((rng() - 0.5) * 8);
    x = workingDayOnOrAfter(addDays(x, everyDays + jitter), holidays);
  }
  if (out.length > 1 && (last.getTime() - out[out.length - 1].getTime()) / 86_400_000 < 7) out.pop();
  out.push(last);
  return out;
}

// ── Times ─────────────────────────────────────────────────────────────────────

/** 'HH:MM' → minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((p) => Number.parseInt(p, 10));
  return h * 60 + m;
}

/** Minutes after midnight → 'HH:MM:00' (the `time`-typed strings the appointment state columns hold). */
export function toClock(minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

export type ArrivalState = 'pending' | 'present' | 'seated' | 'dismissed';

/**
 * Where a patient booked at `slotMin` is in the visit at `nowMin`, with the times each step
 * happened — the three columns `updatePresent` fills, in its transition order. A slot more than
 * an hour past is done, one within the last hour is in the chair, one just started is waiting,
 * and anything later has not arrived. Past days pass `nowMin = Infinity` (every visit done).
 */
export function arrivalFor(
  slotMin: number,
  nowMin: number
): { state: ArrivalState; present?: string; seated?: string; dismissed?: string } {
  const present = slotMin - 5;
  const seated = slotMin + 8;
  const dismissed = slotMin + 35;
  if (nowMin < present) return { state: 'pending' };
  if (nowMin < seated) return { state: 'present', present: toClock(present) };
  if (nowMin < dismissed) return { state: 'seated', present: toClock(present), seated: toClock(seated) };
  return { state: 'dismissed', present: toClock(present), seated: toClock(seated), dismissed: toClock(dismissed) };
}

// ── Deterministic randomness ──────────────────────────────────────────────────

/** mulberry32 — a tiny seeded PRNG, so every seed of the demo is byte-for-byte the same story. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Round a money amount to a sensible cash step (IQD 25,000 · USD 50). */
export function roundMoney(amount: number, currency: 'IQD' | 'USD'): number {
  const step = currency === 'IQD' ? 25_000 : 50;
  return Math.max(step, Math.round(amount / step) * step);
}

/** What a patient has paid of `total` at `share` — the whole total when settled, else a cash-step amount. */
export function paidAmount(total: number, share: number, currency: 'IQD' | 'USD'): number {
  if (share >= 1) return total;
  if (share <= 0) return 0;
  return Math.min(total, roundMoney(total * share, currency));
}

/**
 * Split `paid` into up to `count` payments the way ortho is paid here: a down payment (at least
 * 30%), then equal installments in whole cash steps. The down payment absorbs the rounding, so the
 * sum is exact and no odd last installment appears. Fewer payments when the amount is too small.
 */
export function installments(paid: number, count: number, currency: 'IQD' | 'USD'): number[] {
  if (paid <= 0 || count <= 0) return [];
  const step = currency === 'IQD' ? 25_000 : 50;
  for (let n = Math.min(count, Math.floor(paid / step)); n > 1; n--) {
    const each = Math.floor((paid * 0.7) / (n - 1) / step) * step;
    if (each >= step) return [paid - each * (n - 1), ...Array.from({ length: n - 1 }, () => each)];
  }
  return [paid];
}

// ── Contact details that reach nobody ─────────────────────────────────────────

/**
 * A phone in Ofcom's reserved TV-drama range, 07700 900000–900999 (+44 7700 900xxx): numbers that
 * are never allocated to anyone. The WhatsApp/SMS reminder batch targets every patient booked one
 * or two days ahead, and a demo always has some — random "local-looking" numbers would belong to
 * real people. Stored the app's way: national digits in `phone`, the calling code in `country_code`.
 */
export function demoPhone(seq: number): { phone: string; countryCode: string } {
  if (!Number.isInteger(seq) || seq < 0 || seq > 999) throw new Error(`demo phone sequence out of range: ${seq}`);
  return { phone: `7700900${String(seq).padStart(3, '0')}`, countryCode: '44' };
}

/** An address under example.com, which RFC 2606 reserves: mail to it can never be delivered. */
export function demoEmail(local: string): string {
  return `${local.toLowerCase().replace(/[^a-z0-9.]+/g, '.')}@example.com`;
}

// ── Refuse-to-run rules ───────────────────────────────────────────────────────

export type DemoPreconditions = {
  /** Rows in `patients`. */
  patientCount: number;
  /** `cdc_sink_control` rows with enabled = true. */
  enabledSinks: string[];
  /** Entries under the clinic volume that belong to patients (numeric folders, working/ files). */
  volumePatientEntries: string[];
  /** Active admin users (the demo creates none; setup does). */
  adminCount: number;
  /** An existing demo manifest (a previous seed not yet removed). */
  hasManifest: boolean;
};

/**
 * Every reason the demo must not be seeded here, in words. Empty = go ahead.
 *
 *  - any patient: demo rows would mix with real ones (and ids would not be the fresh 1, 3, 5…);
 *  - a capturing sync sink: every demo row would be pushed to the Supabase mirror (and from there
 *    into the doctor portal) or into Dolphin;
 *  - patient files on the volume: photo paths are keyed by person_id, so demo patient 1 would write
 *    into — and on removal DELETE — a real patient 1's folder and gallery files;
 *  - no admin: nobody could log in to see it (run `npm run db:setup` first);
 *  - a manifest: already seeded (remove it first).
 */
export function demoRefusals(p: DemoPreconditions): string[] {
  const out: string[] = [];
  if (p.hasManifest) out.push('Demo data is already seeded here. Remove it first: npm run db:seed:demo -- remove');
  if (p.patientCount > 0) {
    out.push(`The database already has ${p.patientCount} patient(s). The demo only seeds an EMPTY install.`);
  }
  if (p.enabledSinks.length > 0) {
    out.push(
      `Sync capture is ON for: ${p.enabledSinks.join(', ')}. Demo rows would be pushed to the mirror/Dolphin. ` +
        'Seed before enabling sync.'
    );
  }
  if (p.volumePatientEntries.length > 0) {
    const sample = p.volumePatientEntries.slice(0, 5).join(', ');
    out.push(
      `The photo folder (MACHINE_PATH/clinic1) already holds patient files (${sample}${p.volumePatientEntries.length > 5 ? ', …' : ''}). ` +
        'Photo paths are keyed by patient id, so demo patients would write into (and on removal delete) those folders. ' +
        'Point MACHINE_PATH at an empty folder for a demo install.'
    );
  }
  if (p.adminCount === 0) out.push('No active admin user exists yet. Run "npm run db:setup" first.');
  return out;
}

/**
 * Which names under the clinic volume count as patient data: numeric per-patient folders, and any
 * file in the shared `working/` gallery except the shared logo.
 */
export function isPatientVolumeEntry(topLevelName: string): boolean {
  return /^\d+$/.test(topLevelName);
}
