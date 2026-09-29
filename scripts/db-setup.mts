// `npm run db:setup` — see services/setup/setup-cli.ts (kept there so it is type-checked and linted).
process.env.LOG_LEVEL ??= 'warn';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
const { runSetupCli } = await import('../services/setup/setup-cli.js');
process.exit(await runSetupCli(process.argv.slice(2)));
