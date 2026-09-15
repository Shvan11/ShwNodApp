/**
 * Repair `aligner_sets.remaining_{upper,lower}_aligners` on sets written by the RETIRED SQL-Server
 * procedure, which counted a template aligner as consuming from the remaining count.
 *
 * THE FINDING (audit batch 3, "lower-severity"): 10 sets read exactly one short on each arch that
 * has a template batch. It is not a race and not a bug in the current code — the split is clean:
 *
 *     templated sets created BEFORE the 2026-05-30 PG migration : 16, of which 10 drift
 *     templated sets created AFTER  it                          : 12, of which  0 drift
 *     sets with no template, either era                         : 101, of which 0 drift
 *
 * `usp_AddAlignerBatch` decremented `remaining` by the batch's FULL upper/lower count; the
 * TypeScript rewrite (7aa9007) decrements `count - (has_template ? 1 : 0)`, and
 * `deleteBatch` restores on the same basis. So the old rows are stale under a rule that no longer
 * exists. (The 6 pre-migration sets that do NOT drift are the ones whose batches were edited after
 * the migration, rewriting `remaining` under the new rule.)
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION. The correction is visible to the front desk: 9 of the
 * 10 sets currently read `remaining = 0` ("fully batched") and would become `1` ("one aligner still
 * to batch"). Under the current rule that is the truth — those sets cannot presently create their
 * final batch — but whether those cases are FINISHED is a clinical judgement about specific
 * patients, not something a migration should decide on the clinic's behalf. Run it when the owner
 * has decided.
 *
 *   node scripts/fix-template-remaining-drift.mjs            # dry run: list the affected sets
 *   node scripts/fix-template-remaining-drift.mjs --apply    # correct them
 *
 * CDC: a normal local UPDATE, so the corrections replicate to the Supabase mirror like any other
 * write. Idempotent — a second run finds nothing.
 */
import pg from 'pg';
import { resolveLocalPg } from './_pg-connection.mjs';

const APPLY = process.argv.includes('--apply');

const DRIFTED = `
  WITH consumed AS (
    SELECT b.aligner_set_id,
           sum(b.upper_aligner_count - CASE WHEN b.has_upper_template THEN 1 ELSE 0 END) AS up_consumed,
           sum(b.lower_aligner_count - CASE WHEN b.has_lower_template THEN 1 ELSE 0 END) AS lo_consumed
      FROM aligner_batches b GROUP BY 1)
  SELECT s.aligner_set_id,
         to_char(s.creation_date, 'YYYY-MM-DD') AS created,  -- formatted in SQL: a JS Date here
                                                             -- would render the wall-clock day in UTC
         s.remaining_upper_aligners   AS rem_u,
         s.remaining_lower_aligners   AS rem_l,
         s.upper_aligners_count - coalesce(c.up_consumed, 0) AS want_u,
         s.lower_aligners_count - coalesce(c.lo_consumed, 0) AS want_l
    FROM aligner_sets s
    JOIN consumed c ON c.aligner_set_id = s.aligner_set_id
   WHERE s.upper_aligners_count - coalesce(c.up_consumed, 0) <> s.remaining_upper_aligners
      OR s.lower_aligners_count - coalesce(c.lo_consumed, 0) <> s.remaining_lower_aligners
   ORDER BY s.aligner_set_id`;

const client = new pg.Client({
  ...resolveLocalPg(process.env),
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
});
await client.connect();

const { rows } = await client.query(DRIFTED);
if (rows.length === 0) {
  console.log('Nothing to correct — every set already matches total − consumed.');
} else {
  console.log(`${rows.length} set(s) drift from the current rule:\n`);
  console.log('   set  created      upper          lower');
  for (const r of rows) {
    console.log(
      `  ${String(r.aligner_set_id).padStart(4)}  ${r.created}` +
        `   ${String(r.rem_u).padStart(3)} → ${String(r.want_u).padEnd(3)}` +
        `    ${String(r.rem_l).padStart(3)} → ${String(r.want_l)}`
    );
  }
}

if (rows.length > 0 && APPLY) {
  // One statement, recomputed server-side rather than from the ids read above, so a concurrent
  // batch write between the read and the write cannot be clobbered by a stale figure.
  const res = await client.query(`
    WITH consumed AS (
      SELECT b.aligner_set_id,
             sum(b.upper_aligner_count - CASE WHEN b.has_upper_template THEN 1 ELSE 0 END) AS up_consumed,
             sum(b.lower_aligner_count - CASE WHEN b.has_lower_template THEN 1 ELSE 0 END) AS lo_consumed
        FROM aligner_batches b GROUP BY 1)
    UPDATE aligner_sets s
       SET remaining_upper_aligners = s.upper_aligners_count - coalesce(c.up_consumed, 0),
           remaining_lower_aligners = s.lower_aligners_count - coalesce(c.lo_consumed, 0)
      FROM consumed c
     WHERE c.aligner_set_id = s.aligner_set_id
       AND (s.upper_aligners_count - coalesce(c.up_consumed, 0) <> s.remaining_upper_aligners
         OR s.lower_aligners_count - coalesce(c.lo_consumed, 0) <> s.remaining_lower_aligners)`);
  console.log(`\n✅ corrected ${res.rowCount} set(s). The change replicates to the mirror via CDC.`);
} else if (rows.length > 0) {
  console.log('\nDry run. Re-run with --apply to correct them.');
}

await client.end();
