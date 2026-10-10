/**
 * One "back up to Google Drive" run, and the in-memory record of the latest one.
 *
 * The folder holds ONE backup: each new backup replaces the last (owner's request, 2026-10-10).
 * The order of the steps is what keeps that from ever leaving the folder empty:
 *
 *   1. the dump streams into a NEW file (Drive creates it only when the last byte lands);
 *   2. pg_dump must exit 0, or the new file is deleted;
 *   3. Drive's MD5 and size of the new file must match what was sent, or it is deleted;
 *   4. only then are the older backups deleted.
 *
 * A failure at any step before 4 leaves the previous backup exactly as it was. Step 4 deletes only
 * files this app tagged as backups (`appProperties`), so anything else someone puts in the folder
 * is left alone, and only those whose snapshot is OLDER than the new one, so two servers backing
 * up at once still leave the newer backup standing rather than each deleting the other's.
 *
 * The run happens in the background: the request that starts it answers at once and the screen
 * polls `getDriveBackupJob()`. A dump uploads at the clinic's uplink speed, well past the 30 s
 * request timeout. The record is in memory, so a restart forgets a run; the backup itself is in
 * Drive and the status read finds it there.
 *
 * Pure (Drive, pg_dump and the clock are injected) so the order above is unit-tested in the gate.
 */

export type DriveBackupPhase = 'preparing' | 'uploading' | 'verifying' | 'replacing';

export type DriveBackupJob = {
  state: 'running' | 'succeeded' | 'failed';
  phase: DriveBackupPhase | null;
  startedAt: string;
  finishedAt: string | null;
  /** Bytes Drive has confirmed so far; the backup's size once it succeeds. */
  bytes: number;
  fileName: string;
  /** Older backups deleted after the new one checked out. */
  replaced: number;
  error: string | null;
  /** The backup succeeded, but something after it did not (an old copy could not be deleted). */
  warning: string | null;
};

export type BackupFile = {
  id: string;
  name: string;
  /** When the dump began — its point in time. Null on a file tagged without it. */
  snapshotAt: string | null;
};

export interface DumpHandle {
  stream: AsyncIterable<Buffer | string>;
  /** Settles when pg_dump exits: resolves on exit 0, rejects with its error otherwise. */
  finished: Promise<void>;
  /** Stop pg_dump (the upload failed, nothing more to read). */
  abort: () => void;
}

export interface DriveBackupDeps {
  ensureFolder: () => Promise<{ id: string }>;
  startDump: () => DumpHandle;
  upload: (
    stream: AsyncIterable<Buffer | string>,
    file: { name: string; folderId: string; snapshotAt: string },
    onProgress: (bytes: number) => void
  ) => Promise<{ id: string; bytes: number; md5: string } | null>;
  /** Drive's own record of a file: its MD5 (hex) and size in bytes. */
  getChecksum: (fileId: string) => Promise<{ md5: string | null; size: number | null }>;
  listBackups: (folderId: string) => Promise<BackupFile[]>;
  deleteFile: (fileId: string) => Promise<void>;
  fileName: (snapshot: Date) => string;
  now: () => Date;
  /** Turn a failure into the sentence the screen shows (and react to it, e.g. a revoked grant). */
  describeError: (err: unknown) => Promise<string>;
  logError: (message: string, meta: Record<string, unknown>) => void;
}

export class BackupAlreadyRunningError extends Error {
  constructor() {
    super('A Google Drive backup is already running.');
    this.name = 'BackupAlreadyRunningError';
  }
}

let current: DriveBackupJob | null = null;

/** The latest run since this process started, or null. A copy: the run keeps mutating its own. */
export function getDriveBackupJob(): DriveBackupJob | null {
  return current ? { ...current } : null;
}

/** Test hook: forget the latest run. */
export function resetDriveBackupJob(): void {
  current = null;
}

/** Delete a file we are abandoning; a failure here must not mask the error that got us here. */
async function discard(deps: DriveBackupDeps, fileId: string): Promise<void> {
  try {
    await deps.deleteFile(fileId);
  } catch (err) {
    deps.logError('Could not delete a rejected backup from Google Drive', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Steps 1–4 for `job`, which it updates as it goes. Throws on any failure before step 4. */
async function run(job: DriveBackupJob, deps: DriveBackupDeps, snapshot: Date): Promise<void> {
  const folder = await deps.ensureFolder();
  const snapshotAt = snapshot.toISOString();

  job.phase = 'uploading';
  const dump = deps.startDump();
  // Observed from the start, so a pg_dump failure while the upload is still running is never an
  // unhandled rejection.
  const dumpOutcome = dump.finished.then(
    () => null,
    (err: unknown) => err
  );

  let uploaded: { id: string; bytes: number; md5: string } | null;
  try {
    uploaded = await deps.upload(dump.stream, { name: job.fileName, folderId: folder.id, snapshotAt }, (bytes) => {
      job.bytes = bytes;
    });
  } catch (err) {
    dump.abort();
    await dumpOutcome;
    throw err;
  }

  // Step 2. pg_dump's output simply ends when it fails, so a finished upload proves nothing.
  const dumpError = await dumpOutcome;
  if (dumpError) {
    if (uploaded) await discard(deps, uploaded.id);
    throw dumpError;
  }
  if (!uploaded) throw new Error('pg_dump produced no output');
  const fresh = uploaded;

  // Step 3.
  job.phase = 'verifying';
  const stored = await deps.getChecksum(fresh.id);
  if (stored.md5 !== fresh.md5 || stored.size !== fresh.bytes) {
    await discard(deps, fresh.id);
    throw new Error(
      'The copy in Google Drive does not match what was sent, so it was deleted. The previous backup is untouched.'
    );
  }
  job.bytes = fresh.bytes;

  // Step 4. The new backup is safe; a failure from here on is a warning, not a failed backup.
  job.phase = 'replacing';
  try {
    const older = (await deps.listBackups(folder.id)).filter(
      (f) => f.id !== fresh.id && (f.snapshotAt === null || f.snapshotAt < snapshotAt)
    );
    for (const file of older) {
      await deps.deleteFile(file.id);
      job.replaced++;
    }
  } catch (err) {
    job.warning = `The backup was saved, but an older one could not be deleted: ${await deps.describeError(err)}`;
    deps.logError('Google Drive backup: could not delete an older backup', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start a run in the background and return its record. Throws BackupAlreadyRunningError while one
 * is running in this process.
 */
export function startDriveBackup(deps: DriveBackupDeps): DriveBackupJob {
  if (current?.state === 'running') throw new BackupAlreadyRunningError();

  const snapshot = deps.now();
  const job: DriveBackupJob = {
    state: 'running',
    phase: 'preparing',
    startedAt: snapshot.toISOString(),
    finishedAt: null,
    bytes: 0,
    fileName: deps.fileName(snapshot),
    replaced: 0,
    error: null,
    warning: null,
  };
  current = job;

  void run(job, deps, snapshot).then(
    () => {
      job.state = 'succeeded';
      job.phase = null;
      job.finishedAt = deps.now().toISOString();
    },
    async (err: unknown) => {
      job.error = await deps.describeError(err).catch(() => (err instanceof Error ? err.message : String(err)));
      job.state = 'failed';
      job.phase = null;
      job.finishedAt = deps.now().toISOString();
      deps.logError('Google Drive backup failed', { error: err instanceof Error ? err.message : String(err) });
    }
  );

  return { ...job };
}
