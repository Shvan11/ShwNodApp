/**
 * Database backup to Google Drive (Settings → Database): a dedicated folder in the connected
 * account's My Drive holding the latest `pg_dump`, each new backup replacing the last.
 *
 * The run itself (its order, and why it never leaves the folder empty) is in drive-backup-run.ts;
 * the upload protocol is in resumable-upload.ts. This module supplies them with the real Drive
 * client, pg_dump and the clinic's settings.
 *
 * THE FOLDER. Created on the first backup at the top of My Drive, named after the clinic
 * (`CLINIC_NAME`, Settings → General), and remembered by id in the `DRIVE_BACKUP_FOLDER_ID` option
 * row. It is found by that id, never by name, so a rename in Drive keeps working and two centres
 * that happen to share one Google account never adopt each other's folder. A folder that is gone
 * or in the trash is replaced by a new one on the next backup.
 *
 * Uses the account connected in Settings → Integrations (the aligner-PDF grant, full `drive`
 * scope), but not GOOGLE_DRIVE_FOLDER_ID: the aligner PDFs are shared by link, and a database dump
 * must never sit in a tree like that.
 */
import { log } from '../../utils/logger.js';
import { backupFilename, spawnPgDump } from '../database/backup.js';
import { getOption, upsertOption } from '../database/queries/options-queries.js';
import { getClinicDisplayName } from '../settings/clinic-identity.js';
import driveClient from './google-drive-client.js';
import { handleInvalidGrant, isInvalidGrantError } from './oauth.js';
import { uploadResumable } from './resumable-upload.js';
import {
  getDriveBackupJob,
  startDriveBackup,
  type BackupFile,
  type DriveBackupDeps,
  type DriveBackupJob,
  type DumpHandle,
} from './drive-backup-run.js';

export { BackupAlreadyRunningError } from './drive-backup-run.js';

/** Option row holding the backup folder's Drive id (written by the app; not shown in General). */
export const DRIVE_BACKUP_FOLDER_OPTION = 'DRIVE_BACKUP_FOLDER_ID';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Marks a file as one of our backups. appProperties are private to this OAuth client. */
const BACKUP_TAG_KEY = 'shwanBackup';
const BACKUP_TAG_VALUE = 'database';
/** Every Drive metadata call (the upload has its own per-chunk timeouts). */
const DRIVE_CALL_TIMEOUT_MS = 30_000;

/** Drive is set up on this server but has no grant, or is not set up at all. */
export class DriveBackupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveBackupUnavailableError';
  }
}

export type DriveBackupFolder = { id: string; name: string; url: string | null };

export type DriveBackupFileInfo = {
  name: string;
  size: number | null;
  createdTime: string | null;
  url: string | null;
};

export type DriveBackupStatus = {
  /** The Drive OAuth client is configured on this server. */
  configured: boolean;
  /** …and holds a grant. */
  connected: boolean;
  folder: DriveBackupFolder | null;
  latest: DriveBackupFileInfo | null;
  /** Drive could not be read just now. */
  driveError: string | null;
  job: DriveBackupJob | null;
};

/** Drive query literals are single-quoted. */
const quote = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function drive() {
  if (!driveClient.isInitialized() || !driveClient.drive) {
    throw new DriveBackupUnavailableError('Google Drive is not configured on this server.');
  }
  return driveClient.drive;
}

function httpStatus(err: unknown): number | null {
  const e = err as { status?: unknown; response?: { status?: unknown } };
  const status = e?.response?.status ?? e?.status;
  return typeof status === 'number' ? status : null;
}

/** The remembered folder, if it still exists and is not in the trash. */
async function findFolder(): Promise<DriveBackupFolder | null> {
  const id = (await getOption(DRIVE_BACKUP_FOLDER_OPTION))?.trim();
  if (!id) return null;
  try {
    const { data } = await drive().files.get(
      { fileId: id, fields: 'id, name, mimeType, trashed, webViewLink' },
      { timeout: DRIVE_CALL_TIMEOUT_MS }
    );
    if (data.trashed || data.mimeType !== FOLDER_MIME || !data.id) return null;
    return { id: data.id, name: data.name ?? '', url: data.webViewLink ?? null };
  } catch (err) {
    // Deleted for good, or not visible to the account now connected.
    if (httpStatus(err) === 404) return null;
    throw err;
  }
}

async function ensureFolder(): Promise<DriveBackupFolder> {
  const existing = await findFolder();
  if (existing) return existing;

  const clinic = await getClinicDisplayName();
  const { data } = await drive().files.create(
    {
      requestBody: {
        name: `${clinic} — Database Backups`,
        mimeType: FOLDER_MIME,
        description:
          `Database backups of ${clinic}'s practice-management system. Each new backup replaces the ` +
          'previous one. The files are unencrypted and contain patient records: do not share this folder.',
      },
      fields: 'id, name, webViewLink',
    },
    { timeout: DRIVE_CALL_TIMEOUT_MS }
  );
  if (!data.id) throw new Error('Google Drive created the backup folder but returned no id');
  await upsertOption(DRIVE_BACKUP_FOLDER_OPTION, data.id);
  log.info('Created the Google Drive backup folder', { folderId: data.id, name: data.name });
  return { id: data.id, name: data.name ?? '', url: data.webViewLink ?? null };
}

