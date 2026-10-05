/**
 * `npm run db:setup` — first-run setup for a new deployment (after `npm run db:migrate`).
 *
 * Interactive in a terminal (it asks for anything not passed as a flag, showing the current value
 * as the default); non-interactive with `--yes` or when stdin is not a TTY (flags only — what's
 * missing is reported, never guessed). Every step is safe to repeat: see install-setup.ts.
 *
 *   npm run db:setup
 *   npm run db:setup -- --yes --admin-user admin --admin-password '…' \
 *       --clinic-name 'Bright Smile Orthodontics' --message-name 'Bright Smile clinic' \
 *       --message-name-ar 'عيادة برايت سمايل' --whatsapp-group 'Bright Smile' --currency IQD
 *
 * Console output is this CLI's user interface (like scripts/reset-admin-password.js); the service
 * functions it calls log through Winston as usual.
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { getKysely } from '../database/kysely.js';
import {
  CLINIC_NAME_OPTION,
  DEFAULT_WORK_CURRENCY_OPTION,
  applyClinicIdentity,
  applyDefaultCurrency,
  applyStarterVocabularies,
  countUsers,
  createFirstAdmin,
  generateCalendar,
  ensureVideosFolderOption,
  ensureIntegrationPathOptions,
  identityWarnings,
  readIdentity,
  type SetupStep,
} from './install-setup.js';
import { CLINIC_MESSAGE_NAME_AR_OPTION, CLINIC_MESSAGE_NAME_OPTION } from '../settings/clinic-identity.js';
import { GROUP_NAME_OPTION } from '../messaging/group-settings.js';

const USAGE = `Usage: npm run db:setup [-- options]

First-run setup for a new deployment. Run it after "npm run db:migrate".

  --admin-user <name>        first admin's username (only used while there are no users)
  --admin-password <pw>      first admin's password
  --admin-name <full name>   first admin's display name (default: the username)
  --clinic-name <name>       clinic name shown in the header
  --message-name <name>      clinic name inside English patient messages
  --message-name-ar <name>   clinic name inside Arabic patient messages
  --whatsapp-group <name>    WhatsApp group the daily appointment list is posted to
  --currency <IQD|USD>       default currency for new works
  --yes                      never prompt; use only what the flags say
  --help                     show this text

Starter vocabularies (time slots, appointment types, wires, …) are added only to tables that
are still empty, and the appointment calendar is generated.`;

type Printer = (line: string) => void;

function printSteps(print: Printer, steps: SetupStep[]): void {
  for (const s of steps) print(`  ${s.outcome === 'applied' ? '✓' : '·'} ${s.step}: ${s.detail}`);
}

export async function runSetupCli(argv: string[], print: Printer = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      options: {
        'admin-user': { type: 'string' },
        'admin-password': { type: 'string' },
        'admin-name': { type: 'string' },
        'clinic-name': { type: 'string' },
        'message-name': { type: 'string' },
        'message-name-ar': { type: 'string' },
        'whatsapp-group': { type: 'string' },
        currency: { type: 'string' },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    print((err as Error).message);
    print(USAGE);
    return 1;
  }
  const flags = parsed.values;
  if (flags.help) {
    print(USAGE);
    return 0;
  }

  const interactive = !flags.yes && process.stdin.isTTY === true;
  // readline writes through this so a password prompt can silence its echo (askSecret).
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer | string, encoding: BufferEncoding, done: () => void) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = interactive ? createInterface({ input: process.stdin, output, terminal: true }) : null;
  /** Ask with the current value as the default; non-interactive → the flag or nothing. */
  const ask = async (question: string, flag: string | undefined, current = ''): Promise<string | undefined> => {
    if (flag !== undefined || !rl) return flag;
    const hint = current ? ` [${current}]` : '';
    const answer = (await rl.question(`${question}${hint}: `)).trim();
    return answer || current || undefined;
  };
  /** A password prompt that does not echo what is typed (like sudo): readline's output is muted. */
  const askSecret = async (question: string, flag: string | undefined): Promise<string | undefined> => {
    if (flag !== undefined || !rl) return flag;
    process.stdout.write(`${question}: `);
    muted = true;
    try {
      return (await rl.question('')) || undefined;
    } finally {
      muted = false;
      process.stdout.write('\n');
    }
  };

  try {
    print('Shwan app — first-run setup');

    // 1. First admin (only while there are no users).
    const users = await countUsers();
    let adminStep: SetupStep | null = null;
    if (users === 0) {
      const username = await ask('First admin username', flags['admin-user'], 'admin');
      const password = await askSecret('First admin password', flags['admin-password']);
      if (username && password) {
        const fullName = await ask('First admin full name', flags['admin-name'], username);
        adminStep = await createFirstAdmin({ username, password, fullName });
      }
    }

    // 2. Identity + currency.
    const current = await readIdentity();
    const clinicName = await ask('Clinic name (header)', flags['clinic-name'], current[CLINIC_NAME_OPTION]);
    const messageName = await ask(
      'Clinic name inside English messages',
      flags['message-name'],
      current[CLINIC_MESSAGE_NAME_OPTION]
    );
    const messageNameAr = await ask(
      'Clinic name inside Arabic messages',
      flags['message-name-ar'],
      current[CLINIC_MESSAGE_NAME_AR_OPTION]
    );
    const whatsappGroup = await ask(
      'WhatsApp group for the daily appointment list',
      flags['whatsapp-group'],
      current[GROUP_NAME_OPTION]
    );
    const currency = await ask(
      'Default currency for new works (IQD/USD)',
      flags.currency,
      current[DEFAULT_WORK_CURRENCY_OPTION]
    );

    const steps: SetupStep[] = [];
    if (adminStep) steps.push(adminStep);
    // Only write what actually changed, so the report says what setup did.
    const changed = (v: string | undefined, option: string) => (v && v !== current[option] ? v : undefined);
    steps.push(
      ...(await applyClinicIdentity({
        clinicName: changed(clinicName, CLINIC_NAME_OPTION),
        messageName: changed(messageName, CLINIC_MESSAGE_NAME_OPTION),
        messageNameAr: changed(messageNameAr, CLINIC_MESSAGE_NAME_AR_OPTION),
        whatsappGroup: changed(whatsappGroup, GROUP_NAME_OPTION),
      }))
    );
    if (currency && currency.toUpperCase() !== current[DEFAULT_WORK_CURRENCY_OPTION]) {
      steps.push(await applyDefaultCurrency(currency));
    }

    // 3. Starter vocabularies, then the calendar that needs the time slots.
    steps.push(...(await applyStarterVocabularies()));
    steps.push(await generateCalendar());
    steps.push(await ensureVideosFolderOption());
    steps.push(await ensureIntegrationPathOptions());

    print('');
    printSteps(print, steps);

    // 4. What still needs a human.
    const todo = identityWarnings(await readIdentity());
    if ((await countUsers()) === 0) {
      todo.unshift('No user exists yet: pass --admin-user and --admin-password (or run interactively).');
    }
    if (todo.length > 0) {
      print('');
      print('Still to do (Settings → General, or re-run with the matching flag):');
      for (const t of todo) print(`  ! ${t}`);
    }
    print('');
    print('Setup finished. Optional: "npm run db:seed:demo" fills an EMPTY install with demo patients.');
    return 0;
  } catch (err) {
    print(`Setup failed: ${(err as Error).message}`);
    return 1;
  } finally {
    rl?.close();
    await getKysely().destroy();
  }
}
