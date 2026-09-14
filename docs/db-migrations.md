# Database migrations

PostgreSQL DDL is owned by **node-pg-migrate**, one plain-SQL file per change in
`migrations/pg/`. Kysely is the query builder, never the DDL owner. This document covers
the squashed baseline, the guard rails around it, and the recovery procedure — read it
before touching `migrations/pg/`, the `pgmigrations` ledger, or any deployment's schema.

---

## The 2026-07-30 near-miss (why this file exists)

`npm run db:migrate` failed with an ordering error. Investigating it turned up a far
worse state than a bad sort: **the ledger and the migration directory had nothing in
common.**

- `pgmigrations` held **20 rows** naming files that had already been deleted (the
  SQL-Server-era set, retired when the schema was rewritten for PostgreSQL).
- `migrations/pg/` held **21 files, none of them recorded** — including
  `1781200000000_baseline-schema.sql`, a 4,466-line *full schema* baseline.

So the runner believed nothing on disk had ever been applied. A single
`--no-check-order` — the obvious "fix" for the error it was reporting — would have
replayed a complete schema creation over a live clinic database. node-pg-migrate's order
check was the only thing standing in the way, and it was reporting the problem in a form
that invited exactly the wrong remedy.

Nothing in the toolchain surfaced the drift. That is the actual defect, and the guard
rails below are the fix.

---

## Current model: one squashed baseline

`migrations/pg/` starts from one squashed baseline, with ordinary incremental files after
it:

```
1783100000000_baseline-2026-07-30.sql   <- the squash
1785700253568_notnull-timepoint-and-visit-flags.sql
1787000000000_cdc-capture-clock-timestamp.sql
1787000100000_oauth-account-email.sql
1788812600000_diagnoses-unique-workid.sql
1788812700000_expenses-created-at.sql
```

The baseline is the entire application schema as of 2026-07-30, generated from the live
database and verified to reproduce it exactly. Every later file must sort after it. The
ledger holds one row per file. The 21 retired pre-squash files remain in git history at
commit **`f83e10a`**.

What a fresh database gets from it: 80 tables, all constraints and indexes, the 2 app
functions (`cdc_capture`, `set_updated_at`), all 99 CDC/`updated_at` triggers, the 24
reverse-sync sequences carrying `INCREMENT BY 2` (local ODD ids / Supabase EVEN — see
`sync-cdc.md`), extensions `citext` + `pg_trgm`, and the product seed rows (CDC sink
registry, WhatsApp group defaults, shade vocabularies, clinic-wide slideshow templates).

What it does **not** include, unchanged from before the squash: clinical lookup
vocabularies and `options` beyond the two WhatsApp rows. A brand-new clinic still needs a
separate data load — `options` holds live secrets (e.g. the Telegram `gram_session`) and
must never be seeded from a repo file.

---

## Three guard rails

**1. The baseline refuses to run on a populated database.** A `DO $guard$` block at the
top of the file raises if `public.patients` exists. Replaying the schema over a live
deployment is now impossible even if someone runs the file by hand.

**2. `db:check` refuses to certify a drifted ledger, and `db:migrate` runs it first.**
`predb:migrate` is wired in `package.json`, so a drifted ledger aborts the migrate before
node-pg-migrate is invoked. The check distinguishes:

| State | Verdict |
|---|---|
| File newer than every applied migration | **pending** — normal, migrate applies it |
| File older than the newest applied migration, unrecorded | **error** — applied out-of-band, or slipped in behind history |
| Ledger row whose file no longer exists | **error (ghost)** — history rewritten without re-stamping |
| Ledger and disk fully disjoint | **error** — the 2026-07-30 failure mode, named explicitly |

**3. `db:baseline:stamp` cannot mark an empty database as migrated.** It refuses unless
`public.patients` exists, so the repair tool can never be used to skip a real install.

---

## Commands

```bash
npm run db:check              # read-only: is the ledger consistent with the disk?
npm run db:migrate            # runs db:check first, then applies pending migrations
npm run db:migrate:down       # reverse the most recent migration
npm run db:new-migration      # scaffold migrations/pg/<ts>_<name>.sql
npm run db:codegen            # regenerate types/db.d.ts after any schema change

npm run db:baseline:stamp     # REPAIR: record the baseline as applied, without running it
npm run db:baseline:build     # author a NEW squashed baseline from the live schema
npm run db:baseline:verify    # prove a baseline reproduces the live schema (scratch DB + diff)
```

### Adding a migration (the normal path)

1. `npm run db:new-migration` — the timestamp prefix must sort **after** the baseline.
2. Write `-- Up Migration` / `-- Down Migration` sections.
3. **Mirror any DDL to Supabase in the same change** — add
   `migrations/supabase/<name>-<date>.sql`. CDC replicates row DATA only, never DDL; a
   missing mirror column silently drops that field on upsert (`sync-cdc.md`).
4. `npm run db:migrate`, then `npm run db:codegen`.
5. **Deploying to a live server: apply DDL only against code that already tolerates it.**
   A column drop needs the service restarted onto the new build first, or the running
   build's `SELECT`/`INSERT` of the dropped column 500s. Order: build → restart → migrate.

### Backfilling a new column on a CDC-mirrored table