/** Our backups in the folder, newest first. */
async function listBackupFiles(folderId: string) {
  const { data } = await drive().files.list(
    {
      q:
        `'${quote(folderId)}' in parents and trashed = false and ` +
        `appProperties has { key='${BACKUP_TAG_KEY}' and value='${BACKUP_TAG_VALUE}' }`,
      orderBy: 'createdTime desc',
      fields: 'files(id, name, size, createdTime, webViewLink, appProperties)',
      pageSize: 100,
      spaces: 'drive',
    },
    { timeout: DRIVE_CALL_TIMEOUT_MS }
  );
  return data.files ?? [];
}

function startDump(): DumpHandle {
  const child = spawnPgDump();
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 8192) stderr += chunk.toString();
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', (err: Error) =>
      reject(new Error('Backup failed to start — is pg_dump installed and PG_DUMP_PATH correct?', { cause: err }))
    );
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`Backup failed: ${stderr.trim() || `pg_dump exit code ${code}`}`));
    });
  });
  return {
    stream: child.stdout,
    finished,
    abort: () => {
      if (child.exitCode === null && !child.killed) child.kill();
    },
  };
}

async function accessToken(): Promise<string> {
  const client = driveClient.oauth2Client;
  if (!client) throw new DriveBackupUnavailableError('Google Drive is not configured on this server.');
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Google Drive returned no access token');
  return token;
}

/**
 * The sentence the screen shows for a failure. A revoked grant is also dropped here, as every
 * Drive caller does, so the Integrations card stops claiming "Connected".
 */
async function describeError(err: unknown): Promise<string> {
  if (isInvalidGrantError(err)) {
    await handleInvalidGrant();
    return 'Google Drive access has expired or was revoked. Reconnect it in Settings → Integrations.';
  }
  return err instanceof Error ? err.message : String(err);
}

const deps: DriveBackupDeps = {
  ensureFolder,
  startDump,
  upload: (stream, file, onProgress) =>
    uploadResumable(stream, {
      metadata: {
        name: file.name,
        parents: [file.folderId],
        mimeType: 'application/octet-stream',
        description: 'PostgreSQL custom-format dump (pg_dump -Fc). Restore with pg_restore.',
        appProperties: { [BACKUP_TAG_KEY]: BACKUP_TAG_VALUE, snapshotAt: file.snapshotAt },
      },
      contentType: 'application/octet-stream',
      getAccessToken: accessToken,
      onProgress,
    }),
  getChecksum: async (fileId) => {
    const { data } = await drive().files.get(
      { fileId, fields: 'md5Checksum, size' },
      { timeout: DRIVE_CALL_TIMEOUT_MS }
    );
    return { md5: data.md5Checksum ?? null, size: data.size != null ? Number(data.size) : null };
  },
  listBackups: async (folderId): Promise<BackupFile[]> =>
    (await listBackupFiles(folderId)).flatMap((f) =>
      f.id ? [{ id: f.id, name: f.name ?? '', snapshotAt: f.appProperties?.snapshotAt ?? null }] : []
    ),
  deleteFile: async (fileId) => {
    await drive().files.delete({ fileId }, { timeout: DRIVE_CALL_TIMEOUT_MS });
  },
  fileName: backupFilename,
  now: () => new Date(),
  describeError,
  logError: (message, meta) => log.error(message, meta),
};

function availability(): { configured: boolean; connected: boolean } {
  const configured = driveClient.isInitialized();
  return { configured, connected: configured && driveClient.hasCredentials() };
}

/** Start a backup in the background. Throws DriveBackupUnavailableError / BackupAlreadyRunningError. */
export function startBackupToDrive(): DriveBackupJob {
  const { configured, connected } = availability();
  if (!configured) throw new DriveBackupUnavailableError('Google Drive is not configured on this server.');
  if (!connected) {
    throw new DriveBackupUnavailableError('Google Drive is not connected. Connect it in Settings → Integrations.');
  }
  log.info('Starting a database backup to Google Drive');
  return startDriveBackup(deps);
}

/** What Settings → Database shows: the connection, the folder, the backup in it and the latest run. */
export async function getDriveBackupStatus(): Promise<DriveBackupStatus> {
  let folder: DriveBackupFolder | null = null;
  let latest: DriveBackupFileInfo | null = null;
  let driveError: string | null = null;

  if (availability().connected) {
    try {
      folder = await findFolder();
      if (folder) {
        const [newest] = await listBackupFiles(folder.id);
        if (newest) {
          latest = {
            name: newest.name ?? '',
            size: newest.size != null ? Number(newest.size) : null,
            createdTime: newest.createdTime ?? null,
            url: newest.webViewLink ?? null,
          };
        }
      }
    } catch (err) {
      driveError = await describeError(err);
      log.warn('Could not read the Google Drive backup folder', { error: driveError });
    }
  }

  // Read last: describeError may just have dropped a revoked grant.
  return { ...availability(), folder, latest, driveError, job: getDriveBackupJob() };
}
