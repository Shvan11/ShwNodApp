/**
 * Emit shell `export …` lines with libpq env vars for psql, read from .env — so scripts/psql.sh can
 * connect to the app's LOCAL or SUPABASE DB without secrets ever appearing on a command line.
 *   node scripts/_pgenv.mjs local   → PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
 *   node scripts/_pgenv.mjs supa    → PGURL (sslmode stripped) + PGSSLMODE=require
 * Internal helper for scripts/psql.sh; not used by the app.
 */
// _pg-connection.mjs loads .env itself (quietly — dotenv 17's banner would pollute
// the eval'd output) and resolves DATABASE_URL / PG_* exactly as the app does.
import { resolveLocalPg } from './_pg-connection.mjs';

const e = process.env;
const target = process.argv[2];

// POSIX single-quote a value: wrap in '…', and turn each embedded ' into '\''.
const sq = (s) => "'" + String(s == null ? '' : s).split("'").join("'\\''") + "'";

if (target === 'local') {
  const c = resolveLocalPg();
  const pairs = [
    ['PGHOST', c.host],
    ['PGPORT', c.port],
    ['PGDATABASE', c.database],
    ['PGUSER', c.user],
    ['PGPASSWORD', c.password],
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
