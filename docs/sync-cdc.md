# Sync (unified CDC) — design & runbook

> Full mechanics, procedures, and history for the CDC sync system (`services/sync/cdc/`). The standing invariants that affect everyday work (DDL parity, adding captured tables, origin guards, kill switches) are summarized in `CLAUDE.md` §Sync — this doc is the detail behind them. Read this before changing anything under `services/sync/`, the CDC triggers/migrations, or the Supabase mirror.

## Overview

**One change feed per direction, one Supabase database.** DB triggers capture every row change *once* into a coalescing `change_log`, and an engine replicates each sink's slice to its destination:

- **failover** — raw 1:1 mirror of the full DB into the **single** Supabase database (local → Supabase). This is the primary Supabase sink and the aligner portal's **future serving source** (the portal will read the raw tables directly). The sink keeps the name `failover` for its live `cdc_sink_control`/`change_log` rows, but it's the **primary mirror, not a fallback**. Runs permanently; must stay complete/live.
- **reverse** — the **two-way** path (Supabase → local), the symmetric mirror image of `failover`. A web/portal edit on Supabase is captured into a `change_log` that lives **on Supabase** and applied back to local through a dedicated max-2 pool. **Whole-row last-write-wins** by `updated_at` (forward `>=`, reverse `>` → ties to local); deletes propagate both ways. Off by default (`REVERSE_SYNC_ENABLED`). See [Reverse sync](#reverse-sync-two-way--supabase--local).
- **dolphin** — temporary, see [Dolphin sync](#dolphin-sync-temporary).

### Retired predecessors (do not reintroduce)

The curated snake_case **portal** projection (`portal-sink.ts` + `sync-fetch.ts`) and the **old** reverse path (`sync-engine.ts`, `reverse-sync-poller.ts`, `POST /api/sync/webhook`) were removed when consolidating to one database. The current **reverse v2** is a *different* implementation — same CDC engine, a `change_log` on Supabase — not those files; don't reintroduce them or the app-level `SyncQueue` enqueue. `aligner-portal-external` is deprecated until rewritten against the raw schema. This is *not* logical replication and *not* nightly reloads.

## Code map

`services/sync/cdc/`:

- `engine.ts` — generic per-sink drain: batched, coalescing, version-guarded delete, anti-bloat breaker; `EngineOpts.source` selects the feed DB — local default, Supabase for reverse.
- `cdc-schema.ts` — shared PK/generated/`updated_at` discovery + the LWW `ON CONFLICT` clause builder (`lwwUpdateClause`).
- `supabase-pool.ts` — the two SHARED Supabase pools — forward-write tagged `app.cdc_origin='failover'`, plain reverse-read — plus `teardownSupabasePools()`.
- `failover-sink.ts` — raw `pg` upsert, LWW on `updated_at` tables.
- `reverse-sink.ts` — Supabase→local apply under `origin='reverse'`.
- `index.ts` — `startCdc`/`stopCdc`/`drainCdcNow`, wired into boot + `gracefulShutdown`.

## On/off & kill switches

There are **two independent switches, and conflating them cost a week of mirror data on 2026-09-08.** Keep them straight:

| switch | scope | what it controls |
|---|---|---|
| env flag (`FAILOVER_SYNC_ENABLED`, `DOLPHIN_SYNC_ENABLED`, `REVERSE_SYNC_ENABLED`) | **this process** | whether *this* process runs a drainer. Default off in sandbox. |
| `cdc_sink_control.enabled` | **the database, shared by every process** | whether the trigger RECORDS changes at all. |

**The env flag must never write the control row.** `startCdc()` used to call `disableSinkCapture()` for a sink whose flag wasn't `'true'`, on the reasoning that capture with no drainer just grows `change_log`. But that row is shared by every process pointing at the DB — a `tsx` one-off, a test run, a second checkout, a dev box on the same host — and `cdc_capture()` records **nothing** while it is false, with no catch-up scan anywhere. One sibling process booting without the env var silently blinded the live Windows service; the rows written during that window are absent from `change_log` entirely and unrecoverable (see [F1 in the services audit](./services-audit.md)). Since 2026-09-15 an env-disabled sink leaves capture exactly as it found it and only declines to drain.

Immediate kill switch without restart (the operator action that *does* stop recording): `UPDATE cdc_sink_control SET enabled=false WHERE sink='failover';`. **The `reverse` sink's `cdc_sink_control`/`change_log` live on SUPABASE**, so its kill switch runs THERE: `UPDATE cdc_sink_control SET enabled=false WHERE sink='reverse';`. Anything recorded before the switch stays in `change_log` and drains when you turn it back on; anything written *while* it is off is lost from the mirror and needs a reload — which is what `stale` records.

**`stale` is cleared only by you.** It means "changes were lost, a full reload is required", so it deliberately survives any number of restarts. `CdcEngine.start()` used to clear it on every boot, which turned that standing alarm back to green on the next service restart and is the single reason the 2026-09-08 divergence stayed invisible.

### The no-drainer watchdog

`enforceCaptureBound()` (`engine.ts`) is the breaker, and it runs from **two** places: every drain cycle, and — for a sink whose capture is on but which has no engine in this process — a 60 s timer started by `startCdc()`. The second exists because a breaker that lives inside the drain loop cannot fire when there is no drain loop, which is precisely the configuration (capture on, nobody draining) where `change_log` would otherwise grow unattended. The check costs one indexed PK read while capture is off, so an install that mirrors nothing pays essentially nothing. The reverse sink's half runs every 10th tick over a one-shot pool, so a reverse-disabled install holds no idle Supabase connection.

It bounds **size, not age.** An old backlog means the sink is broken, but disabling capture over it would *widen* the divergence it is reporting — every subsequent write would go unrecorded too. Age instead gets a throttled server-side warning (`STUCK_BACKLOG_WARN_SEC`, 1 h, at most once per 15 min per sink) and a number on the status card; the operator decides. Only size, the thing that actually consumes disk, trips the breaker.

## Reconciling a divergent mirror — `scripts/reconcile-mirror.mjs`

```bash
node scripts/reconcile-mirror.mjs                    # dry run: exact per-table pk diff
node scripts/reconcile-mirror.mjs --apply            # enqueue the missing pks
node scripts/reconcile-mirror.mjs --table works --apply
```

**Why a 162-row repair needed no bulk push at all.** `change_log` rows are POINTERS, not payloads —
`FailoverSink.upsert(table, pk)` re-reads the live local row at apply time. So re-inserting a
`(failover, tbl, pk, 'U')` row is a *complete* repair of that row, drained by the normal engine
through the normal sink. There is no second write path that could disagree with the sink about how
a row is written, and the operation is idempotent (the upsert is LWW-guarded), so a re-run is free.

How it works: it reads the captured set from the same `pg_trigger` catalog query the sink itself
uses (`cdc-schema.ts`), then compares each table by a **server-side md5 of its ordered pk list** —
32 bytes on the wire, so the ~59 identical tables cost one hash each way and only a genuinely
divergent table pays to ship its pk column. Enqueues are stamped in **FK-topological order** so
parents precede children.

Two things to know before trusting a run:
- **`COLLATE "C"` in the fingerprint is load-bearing.** Local is PG18, the mirror PG17, and a
  collation-version difference orders the same text differently on the two servers — which would
  hash two *identical* sets to different digests and send you chasing phantom divergence.
- **Rows present on the MIRROR but absent locally are reported and never touched.** That state is
  either a lost local delete or a row the two-way reverse sink has not brought back yet, and the two
  are indistinguishable from here; deleting on a guess would destroy portal-authored data.

**Run of record — 2026-09-15.** Repaired the F1 blackout: 162 rows across 14 tables (`expenses` 5,
`patients` 3, `stand_sales`/`stand_stock_movements`/`stand_sale_items` 1 each, `time_points` 4,
`works` 10, `appointments` 23, `invoices` 14, `message_status_history` 55, `time_point_images` 32,
`visits` 9, `work_items` 2, `work_item_teeth` 2; 0 extras). 155 enqueued — the other 7 were the
already-pending poison rows, skipped by `ON CONFLICT DO NOTHING` so they kept their own
`changed_at`. Drained in ~12 s, and **the 7 poison rows resolved themselves** once their parents
landed. Verified by re-diff: 0 missing, 0 extra across all 73 captured tables.

**Running it:** `npm run sync:reconcile` (dry run) / `npm run sync:reconcile:apply`. Both load `.env`,
so `SUPABASE_FAILOVER_DB_URL` and the local PG block come from the same place the server reads them.

### The scheduled half — `services/sync/cdc/drift-check.ts`

The script is the *repair*; detection is on a timer inside the app. `startDriftWatch()` runs from
`startCdc()` whenever a failover engine is live in this process (so an install that mirrors nothing
compares nothing, and a sibling process cannot duplicate the sweep): first pass 5 minutes after boot,
then every `FAILOVER_DRIFT_CHECK_HOURS` (default 24, `0` disables).

It compares **row counts per captured table, both sides** — one `count(*)` each, sent as a single
`UNION ALL` so 73 tables cost one round trip rather than 73 over the internet. That is deliberately
the cheap half of the script's comparison: a count difference is proof of divergence, and it is what
the blackout actually produced. The exact-set case (counts equal, membership different — which needs
a missing row *and* an extra row to hide behind each other) is the script's md5 fingerprint, and is
opt-in here via `FAILOVER_DRIFT_DEEP=true` because that one scans every row on both sides.

**Report-only, on purpose.** A divergence logs at `error` level naming the tables and the repair
command, and lands on the Settings card (`drift` on `GET /api/sync/supabase-status` — a green
"Mirror matches local" line when clean, so "no news" is no longer indistinguishable from "never
ran"). It does **not** auto-enqueue: the repair is safe and idempotent, but running it unattended
would quietly paper over a capture fault that needs its cause found, and the divergence would simply
come back — repaired each night, reported by nothing.

## Storage hygiene (`change_log`)

`change_log` is a **queue table**: the trigger inserts, the drain deletes, and the coalescing `ON CONFLICT (sink,tbl,pk) DO UPDATE` rewrites rows in place. Its physical size therefore tracks **churn, not row count** — on 2026-09-15 the live table held 7 rows in 760 kB (8 kB heap + **712 kB of index**), roughly 100× its content, because a btree never returns emptied pages to the OS on its own.

- **How big can it get?** `UNIQUE(sink,tbl,pk)` coalesces, so the row count can never exceed **one row per distinct row in the database**, per sink (73 captured tables ≈ 214k rows as of 2026-09-15). The real ceiling is `*_SYNC_MAX_BACKLOG` (default 100,000), enforced by the breaker above. Note the coalescing UPDATE **cannot be HOT** — it writes `changed_at`, which `idx_change_log_drain` indexes — so every coalesced change churns all three indexes. That is inherent to the `ORDER BY changed_at, id` drain ordering; aggressive vacuum is the answer, not an index change.
- **Autovacuum is pinned to a fixed threshold** on both DBs (`migrations/pg/1789380000000_cdc-change-log-bound.sql` + its Supabase half): `scale_factor 0.0 / threshold 200`, `cost_delay 0`. PostgreSQL's proportional default (`0.2`) grows the dead-tuple budget with the live row count exactly when the table is under pressure — at a 100k backlog it would tolerate ~20,000 dead tuples before vacuuming. Don't restore the default.
- **Reclaiming existing bloat needs a rebuild** — vacuum alone won't shrink an index. `REINDEX TABLE change_log;` (the migration ran it once locally: 712 kB → 48 kB). Safe to re-run whenever the table is near-empty, which is the normal state; it takes ACCESS EXCLUSIVE, so on a large backlog prefer `REINDEX INDEX CONCURRENTLY` per index. Worth a look if `pg_indexes_size('change_log')` is ever disproportionate to the row count. The Supabase half is not reindexed by migration — do it by hand there if it bloats.

## Don't regress

- Migrations `*_add-failover-cdc.sql` + `*_failover-cdc-fanout.sql` install a generic `cdc_capture()` trigger (`TG_ARGV = (pk_col, sink, …)`); `*_drop-portal-cdc-sink.sql` then removed the dead `portal` fanout. Now **all ~65 captured tables feed `failover` only**.
- **Dual origin guard (ACTIVE — reverse v2 uses it; do not delete either branch):** the loop is broken by tagging each side's sync-writes so the *other* side's triggers ignore them, and the guard covers **both** the capture trigger **and** the version (`updated_at`) trigger on each side. **Local:** `cdc_capture()` AND `set_updated_at()` both `RETURN` early under `SET LOCAL app.cdc_origin='reverse'` (the reverse sink sets this per apply txn) — no forward echo, and the incoming Supabase `updated_at` is preserved verbatim (the LWW keystone — re-stamping would make reverse applies always win). **Supabase:** the mirror-only `cdc_capture_remote()` AND `set_updated_at_remote()` skip under `app.cdc_origin='failover'` (the forward-write pool tags every connection) — no reverse echo, and the mirrored local `updated_at` is preserved. **Ordering hazard:** the forward-write GUC code MUST be live before `set_updated_at_remote` exists on Supabase, or live forward writes clobber every mirrored `updated_at`.
- **One clock on both sides (the LWW precondition).** Every timestamp is `timestamp WITHOUT time zone`, and both sides stamp with `LOCALTIMESTAMP`, which evaluates in **each server's own `TimeZone`**. So the mirror's zone must equal local's — and both must equal the app server's `TZ` (`config/process-env.ts`), which interprets every stored value. The mirror ran Supabase's default **UTC** until 2026-09-27 (audit FE-F5-1): every portal-inserted row (24 `LOCALTIMESTAMP` defaults) and every portal edit (`set_updated_at_remote()`) was stamped 3 h early, and because last-write-wins compares `updated_at` verbatim, a portal edit made within 3 h after a staff edit of the same row compared as *older* and was silently skipped locally. The fix is a **per-deployment database setting**, `migrations/supabase/mirror-timezone-2026-09-27.sql` (`ALTER DATABASE postgres SET timezone TO '<clinic zone>'` — new sessions only, so recycle the portal's PostgREST connection and restart the service; the file has the steps). **`services/sync/cdc/clock-check.ts`** enforces it: on every install, a minute after boot and then every 6 h, it compares the three clocks **by UTC offset** (reading each database's *database-level* default, so a stale pooled session can't mask a fix or a regression), logs `[cdc:clock] CLOCKS DISAGREE` with the exact fix, and shows the result on the status card. Don't "normalise" timestamps in the sinks instead: a row can carry a locally stamped `created_at` beside a mirror-stamped `updated_at`, and nothing records which is which. The three `now() AT TIME ZONE 'UTC'` defaults (`invoices.sys_start_time`, `patient_portal_auth.*`, `private_photos.marked_at`) are explicitly UTC on both sides by design and are unaffected.
- **Add a table** = add a `cdc_capture('<PKcol>', 'failover')` trigger in a migration — no app code (`failover` auto-discovers table→PK from `pg_trigger`, requiring a **single-column** PK). **Not captured:** sessions, sync/migration infra (`change_log`, `cdc_sink_control`, `pgmigrations`). (`private_photos` was composite-PK and excluded; it now carries a surrogate identity PK `id` (natural key kept as `UNIQUE`) and **is** captured — its Supabase mirror needs the matching `id`-PK schema + a one-time row load.)
- **Schema/DDL parity is manual — CDC replicates row DATA only, never DDL.** The Supabase mirror must stay **100% identical to local `shwan`** (the live PG), excepting only the deliberate sync-infra asymmetries: (a) each side's own feed tables (`change_log` + `cdc_sink_control` exist on **both** now — local drains `failover`/`dolphin`, Supabase drains `reverse`; the local-only tables are `dolphin_sync_map` + `integration_oauth_tokens` — as of 2026-07-21 `approval_requests` and `slideshow_configs` are no longer local-only, both promoted to the forward-only mirrored set by `migrations/pg/1782900000000_mirror-approvals-slideshow.sql`); (b) the triggers/functions are each side's own — local `cdc_capture()`/`set_updated_at()`, Supabase `cdc_capture_remote()`/`set_updated_at_remote()` (the reverse-set capture/version triggers, mirror-only); and (c) **the ONE intentional column divergence: identity sequences on the reverse set run `INCREMENT BY 2` — local ODD, Supabase EVEN — so sync inserts never collide** (see [Reverse sync](#reverse-sync-two-way--supabase--local)). **Everything else — every table, column, type, nullability, default/identity, PK/FK/unique/check constraint, and index — must match exactly.** So *any* DDL applied to local (`migrations/pg/*.sql` — add/drop/alter column, type change, new constraint/index, new captured table, identity change) **must be mirrored to Supabase in the same change**, or the mirror silently drifts (a missing column = that field is dropped on upsert; a missing identity = the bug we hit with `private_photos.id`). New captured tables also need their one-time row load on Supabase. (Session tables `staff_sessions`/`portal_sessions` + `pgmigrations` happen to exist on the mirror today — harmless; not load-bearing for parity.) Verify with the column/constraint/index/content-hash diff against both DBs; note the **PG-version artifact** — local is PG 18 (catalogs `NOT NULL` as named `pg_constraint` rows), Supabase is PG 17 (doesn't), so ignore `contype='n'` rows when diffing constraints. **The bulk push / full reload is run by the user** (harness blocks it), but small additive DDL can be applied directly via the `SUPABASE_FAILOVER_DB_URL`.
- **Circuit breaker:** backlog past `FAILOVER_SYNC_MAX_BACKLOG` disables capture and sets `cdc_sink_control.stale` (→ full reload needed). An outage is a non-event — deltas coalesce and the engine retries. It lives in `enforceCaptureBound()` and runs from the drain cycle **and** the no-drainer watchdog — don't inline it back into `drainOnce()`, that reintroduces the unattended-growth hole. Don't make it trip on backlog AGE either (see §On/off): disabling capture over a stuck sink widens the divergence instead of bounding it.
- The mirror is **RLS-locked** (server-side only) until the portal is rewritten to read it via RLS/views. The initial full load / any full reload are **run by the user** (`C:\pg18-migration\`), as are prod-schema migrations — Claude's harness blocks the bulk push.

## Status UI

Live sink status surfaces in Settings via `public/js/components/react/SupabaseStatusSettings.tsx` (polls `GET /api/sync/supabase-status`, which reports **both** `failover` and `reverse` cards). Above the cards sit two data-level banners from the same endpoint: `clock` (the clock-alignment guard — see §Don't regress, "One clock on both sides") and `drift` (the mirror row-count sweep).

## Reverse sync (two-way) — Supabase → local

The symmetric mirror image of forward CDC: the same `engine.ts` drains a `change_log` that lives **on Supabase** and `reverse-sink.ts` applies each change to local. Off by default (`REVERSE_SYNC_ENABLED`). Local hot path is untouched — **no new local triggers, no new local columns** (`db.d.ts` unchanged); all reverse *detection* is on Supabase, and reverse applies go through a dedicated **max-2** local pool that can't contend with the app's 10-conn pool.

- **Scope = the reverse set:** captured tables that already carry an `updated_at` column (the 25 from `…_unified-updated-at-and-cleanup.sql`; lookup tables have none → forward-only). Auto-discovered both sides, so a new `updated_at` table auto-enrolls — add a denylist to the discovery query if a sensitive table (e.g. `patient_portal_auth`) must stay forward-only.
- **Conflict = whole-row LWW by `updated_at`** via the `ON CONFLICT … WHERE` clause (`cdc-schema.ts#lwwUpdateClause`): forward `>=` (local wins ties), reverse `>` (Supabase overwrites only when strictly newer). Deletes are **unconditional both ways** (delete-vs-edit race is an accepted limitation — no tombstones yet). The keystone: the **version trigger honours the origin guard** on each side, so `updated_at` travels verbatim with the row (see the dual-origin-guard bullet above).
- **Odd/even identity sequences** keep the two DBs' mints disjoint: local `INCREMENT BY 2` ODD, Supabase EVEN (identity is `BY DEFAULT`, so explicit sync inserts don't advance the receiving sequence). Re-base in a **quiet window with forward backlog 0** (so `max(id)` agrees) — the local odd half is `migrations/pg/…_reverse-sync-version-guard-and-odd-pk.sql`, the Supabase even half is `migrations/supabase/reverse-cdc.sql §5`. Text-PK (`options`) / shared-PK (`patient_portal_auth`) tables have no own sequence → auto-skipped, still LWW-reverse-writable.
- **Supabase-only infra** (`migrations/supabase/reverse-cdc.sql`, committed; applied via `SUPABASE_FAILOVER_DB_URL`, NOT a node-pg-migrate file): `change_log` + `cdc_sink_control('reverse')`, `set_updated_at_remote()` + `cdc_capture_remote()` (both skip `origin='failover'`), attached to the reverse set. **Ordering:** deploy the forward-write-GUC code **before** applying this, or live mirror writes clobber `updated_at`.
- **Full reload now needs the origin flag:** a bulk reload not carrying `app.cdc_origin='failover'` will hit `set_updated_at_remote` and stamp fresh timestamps over every reloaded `updated_at` (gated by the flag, NOT by `cdc_sink_control`, so disabling the reverse sink alone is not enough). Run reloads with `PGOPTIONS=-c app.cdc_origin=failover` (or `DISABLE TRIGGER` the two `*_remote` triggers), then re-apply the even sequences. Still user-run.
- **Read-only web role** (`migrations/supabase/mirror-grants.sql`, committed, idempotent — prepping a full web app): a dedicated `mirror_rw LOGIN BYPASSRLS` role (creation + password **user-run/secret, never committed**) gets `SELECT` on all tables + `INSERT/UPDATE/DELETE` only on the reverse set (+ sequence `USAGE`), so "writable on Supabase ⟺ in the reverse set" holds even for a raw password connection. Caveat by design: connecting as the owner bypasses it (the forward sync/reload use the owner URL) — web writes MUST use `mirror_rw`.

## Dolphin sync (temporary)

A **third CDC sink** (`dolphin`) one-way-syncs the app's native timepoint/image rows into the legacy **Dolphin Imaging SQL Server DB** (`DolphinPlatform.dbo.Patients`/`TimePoints`/`TimePointImages`). The app already crops photos (`routes/api/photo-editor.routes.ts`) into the shared `working/` dir under Dolphin's `{personId}0{tpCode}.I{NN}` naming + local `time_points`/`time_point_images` rows; this sink fills the Dolphin **DB tables** (no files copied) so Dolphin Imaging can see them. **Meant to be deleted** once the native pipeline is trusted — remove `services/sync/cdc/dolphin-sink.ts`, its `index.ts` entry, the `DOLPHIN_SYNC_*` env block, and migration `*_add-dolphin-cdc-sink.sql`.

- **Off by default** (`DOLPHIN_SYNC_ENABLED`); kill switch `UPDATE cdc_sink_control SET enabled=false WHERE sink='dolphin';`.
- **Reuses the surviving mssql pool** (`services/database/pool.ts`, `ShwanNew`; Dolphin via three-part `DolphinPlatform.dbo.*` names) — the one runtime mssql dependency, and only when enabled.
- **Mapping table** `dolphin_sync_map(local_table, local_pk) → dolphin_id` (un-triggered ⇒ no feedback loop) recovers the Dolphin GUID on delete, since the change feed carries no payload. The reserved `dolphin_tp_id`/`dolphin_pat_id`/`dolphin_tpi_id` columns are deliberately **not** written (those tables are captured — writing them would re-trigger the sink).
- Resolution/adoption mechanics (patient by Dolphin's `patOtherID` = app `person_id`, itypID lookup, natural-key adoption) live in `dolphin-sink.ts`. **Going-forward only — no backfill.** Timepoint delete = **cascade**.
