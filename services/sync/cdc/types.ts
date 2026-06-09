/**
 * Unified CDC — shared types.
 *
 * One change feed (the `change_log` table, populated by the cdc_capture trigger) is drained by
 * one engine per sink. A sink only knows how to apply a single change (upsert/delete of one
 * row, identified by its LOCAL table + primary-key value as text) to its destination; the engine
 * owns all the changelog mechanics (batching, coalescing, version-guarded delete, anti-bloat).
 */
import type { Pool } from 'pg';

export type CdcOp = 'I' | 'U' | 'D';

/** A destination the change feed replicates to (e.g. the raw failover replica, the portal Supabase). */
export interface SyncSink {
  /** Must match the sink name in cdc_sink_control and the trigger's TG_ARGV. */
  readonly name: string;
  /** Open connections / caches. Called once on engine start. */
  init(): Promise<void>;
  /** Replicate the current state of (localTable, pk) to the destination. */
  upsert(localTable: string, pk: string): Promise<void>;
  /** Replicate a delete of (localTable, pk) to the destination. */
  remove(localTable: string, pk: string): Promise<void>;
  /** Close connections. Called on engine stop. */
  close(): Promise<void>;
}

export interface EngineOpts {
  intervalMs: number;
  batchSize: number;
  maxBacklog: number;
  /**
   * Which pool the change-feed mechanics (cdc_sink_control + change_log: backlog count, batch read,
   * version-guarded delete) run against. Omitted → the LOCAL pg pool (forward/dolphin: their feed
   * lives locally). The REVERSE sink passes the Supabase reverse-read pool — its feed lives on
   * Supabase. NOTE this is the feed pool, NOT where the sink APPLIES changes (the sink owns that).
   */
  source?: () => Pool;
}
