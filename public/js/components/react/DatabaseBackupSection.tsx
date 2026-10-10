import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage, postJSON } from '@/core/http';
import { driveBackupStatusQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import { formatLocaleDateTime } from '@/utils/formatters';
import { formatSize } from './files/fileHelpers';
import * as settings from '@shared/contracts/settings.contract';
import styles from './DatabaseBackupSection.module.css';

/**
 * Settings → Database, top section: two ways to keep a backup of the clinic's database.
 *
 * - **Download** — GET /api/config/database/backup streams a `pg_dump -Fc` archive, fetched as a
 *   blob and saved via a temporary <a download>.
 * - **Google Drive** — POST /api/config/database/backup/drive starts a background run that uploads
 *   the same archive to a dedicated folder in the connected Google account, replacing the backup
 *   already there (services/google-drive/drive-backup.ts). The run outlasts any request, so this
 *   polls the status read while it is going.
 *
 * Read-only: it never reports unsaved changes. Both files are unencrypted and hold patient data,
 * which the warning says.
 */

const BACKUP_URL = '/api/config/database/backup';
const DRIVE_POLL_MS = 2000;

const PHASE_LABEL: Record<NonNullable<settings.DriveBackupJob['phase']>, string> = {
    preparing: 'Preparing…',
    uploading: 'Uploading',
    verifying: 'Checking the upload…',
    replacing: 'Replacing the previous backup…',
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
};

function filenameFromDisposition(header: string | null): string {
    const match = header?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? 'shwan-backup.dump';
}

const DriveBackupCard = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const { data: status, isLoading, isError, error } = useQuery({
        ...driveBackupStatusQuery(),
        refetchInterval: (query) => (query.state.data?.job?.state === 'running' ? DRIVE_POLL_MS : false),
    });

    const start = useApiMutation({
        mutationFn: () =>
            postJSON<settings.StartDriveBackupResponse>(
                '/api/config/database/backup/drive',
                {},
                { schema: settings.startDriveBackup.response }
            ),
        invalidate: [qk.settings.driveBackup()],
        onError: (err) => toast.error(httpErrorMessage(err, 'Could not start the Google Drive backup')),
    });

    const job = status?.job ?? null;
    const running = job?.state === 'running' || start.isPending;

    let body: ReactNode;
    if (isLoading) {
        body = (
            <p className={styles.muted}>
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Checking Google Drive…
            </p>
        );
    } else if (isError || !status) {
        body = (
            <div className={`${styles.notice} ${styles.error}`} role="alert">
                <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                <span>{httpErrorMessage(error, 'Could not read the Google Drive backup status')}</span>
            </div>
        );
    } else if (!status.configured) {
        body = <p className={styles.muted}>Google Drive is not set up on this server.</p>;
    } else if (!status.connected) {
        body = (
            <>
                <p className={styles.text}>
                    Connect a Google account in Settings → Integrations to keep a backup in its Google Drive.
                </p>
                <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/settings/integrations')}>
                    <i className="fas fa-plug" aria-hidden="true"></i>
                    Open Integrations
                </button>
            </>
        );
    } else {
        const { folder, latest } = status;
        body = (
            <>
                <p className={styles.text}>
                    {folder ? (
                        <>
                            Backs up to the folder <strong>{folder.name}</strong> in Google Drive.
                        </>
                    ) : (
                        <>The first backup creates a folder named after the clinic in Google Drive.</>
                    )}{' '}
                    Each new backup replaces the previous one, so the folder always holds just the latest.
                </p>

                <dl className={styles.facts}>
                    <div className={styles.fact}>
                        <dt>Latest backup</dt>
                        <dd>
                            {latest
                                ? [formatLocaleDateTime(latest.createdTime, DATE_TIME), formatSize(latest.size ?? undefined)]
                                      .filter(Boolean)
                                      .join(' · ')
                                : 'None yet'}
                        </dd>
                    </div>
                    {folder?.url && (
                        <div className={styles.fact}>
                            <dt>Folder</dt>
                            <dd>
                                <a href={folder.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                                    Open in Google Drive
                                    <i className="fas fa-external-link-alt" aria-hidden="true"></i>
                                </a>
                            </dd>
                        </div>
                    )}
                </dl>

                {status.driveError && (
                    <div className={`${styles.notice} ${styles.error}`} role="alert">
                        <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                        <span>{status.driveError}</span>
                    </div>
                )}

                {job?.state === 'running' && (
                    <p className={styles.progress} role="status">
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                        {job.phase ? PHASE_LABEL[job.phase] : 'Working…'}
                        {job.phase === 'uploading' && job.bytes > 0 && ` · ${formatSize(job.bytes)} sent`}
                    </p>
                )}
                {job?.state === 'failed' && (
                    <div className={`${styles.notice} ${styles.error}`} role="alert">
                        <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                        <span>
                            The backup started on {formatLocaleDateTime(job.startedAt, DATE_TIME)} failed:{' '}
                            {(job.error ?? 'unknown error').replace(/\.$/, '')}. The backup already in Google
                            Drive was not touched.
                        </span>
                    </div>
                )}
                {job?.state === 'succeeded' && (
                    <div className={`${styles.notice} ${job.warning ? styles.warn : styles.success}`} role="status">
                        <i
                            className={job.warning ? 'fas fa-exclamation-triangle' : 'fas fa-check-circle'}
                            aria-hidden="true"
                        ></i>
                        <span>
                            {job.warning ??
                                `Backed up ${formatSize(job.bytes)} on ${formatLocaleDateTime(job.finishedAt, DATE_TIME)}${
                                    job.replaced > 0 ? ', replacing the previous backup' : ''
                                }.`}
                        </span>
                    </div>
                )}

                <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => start.mutate()}
                    disabled={running}
                >
                    <i className={`fas ${running ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'}`} aria-hidden="true"></i>
                    {running ? 'Backing up…' : 'Back up to Google Drive'}
                </button>
                {running && (
                    <p className={styles.hint}>
                        The backup runs on the server: you can leave this page, and it carries on.
                    </p>
                )}
            </>
        );
    }

    return (
        <div className={styles.card}>
            <h4 className={styles.cardTitle}>
                <i className="fab fa-google-drive" aria-hidden="true"></i>
                Google Drive
            </h4>
            {body}
        </div>
    );
};

