/**
 * Reconcile the Supabase failover mirror against local by PRIMARY KEY, and repair it through the
 * normal CDC path.
 *
 * WHY THIS CAN EXIST AT ALL: `change_log` rows are POINTERS, not payloads — `FailoverSink.upsert`
 * re-reads the live local row by pk at apply time. So re-inserting a `(failover, tbl, pk, 'U')`
 * row is a complete repair of that row, with no bulk push, no full reload, and no second code path
 * that could disagree with the sink about how a row is written. The engine drains it like any
 * other change.
 *
 * WHAT IT CANNOT FIX, BY DESIGN: a row present on the MIRROR but absent locally. That is either a
 * local delete whose capture was lost, or a row the two-way reverse sink has not yet brought back —
 * and those two are indistinguishable from here. Deleting on a guess would destroy portal-authored
 * data, so extras are REPORTED and never touched.
 *
 *   node scripts/reconcile-mirror.mjs              # dry run: report the divergence
 *   node scripts/reconcile-mirror.mjs --apply      # enqueue the missing pks into local change_log
 *   node scripts/reconcile-mirror.mjs --table works --apply
 *
 * Ordering: enqueued rows are stamped in FK-topological order (parents before children) so a
 * child does not spend cycles being deferred while its parent waits behind it in the same batch.
 * The engine's per-row deferral still covers whatever the sort cannot (cycles, self-references).
 */
import pg from 'pg';
import { resolveLocalPg } from './_pg-connection.mjs';

const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--table');
  return i > -1 ? process.argv[i + 1] : null;
})();

const mirrorUrl = process.env.SUPABASE_FAILOVER_DB_URL;
if (!mirrorUrl) {
  console.error('SUPABASE_FAILOVER_DB_URL missing');
  process.exit(1);
}

// Explicit timeouts on BOTH clients. The first cut of this script had none, and the Supabase
// pooler silently dropped its connection mid-run: `pg` sat waiting on a socket nobody would ever
// answer, with zero CPU and no query visible in pg_stat_activity. Same rule as every outbound call
// in this repo (CLAUDE.md §Conventions) — a dropped packet must fail, not hang.
const TIMEOUTS = { connectionTimeoutMillis: 15_000, statement_timeout: 120_000, query_timeout: 120_000 };

const local = new pg.Client({ ...resolveLocalPg(process.env), ...TIMEOUTS });
const mirror = new pg.Client({
  connectionString: mirrorUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
  ssl: { rejectUnauthorized: false },
  ...TIMEOUTS,
});