A migration that only adds DDL is invisible to CDC. A migration that also **backfills rows**
is not: every `UPDATE` fires `trg_cdc_capture` (one `change_log` row each) *and*
`trg_set_updated_at`, which stamps `updated_at = localtimestamp` — so a one-line backfill
across a few thousand rows both floods the sink and destroys the table's real modification
times, which is what the `updated_at` LWW guard replicates on.

Run the backfill under the sink's own origin guard instead, and have each side compute the
value itself:

```sql
SET app.cdc_origin = 'reverse';   -- LOCAL side ('failover' on the Supabase mirror)
UPDATE expenses SET created_at = expense_date::timestamp WHERE created_at IS NULL;
RESET app.cdc_origin;
```

`cdc_capture()` and `set_updated_at()` both return early under that setting (their echo-loop
guard — see `sync-cdc.md`), so the backfill neither captures nor re-stamps. The mirror half
carries the identical expression under `app.cdc_origin = 'failover'`, so both databases land
on the same values with zero replication traffic. Use plain `SET`, not `SET LOCAL`: the file
must behave the same when applied by hand through `psql`, where `SET LOCAL` outside a
transaction warns and silently does nothing.

Precedent: `1788812700000_expenses-created-at.sql` + its mirror half (verified afterwards:
0 `change_log` rows, `updated_at` non-null count unchanged).

### Recovering a ledger that lost its rows

Symptom: `db:check` reports ghosts, or the ledger is empty while the schema is present.

```bash
npm run db:check                          # confirm the diagnosis
node --env-file=.env scripts/db-baseline-stamp.mjs --dry-run
npm run db:baseline:stamp                 # backs up the old rows to C:\DBBackup first
npm run db:check                          # expect: matches disk
```

Never "fix" this by running the baseline, and never by passing `--no-check-order`.

### Squashing again later

Only when the file count genuinely warrants it, and never casually — other deployments
are stamped against the current baseline's filename.

```bash
node --env-file=.env scripts/db-baseline-build.mjs migrations/pg/<ts>_baseline-<date>.sql
node --env-file=.env scripts/db-baseline-verify.mjs migrations/pg/<ts>_baseline-<date>.sql
# verify must print "IDENTICAL" and "GUARD works" before you proceed
rm  migrations/pg/<every older file>
npm run db:baseline:stamp
npm run db:check
```

`db-baseline-verify.mjs` builds a throwaway database from the baseline, diffs its schema
against live, and separately proves the guard fires on a populated database. It needs a
superuser to `CREATE DATABASE` (the app role has neither SUPERUSER nor CREATEDB) and
reads it from `C:\pg18-migration\super_pw.txt`.

A raw `pg_dump` is **not** directly usable as a migration. `db-baseline-build.mjs` exists
because of these transformations, each of which is a real failure if skipped:

- `\restrict` / `\unrestrict` (new in pg_dump 18) are psql meta-commands — hard syntax
  errors through the `pg` driver.
- `set_config('search_path', '', false)` would break node-pg-migrate's own unqualified
  `INSERT INTO pgmigrations` in the same session.
- `SET transaction_timeout` is PG18-only; dropped so the baseline still applies on 17.x.
- `--schema=public` must **not** be passed: extensions are database-level objects, so
  that filter silently omits `CREATE EXTENSION citext / pg_trgm`, which citext columns
  and trigram indexes make mandatory.
- `pg_stat_statements` is not a trusted extension (needs superuser), so it is wrapped to
  be skippable — a fresh install running as the app role must not die on a
  monitoring-only dependency.

---

## The Supabase mirror is NOT squashed

`migrations/supabase/` stays a chronological set of hand-applied files with no ledger —
each is applied once via `SUPABASE_FAILOVER_DB_URL`. Ordering rule, which is the reverse
of intuition for drops:

- **Additive** DDL goes on the mirror **first**, so the forward upsert has somewhere to
  land.
- **Subtractive** DDL (a column drop) goes on the mirror **last** — the failover sink
  builds its column list from the local row, so dropping on the mirror first would make
  the sink upsert a column that no longer exists there.

---

## Change absorbed into the baseline without its own committed file

`invoices.actual_amount` / `invoices.actual_cur` were dropped on 2026-07-30, hours before
the squash, so their migration file existed only in the working tree and is not in git
history. The reasoning, recorded here instead:

Both columns were superseded by the dual-currency cash split (`usd_received` /
`iqd_received`) and no write path had populated either since; the last row to carry a
value dates from 2025-12-10. On the read side they fed two Works-page payment-history
columns that showed `-` for every modern payment, and the always-NULL `actual_cur` was
passed as the Change column's currency, where a `|| 'USD'` fallback mislabelled change
(always handed back in IQD) as USD.

2,134 rows carried a value. They were near-fully redundant with the surviving cash split
— 1,913 of the 2,030 `actual_amount` values equalled `iqd_received` and 113 equalled
`usd_received`, leaving **4 rows** whose `actual_amount` appears nowhere else. All 2,134
were dumped first to:

```
C:\DBBackup\invoices-actual-columns-2026-07-30.restore.sql   (runnable restore script)
C:\DBBackup\invoices-actual-columns-2026-07-30.csv
```

The mirror drop is `migrations/supabase/drop-invoice-actual-columns-2026-07-30.sql`.
