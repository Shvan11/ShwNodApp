/**
 * Emit shell `export …` lines with libpq env vars for psql, read from .env — so scripts/psql.sh can
 * connect to the app's LOCAL or SUPABASE DB without secrets ever appearing on a command line.
 *   node scripts/_pgenv.mjs local   → PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
 *   node scripts/_pgenv.mjs supa    → PGURL (sslmode stripped) + PGSSLMODE=require
 * Internal helper for scripts/psql.sh; not used by the app.
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true }); // suppress dotenv 17's promotional banner (would pollute the eval'd output)

const e = process.env;
const target = process.argv[2];

// POSIX single-quote a value: wrap in '…', and turn each embedded ' into '\''.
const sq = (s) => "'" + String(s == null ? '' : s).split("'").join("'\\''") + "'";

if (target === 'local') {
  const pairs = [
    ['PGHOST', e.PG_HOST],
    ['PGPORT', e.PG_PORT],
    ['PGDATABASE', e.PG_DATABASE],
    ['PGUSER', e.PG_USER],
    ['PGPASSWORD', e.PG_PASSWORD],
  ];
  process.stdout.write('export ' + pairs.map(([k, v]) => `${k}=${sq(v)}`).join(' ') + '\n');
} else if (target === 'supa') {
  const url = String(e.SUPABASE_FAILOVER_DB_URL || '')
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/\?&/g, '?')
    .replace(/&&/g, '&')
    .replace(/[?&]$/g, '');
  process.stdout.write(`export PGURL=${sq(url)} PGSSLMODE=require\n`);
} else {
  process.stderr.write('target must be local|supa\n');
  process.exit(2);
}
