/**
 * `npm run db:seed:demo` / `npm run db:seed:demo -- remove` — see demo-seed.ts and demo-remove.ts.
 *
 * Console output is this CLI's user interface (like services/setup/setup-cli.ts).
 */
import { getKysely } from '../../database/kysely.js';
import { DEMO_PATIENTS } from './demo-cast.js';
import { removeDemo } from './demo-remove.js';
import { demoPreconditionFailures, seedDemo } from './demo-seed.js';

const USAGE = `Usage:
  npm run db:seed:demo              seed an EMPTY install with a demo clinic (fictional patients)
  npm run db:seed:demo -- remove    remove everything the seed created

The seed refuses to run unless the database has no patients, the photo folder
(MACHINE_PATH/clinic1) holds no patient files, sync capture is off, and an admin
exists ("npm run db:setup" first). Dates are relative to the day you seed: to
refresh them, remove and seed again.`;

export async function runDemoCli(argv: string[], print: (line: string) => void = console.log): Promise<number> {
  const command = argv[0] ?? 'seed';
  if (command === '--help' || command === 'help') {
    print(USAGE);
    return 0;
  }
  if (command !== 'seed' && command !== 'remove') {
    print(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  try {
    if (command === 'remove') {
      print('Removing the demo data…');
      await removeDemo(print);
      print('\nDone. The install is back to its pre-demo state.');
      return 0;
    }
    const refusals = await demoPreconditionFailures();
    if (refusals.length > 0) {
      print('Not seeding — this is not an empty demo install:');
      for (const r of refusals) print(`  ✗ ${r}`);
      return 1;
    }
    print('Seeding the demo clinic…');
    const m = await seedDemo(print);
    const showcase = DEMO_PATIENTS.findIndex((p) => p.story.kind === 'ortho' && p.story.photos);
    print('');
    print(`Done: ${m.patients.length} demo patients (tagged "Demo").`);
    if (showcase >= 0) {
      print(`The photographed case is ${DEMO_PATIENTS[showcase].first} ${DEMO_PATIENTS[showcase].last} (patient #${m.patients[showcase]}).`);
    }
    print('Remove it all later with: npm run db:seed:demo -- remove');
    return 0;
  } catch (err) {
    print(`\n${command === 'remove' ? 'Removal' : 'Seeding'} failed: ${(err as Error).message}`);
    if (command === 'seed') print('Anything already created is recorded; "npm run db:seed:demo -- remove" cleans it up.');
    return 1;
  } finally {
    await getKysely().destroy();
  }
}