const q = async (c, sql, params) => (await c.query(sql, params)).rows;
const quote = (id) => '"' + String(id).replace(/"/g, '""') + '"';

await local.connect();
await mirror.connect();

// ---- 1. the captured set, from the same catalog query the sink itself uses (cdc-schema.ts) ----
const pks = await q(
  local,
  `SELECT c.relname AS tbl, a.attname AS pk
     FROM pg_trigger tg
     JOIN pg_class c     ON c.oid = tg.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN pg_index i     ON i.indrelid = c.oid AND i.indisprimary AND array_length(i.indkey::int[], 1) = 1
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE tg.tgname = 'trg_cdc_capture'
    ORDER BY 1`
);

// ---- 2. FK-topological order, so parents are enqueued before their children ----
const deps = await q(
  local,
  `SELECT c.relname AS child, p.relname AS parent
     FROM pg_constraint k
     JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_class p ON p.oid = k.confrelid
    WHERE k.contype = 'f' AND c.relname <> p.relname`
);
const parentsOf = new Map(pks.map((r) => [r.tbl, new Set()]));
for (const d of deps) if (parentsOf.has(d.child) && parentsOf.has(d.parent)) parentsOf.get(d.child).add(d.parent);

const rank = new Map();
for (let pass = 0; pass < pks.length && rank.size < pks.length; pass++) {
  for (const { tbl } of pks) {
    if (rank.has(tbl)) continue;
    if ([...parentsOf.get(tbl)].every((p) => rank.has(p))) rank.set(tbl, pass);
  }
}
for (const { tbl } of pks) if (!rank.has(tbl)) rank.set(tbl, pks.length); // cycle: last, engine retries

// ---- 3. per-table pk diff ----
const targets = pks.filter((r) => !ONLY || r.tbl === ONLY).sort((a, b) => rank.get(a.tbl) - rank.get(b.tbl));
const plan = [];
let extras = 0;

/**
 * Exact set comparison in 32 bytes. Hashing the ordered pk list SERVER-side means an identical
 * table — 59 of the 73 — costs one md5 each way instead of shipping its whole pk column across the
 * internet. Only a table whose hash differs pays for the full list.
 *
 * `COLLATE "C"` is load-bearing: local is PG18 and the mirror PG17, and a collation-version
 * difference can order the same text differently on the two servers, which would hash two identical
 * sets to different digests and send this script chasing phantom divergence. Bytewise ordering is
 * version-stable.
 */
const fingerprint = (tbl, pk) =>
  `SELECT count(*)::int AS n, md5(coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '')) AS h
     FROM (SELECT ${quote(pk)}::text AS k FROM ${quote(tbl)}) s`;

let checked = 0;
for (const { tbl, pk } of targets) {
  let mineFp, theirsFp;
  try {
    [[mineFp], [theirsFp]] = await Promise.all([q(local, fingerprint(tbl, pk)), q(mirror, fingerprint(tbl, pk))]);
  } catch (e) {
    console.log(`  ${tbl.padEnd(28)} SKIPPED — ${e.message}`);
    continue;
  }
  checked++;
  if (mineFp.h === theirsFp.h) continue; // identical pk sets — nothing to fetch

  const listSql = `SELECT ${quote(pk)}::text AS k FROM ${quote(tbl)}`;
  const [mineRows, theirsRows] = await Promise.all([q(local, listSql), q(mirror, listSql)]);
  const theirs = new Set(theirsRows.map((r) => r.k));
  const mine = new Set(mineRows.map((r) => r.k));
  const missing = mineRows.map((r) => r.k).filter((k) => !theirs.has(k));
  const extra = theirsRows.map((r) => r.k).filter((k) => !mine.has(k));

  console.log(
    `  ${tbl.padEnd(28)} local ${String(mineFp.n).padStart(6)}  mirror ${String(theirsFp.n).padStart(6)}` +
      `  missing ${String(missing.length).padStart(4)}` +
      (extra.length ? `  EXTRA-ON-MIRROR ${extra.length} (not touched: ${extra.slice(0, 5).join(',')})` : '')
  );
  extras += extra.length;
  if (missing.length) plan.push({ tbl, missing });
}

const total = plan.reduce((n, p) => n + p.missing.length, 0);
console.log(`\n${checked} captured table(s) compared.`);
console.log(`${total} row(s) missing from the mirror across ${plan.length} table(s); ${extras} extra on the mirror.`);

// ---- 4. enqueue ----
if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to enqueue these into local change_log.');
} else if (total === 0) {
  console.log('\nNothing to enqueue.');
} else {
  // Stamp in table order, each table a millisecond after the last, so the drain's
  // `ORDER BY changed_at, id` walks parents before children.
  let seq = 0;
  let queued = 0;
  for (const { tbl, missing } of plan) {
    const stamp = `LOCALTIMESTAMP + make_interval(secs => ${(seq++ * 0.001).toFixed(3)})`;
    // DO NOTHING, never DO UPDATE: a genuine pending capture for this pk already says everything
    // this row would, and must keep its own changed_at (the drain's version guard reads it).
    const res = await local.query(
      `INSERT INTO change_log (sink, tbl, pk, op, changed_at)
       SELECT 'failover', $1, k, 'U', ${stamp} FROM unnest($2::text[]) AS k
       ON CONFLICT (sink, tbl, pk) DO NOTHING`,
      [tbl, missing]
    );
    queued += res.rowCount;
    console.log(`  queued ${String(res.rowCount).padStart(4)}/${String(missing.length).padStart(4)}  ${tbl}`);
  }
  console.log(`\n✅ enqueued ${queued} pointer row(s). The failover engine drains them on its next cycle.`);
}

await local.end();
await mirror.end();
