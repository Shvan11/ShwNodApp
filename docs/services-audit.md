# `services/` audit record

**Status:** two sweeps done (2026-08-13, 2026-08-31). This file is the in-repo record.
**Scope:** `services/` — 19 domain subdirectories, the largest part of the backend.
**Companion:** `docs/backend-audit-tracker.md` covers everything OUTSIDE `services/` and is far
more detailed (86 findings + a 2026-09-09 re-review, each written up in place).

> **Why this file exists.** It was written on **2026-09-12** to close finding **R9(e)** of the
> backend audit: the two `services/` sweeps happened in working sessions and their per-finding
> reasoning was never committed, so the repo could not tell a future reader what had been checked
> or what had been looked at and deliberately left alone. That is the failure mode this file
> fixes. **Read it as a coverage map and a decision log, not as a reproduction of the sweeps** —
> the batch-1/batch-2 per-finding write-ups are gone, and what follows is the durable residue,
> re-verified against the code on 2026-09-12. Anything below that names a file or behaviour was
> confirmed to still be true on that date.

---

## Batch 1 — dir-by-dir sweep (2026-08-13, closed 2026-08-14)

A bug + dead-code pass over every subdirectory. Two structural outcomes survive in the tree:

**1. Directory reorganization — 5 directories folded into their real owners.** The current layout
(`ls services/`) is the result; the names below no longer exist and should not be reintroduced:

| Was | Now | Why |
|---|---|---|
| `services/state/`, `services/email/` | `services/messaging/` | `messaging/` owns every channel *and* the WhatsApp runtime state (`messageState` / `stateEvents` / `StateManager`) |
| `services/config/` | `services/settings/` | Backs the Settings screen — distinct from the root `config/` boot config behind `@config/*` |
| `services/core/` | `utils/` | Cross-cutting helpers were not a domain service |
| `services/authentication/` | `services/google-contacts/` | It was only ever that provider's OAuth |

`services/sync/cdc/` was examined and **deliberately NOT flattened** — the sink/engine split is
load-bearing (see `docs/sync-cdc.md`).

**2. The WhatsApp lock reaper.** The stuck-lock reaper in `services/messaging/StateManager.ts` was
found to be provably dead code. It was replaced with **fencing tokens**: `acquireLock` mints a
token identifying that particular grant, `releaseLock` ignores a release carrying a stale one, and
`reportStuckLocks` is now **warn-only** — it never force-releases. That is what makes a slow holder's
eventual release a safe no-op instead of a release of somebody else's lock. Do not "simplify"
`releaseLock` back to a keyed release.

## Batch 2 — CDC + the 6 integrations (2026-08-31)

Swept `services/sync/cdc/` plus the six external integrations. **31 findings, all fixed.** The
schema half shipped as `migrations/pg/1787000000000_cdc-capture-clock-timestamp.sql` (+ its Supabase
mirror), applied to both databases and verified; that migration is recorded in the `pgmigrations`
ledger (applied 2026-08-31) and its rule — `change_log.changed_at` uses `clock_timestamp()`, never
`now()` — is documented in CLAUDE.md because reverting it silently drops changes.

### Deliberate non-fixes — both still live, both now annotated in code

Two findings were raised, understood, and **left as they are on purpose**. Each call site carries an
`AUDIT DECISION` comment pointing here (added 2026-09-12 — before that the decisions existed only in
a chat log, which is how a later reader "fixes" them and breaks a working install):

1. **Google Drive requests the full `auth/drive` scope**, not `drive.file`
   (`services/google-drive/google-drive-client.ts#getAuthUrl`). Narrowing looks right and is wrong
   here: `drive.file` only ever sees files the app itself created, while `GOOGLE_DRIVE_FOLDER_ID`
   points at a folder created **by hand** in the clinic's Drive — `files.get` on it would fail and
   `getRootFolder()` would break on the next reconnect. Narrowing needs the app to own its root
   folder first.
2. **Uploaded PDFs are shared as anyone-with-the-link** (`createShareableLink`, `type: 'anyone'`).
   This was raised as a finding and **the clinic explicitly excluded it from the fix list** — it is a
   product decision about how aligner PDFs reach labs and patients. Provenance matters here: the
   record is "the owner decided", not "an engineer reasoned it was fine". Ask before changing it.

---

## What this record does NOT cover

- **Per-finding detail for the 31 batch-2 findings and batch 1's individual bugs.** Not recoverable;
  the fixes are in git history around those dates.
- **A third sweep.** Neither batch re-reviewed its own remediation code. The equivalent re-review
  outside `services/` (backend tracker, 2026-09-09) found 9 further items in ~2,800 lines of fix
  code, so assume the same class of gap exists here and treat `services/` as **audited once, never
  re-reviewed**.
- **`services/messaging/whatsapp.ts` and `services/database/queries/aligner-queries.ts` as structural
  problems** — they were logged as R9(c) in the backend tracker, and **closed there in session S2
  (2026-09-13)**: `aligner-queries.ts` (2,159) became seven table-scoped modules, and
  `whatsapp.ts` (3,294 → 2,501) shed its types, `ClientStateManager`, `EnhancedCircuitBreaker` and
  the LocalAuth-profile filesystem helpers. The `WhatsAppService` class core (client lifecycle +
  batch-send engine) was deliberately left whole — see the tracker for why.
