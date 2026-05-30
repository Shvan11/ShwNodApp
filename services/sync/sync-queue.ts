/**
 * App-level Supabase-sync enqueue (Phase 8, Option A).
 *
 * Replaces the SQL Server `trg_sync_*` triggers + `sp_NotifyAppOfSync`. The synced-entity
 * write methods call `enqueueSync(...)` **inside their own transaction**, so a queue row is
 * written atomically with the data change — strictly better than the trigger: a rolled-back
 * write can never leave a phantom queue row, and a committed write can never be silently
 * un-enqueued.
 *
 * Master-gated by `config.sync.enabled` (env `SYNC_ENABLED`). When sync is OFF (the sandbox
 * default) every call is a no-op, so the write paths behave exactly as before and nothing
 * touches Supabase. Production sets `SYNC_ENABLED=true`.
 *
 * JsonData is intentionally left NULL — the queue processor fetches the current row from PG
 * on demand (the "optimized flow"), matching the trigger's `NULL` JsonData behaviour.
 */
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../database/kysely.js';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

/**
 * Supabase table names the sync subsystem understands (the SyncQueue.TableName values the
 * queue processor keys its primary-key map and upsert handlers on). These mirror exactly the
 * tables the old `trg_sync_*` triggers enqueued.
 */
export type SyncTable =
  | 'aligner_doctors'
  | 'aligner_sets'
  | 'aligner_batches'
  | 'aligner_notes'
  | 'patients'
  | 'work';

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/** A Kysely connection or an open transaction — enqueue joins the caller's unit of work. */
type SyncExecutor = Kysely<Database> | Transaction<Database>;

/**
 * Enqueue one SyncQueue row for `table`/`recordId`/`operation`, using the supplied executor
 * (pass the caller's `trx` so the enqueue commits/rolls back with the write). No-op when sync
 * is disabled. Errors propagate so a failed enqueue rolls back the surrounding transaction.
 */
export async function enqueueSync(
  executor: SyncExecutor,
  table: SyncTable,
  recordId: number,
  operation: SyncOperation
): Promise<void> {
  if (!config.sync.enabled) return;

  await executor
    .insertInto('SyncQueue')
    .values({
      TableName: table,
      RecordID: recordId,
      Operation: operation,
      // JsonData omitted → NULL: processor fetches fresh state on demand.
      Status: 'Pending',
    })
    .execute();

  log.debug('Enqueued sync', { table, recordId, operation });
}

/**
 * Enqueue the same operation for many record IDs of one table (e.g. the sibling rows a
 * cascade touches). No-op when disabled or the list is empty.
 */
export async function enqueueSyncMany(
  executor: SyncExecutor,
  table: SyncTable,
  recordIds: number[],
  operation: SyncOperation
): Promise<void> {
  if (!config.sync.enabled || recordIds.length === 0) return;

  await executor
    .insertInto('SyncQueue')
    .values(
      recordIds.map((recordId) => ({
        TableName: table,
        RecordID: recordId,
        Operation: operation,
        Status: 'Pending',
      }))
    )
    .execute();

  log.debug('Enqueued sync (batch)', { table, count: recordIds.length, operation });
}

/**
 * Enqueue a `work` change ONLY if the work has at least one aligner set — mirrors
 * `trg_sync_tblWork`'s `WHERE EXISTS (… tblAlignerSets …)` filter (Supabase only holds
 * aligner-related work). No-op when sync is disabled (so it adds no query overhead in the
 * sandbox). Pass the caller's `trx` so the read + enqueue join the write's transaction.
 */
export async function enqueueWorkIfAligner(
  executor: SyncExecutor,
  workId: number,
  operation: SyncOperation
): Promise<void> {
  if (!config.sync.enabled) return;
  const tracked = await executor
    .selectFrom('tblAlignerSets')
    .select('AlignerSetID')
    .where('WorkID', '=', workId)
    .limit(1)
    .executeTakeFirst();
  if (tracked) await enqueueSync(executor, 'work', workId, operation);
}

/**
 * Enqueue a `patients` change ONLY if the patient owns work that has an aligner set —
 * mirrors `trg_sync_tblPatients`'s `WHERE EXISTS (… tblWork JOIN tblAlignerSets …)` filter.
 * No-op when sync is disabled.
 */
export async function enqueuePatientIfAligner(
  executor: SyncExecutor,
  personId: number,
  operation: SyncOperation
): Promise<void> {
  if (!config.sync.enabled) return;
  const tracked = await executor
    .selectFrom('tblwork as w')
    .innerJoin('tblAlignerSets as s', 's.WorkID', 'w.workid')
    .select('s.AlignerSetID')
    .where('w.PersonID', '=', personId)
    .limit(1)
    .executeTakeFirst();
  if (tracked) await enqueueSync(executor, 'patients', personId, operation);
}
