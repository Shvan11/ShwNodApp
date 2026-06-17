import { useEffect, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import styles from './DatabaseBackupSettings.module.css';

/**
 * Settings tab: download a full backup of this clinic's database.
 *
 * Calls GET /api/config/database/backup, which streams a `pg_dump -Fc` custom-format
 * archive. The file is fetched as a blob and saved via a temporary <a download>. Read-only,
 * so it never reports unsaved changes (no Save badge). The UI warns that the downloaded file
 * is unencrypted and contains patient data.
 */

interface DatabaseBackupSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const BACKUP_URL = '/api/config/database/backup';

function filenameFromDisposition(header: string | null): string {
    const match = header?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? 'shwan-backup.dump';
}

const DatabaseBackupSettings = ({ onChangesUpdate }: DatabaseBackupSettingsProps) => {
    const toast = useToast();
    const [isBackingUp, setIsBackingUp] = useState(false);

    // Read-only tab: declare no unsaved changes so no Save badge ever shows.
    useEffect(() => {
        onChangesUpdate?.(false);
    }, [onChangesUpdate]);

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
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>
                        <i className="fas fa-database"></i>
                        Database Backup
                    </h3>
                    <p className={styles.description}>
                        Download a complete backup of this clinic&apos;s database as a single file.
                        Keep it somewhere safe — an external drive, USB stick, or network location —
                        so you can restore your data if this computer fails.
                    </p>
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.warning}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <span>
                        The backup file is <strong>not encrypted</strong> and contains all patient
                        information. Store it securely and do not share it.
                    </span>
                </div>

                <button
                    type="button"
                    className={styles.downloadBtn}
                    onClick={handleDownload}
                    disabled={isBackingUp}
                >
                    <i className={`fas ${isBackingUp ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                    {isBackingUp ? 'Preparing backup…' : 'Download backup'}
                </button>

                {isBackingUp && (
                    <p className={styles.hint}>
                        This can take a moment on a large database — please keep this tab open
                        until the file finishes downloading.
                    </p>
                )}
            </div>
        </div>
    );
};

export default DatabaseBackupSettings;
