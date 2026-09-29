// `npm run db:seed:demo` — see services/setup/demo/demo-cli.ts (kept there so it is type-checked and linted).
process.env.LOG_LEVEL ??= 'warn';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
const { runDemoCli } = await import('../services/setup/demo/demo-cli.js');
process.exit(await runDemoCli(process.argv.slice(2)));