const DownloadBackupCard = () => {
    const toast = useToast();
    const [isBackingUp, setIsBackingUp] = useState(false);

    const handleDownload = async (): Promise<void> => {
        setIsBackingUp(true);
        try {
            // eslint-disable-next-line no-restricted-syntax -- streams a binary pg_dump blob (res.blob()) + reads the Content-Disposition filename; needs the raw Response (bypasses core/http.ts's envelope unwrap). GET read → no CSRF token required.
            const response = await fetch(BACKUP_URL, { method: 'GET' });

            if (!response.ok) {
                let message = 'Backup failed';
                try {
                    const body = (await response.json()) as { error?: string } | null;
                    if (body?.error) message = body.error;
                } catch {
                    // Non-JSON error body — keep the generic message.
                }
                throw new Error(message);
            }

            const blob = await response.blob();
            const filename = filenameFromDisposition(response.headers.get('Content-Disposition'));
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);

            toast.success('Database backup downloaded');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Backup failed');
        } finally {
            setIsBackingUp(false);
        }
    };

    return (
        <div className={styles.card}>
            <h4 className={styles.cardTitle}>
                <i className="fas fa-download" aria-hidden="true"></i>
                This computer
            </h4>
            <p className={styles.text}>
                Saves the backup as a single file. Keep it somewhere safe — an external drive, USB stick, or
                network location.
            </p>
            <button type="button" className={styles.primaryBtn} onClick={handleDownload} disabled={isBackingUp}>
                <i className={`fas ${isBackingUp ? 'fa-spinner fa-spin' : 'fa-download'}`} aria-hidden="true"></i>
                {isBackingUp ? 'Preparing backup…' : 'Download backup'}
            </button>
            {isBackingUp && (
                <p className={styles.hint}>
                    This can take a moment on a large database — please keep this tab open until the file
                    finishes downloading.
                </p>
            )}
        </div>
    );
};

const DatabaseBackupSection = () => (
    <section className={styles.section} aria-labelledby="database-backup-title">
        <h3 id="database-backup-title" className={styles.sectionTitle}>
            <i className="fas fa-shield-alt" aria-hidden="true"></i>
            Backup
        </h3>
        <p className={styles.sectionDescription}>
            Keep a copy of this clinic&apos;s database away from this computer, so you can restore it if the
            computer fails.
        </p>

        <div className={styles.warning}>
            <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
            <span>
                A backup is <strong>not encrypted</strong> and contains all patient information. Store it securely
                and do not share it.
            </span>
        </div>

        <div className={styles.cards}>
            <DownloadBackupCard />
            <DriveBackupCard />
        </div>
    </section>
);

export default DatabaseBackupSection;
