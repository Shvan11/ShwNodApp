// @vitest-environment node
/**
 * Tests for the Drive backup run's ORDER — the part that decides whether the folder can ever be
 * left with no good backup. The previous backup may be deleted only after the new one is complete
 * (pg_dump exited 0) and verified (Drive's MD5 and size match what was sent); every failure before
 * that must leave it alone and remove the rejected new file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackupAlreadyRunningError,
  getDriveBackupJob,
  resetDriveBackupJob,
  startDriveBackup,
  type BackupFile,
  type DriveBackupDeps,
} from './drive-backup-run.js';

const OLD: BackupFile = { id: 'old', name: 'old.dump', snapshotAt: '2026-10-01T10:00:00.000Z' };
const SNAPSHOT = new Date('2026-10-10T09:00:00.000Z');

async function* bytes(): AsyncGenerator<Buffer> {
  yield Buffer.from('dump');
}

function makeDeps(overrides: Partial<DriveBackupDeps> = {}) {
  const deleted: string[] = [];
  const deps: DriveBackupDeps = {
    ensureFolder: async () => ({ id: 'folder' }),
    startDump: () => ({ stream: bytes(), finished: Promise.resolve(), abort: vi.fn() }),
    upload: async (_stream, _file, onProgress) => {
      onProgress(4);
      return { id: 'new', bytes: 4, md5: 'abc' };
    },
    getChecksum: async () => ({ md5: 'abc', size: 4 }),
    listBackups: async () => [{ id: 'new', name: 'new.dump', snapshotAt: SNAPSHOT.toISOString() }, OLD],
    deleteFile: async (id) => {
      deleted.push(id);
    },
    fileName: () => 'shwan-backup.dump',
    now: () => SNAPSHOT,
    describeError: async (err) => (err instanceof Error ? err.message : String(err)),
    logError: () => {},
    ...overrides,
  };
  return { deps, deleted };
}

async function settle() {
  await vi.waitFor(() => expect(getDriveBackupJob()?.state).not.toBe('running'));
  return getDriveBackupJob()!;
}

afterEach(() => resetDriveBackupJob());

describe('startDriveBackup', () => {
  it('replaces the older backup once the new one checks out', async () => {
    const { deps, deleted } = makeDeps();
    startDriveBackup(deps);
    const job = await settle();
    expect(job).toMatchObject({ state: 'succeeded', bytes: 4, replaced: 1, error: null, warning: null });
    expect(deleted).toEqual(['old']);
  });

  it('keeps the previous backup and drops the new file when pg_dump fails', async () => {
    const { deps, deleted } = makeDeps({
      startDump: () => ({
        stream: bytes(),
        finished: Promise.reject(new Error('pg_dump: connection refused')),
        abort: vi.fn(),
      }),
    });
    startDriveBackup(deps);
    const job = await settle();
    expect(job).toMatchObject({ state: 'failed', error: 'pg_dump: connection refused' });
    expect(deleted).toEqual(['new']);
  });

  it('keeps the previous backup and drops the new file when the checksum differs', async () => {
    const { deps, deleted } = makeDeps({ getChecksum: async () => ({ md5: 'zzz', size: 4 }) });
    startDriveBackup(deps);
    const job = await settle();
    expect(job.state).toBe('failed');
    expect(job.error).toMatch(/does not match/);
    expect(deleted).toEqual(['new']);
  });

  it('stops pg_dump and deletes nothing when the upload fails', async () => {
    const abort = vi.fn();
    const { deps, deleted } = makeDeps({
      startDump: () => ({ stream: bytes(), finished: Promise.resolve(), abort }),
      upload: async () => {
        throw new Error('Could not reach Google Drive');
      },
    });
    startDriveBackup(deps);
    const job = await settle();
    expect(job).toMatchObject({ state: 'failed', error: 'Could not reach Google Drive' });
    expect(abort).toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('never deletes a backup newer than its own snapshot', async () => {
    const newer: BackupFile = { id: 'newer', name: 'n.dump', snapshotAt: '2026-10-10T09:00:05.000Z' };
    const { deps, deleted } = makeDeps({ listBackups: async () => [newer, OLD] });
    startDriveBackup(deps);
    await settle();
    expect(deleted).toEqual(['old']);
  });

  it('reports a backup that could not replace the old one as saved, with a warning', async () => {
    const { deps } = makeDeps({
      deleteFile: async () => {
        throw new Error('403 insufficient permissions');
      },
    });
    startDriveBackup(deps);
    const job = await settle();
    expect(job.state).toBe('succeeded');
    expect(job.warning).toMatch(/older one could not be deleted/);
  });

  it('refuses a second run while one is going', async () => {
    let release!: () => void;
    const { deps } = makeDeps({
      ensureFolder: () => new Promise((resolve) => (release = () => resolve({ id: 'folder' }))),
    });
    startDriveBackup(deps);
    expect(() => startDriveBackup(deps)).toThrow(BackupAlreadyRunningError);
    release();
    await settle();
  });
});
