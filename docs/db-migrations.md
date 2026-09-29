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
The `pgmigrations` ledger is **not** in the baseline: node-pg-migrate creates it before the
first file runs (see *Fresh install* below).

`1789460400000_seed-code-constant-lookups.sql` adds the two lookup tables whose ids are
**code constants** and FK targets: `work_statuses` (`WORK_STATUS`) and `patient_types`
(`PATIENT_TYPE_IDS`, English + Arabic names). Every row is `ON CONFLICT DO NOTHING`, so it
is a no-op on a deployment that already has them, including one whose names were edited in
Settings → Lookups. `services/database/fresh-install.test.ts` fails the gate if a new id is
added to either constant without a seed row.

`1789460500000_seed-product-constants.sql` adds everything else the CODE names, by id or by
value, that an empty install was missing (found 2026-09-29 while building `db:setup` and the
demo seeder on a throwaway PG 18): `work_types` (`WORK_TYPE_IDS`), `tooth_numbers` (codes =
the chart SVG names), `document_types` + the default receipt template row (receipt-service
renders type 1 with no file fallback, so every "print receipt" failed), expense categories 5
`Employees` / 7 `Lab` (`EMPLOYEE_EXPENSE_CATEGORY` / `LAB_EXPENSE_CATEGORY`), the `Doctor`
position every doctor list filters on, the `Clinic` intake pseudo-doctor, and the 0..366
`numbers` tally that `fillCalendar()` needs. Same posture: `ON CONFLICT DO NOTHING` /
`WHERE NOT EXISTS`, a no-op on existing deployments; `fresh-install.test.ts` guards each.

What stays **out** of migrations: the clinic's own vocabularies (time slots, appointment types,
wires, alert types, the other expense categories, …), its identity and the first user. Those
come from `npm run db:setup` (below). `options` holds live secrets (e.g. the Telegram
`gram_session`) and must never be seeded from a repo file.

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
| No ledger and **no tables at all** in `public` | **fresh install** — every file pending; migrate creates the ledger and applies them |
| No ledger but tables present | **error** — with `public.patients`: the schema is there without its history, repair with `db:baseline:stamp`; without it: unknown state, investigate |
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

### Fresh install (a new deployment)

Point `PG_*` (or `DATABASE_URL`) at an **empty** database owned by the app role, then:

```bash
npm run db:check      # expect: "fresh install — the database is empty, all N migration(s) pending"
npm run db:migrate    # creates the ledger, applies the baseline and every later file
npm run db:check      # expect: "ledger matches disk"
```

The app role needs no superuser: `citext` and `pg_trgm` are trusted extensions, and
`pg_stat_statements` (monitoring only) is skipped with a NOTICE when it can't be created.
Then run the first-run setup:

```bash
npm run db:setup      # interactive; or: npm run db:setup -- --yes --admin-user … --admin-password … \
                      #   --clinic-name … --message-name … --message-name-ar … --whatsapp-group … --currency IQD
```

It creates the first admin (only while `users` is empty), sets the clinic's identity and
default work currency, fills each starter vocabulary **only while its table is still empty**
(`services/setup/starter-vocabulary.ts`), and generates the appointment calendar. Every step is
safe to repeat, and it ends by listing what still needs a human — including any identity row
that still holds the original clinic's wording (the baseline seeded "Dr. Shwan orthodontic
clinic" into the message-name rows so that clinic's reminders stayed byte-identical; a new
center that skips setup would send its patients another clinic's name).

For a demo or test install, `npm run db:seed:demo` then fills the EMPTY install with a
fictional clinic — see [demo-data.md](demo-data.md).

Until 2026-09-28 this path did not work at all, for three reasons found by the F9 frontend
audit: `db:check` refused any database without a ledger; the baseline also created
`pgmigrations`, which node-pg-migrate had just created (`relation "pgmigrations" already
exists`); and pg_dump's `COMMENT ON EXTENSION pg_stat_statements` ran even when the extension
had been skipped. `db:baseline:verify` missed the second one because it applied the Up section
to a bare database; it now creates the ledger first, exactly as node-pg-migrate does.

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

### Outstanding on the PRODUCTION database — the patient-type backfill

`scripts/backfill-patient-types.mts` has run on the **local/dev** database
(2026-07-16: 4,666 patients reclassified, legacy `patient_types` rows 6/7/8 retired). It has
**not** run on the Windows-service production database. Until it does, prod patients keep the
manually-picked `patient_type_id` values the derived classifier replaced, so their type will not
agree with their works.

Run it on the prod box AFTER the deploy that carries `classifyPatient`, so no legacy writer can
resurrect an old value between the backfill and the code:

```powershell
# On the production server, in C:\ShwNodApp
node --import tsx scripts/backfill-patient-types.mts            # DRY RUN — prints the plan
node --import tsx scripts/backfill-patient-types.mts --apply    # write it
```

Idempotent: a second run reports 0 changes. It runs against LOCAL only — the failover sink
forwards the row updates and the row-6/7/8 deletes to the Supabase mirror on its own, so there is
no mirror half to apply by hand.

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

`db-baseline-verify.mjs` builds a throwaway database from the baseline (creating the ledger
first, the way node-pg-migrate does), diffs its schema against live, and separately proves
the guard fires on a populated database. It needs a
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
  monitoring-only dependency. Its `COMMENT ON EXTENSION` line is dropped for the same
  reason (it is not inside the wrapper).
- The `pgmigrations` ledger is excluded from the dump (`db-baseline-dump.mjs`): it is
  node-pg-migrate's table, and a baseline that creates it cannot install on an empty
  database.

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
