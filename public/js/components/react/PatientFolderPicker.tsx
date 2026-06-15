import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FileEntry } from '@/types/api.types';
import { httpErrorMessage } from '@/core/http';
import { patientFilesQuery } from '@/query/queries';
import type * as fileExplorer from '@shared/contracts/file-explorer.contract';
import { buildContentUrl, categoryIcon, formatSize } from './files/fileHelpers';
import styles from './PatientFolderPicker.module.css';

interface Props {
    personId: number;
    /** relPath of the currently-picked file, so it renders highlighted. */
    selectedRelPath?: string | null;
    /** Fired when the user clicks an image file. */
    onSelect: (entry: FileEntry) => void;
}

/**
 * Navigable browser over a patient's server folder (`clinic1/{personId}/…`),
 * used to pick a cephalogram image that already exists on the server (so the
 * server can read it directly instead of the user uploading from their PC).
 * Reuses the file-explorer listing endpoint + thumbnail/content helpers. Only
 * folders (to navigate) and image files (to pick) are shown — other file types
 * are hidden to keep the picker focused on choosing an image.
 */
const PatientFolderPicker = ({ personId, selectedRelPath, onSelect }: Props) => {
    const [currentPath, setCurrentPath] = useState('');
    const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set());

    const { data, isLoading: loading, error: queryError, refetch } = useQuery({
        ...patientFilesQuery(personId, currentPath),
        enabled: personId != null,
    });
    const listing = (data ?? null) as fileExplorer.FileListing | null;
    const error = queryError ? httpErrorMessage(queryError, 'Failed to load folder') : null;

    const markThumbError = (relPath: string) =>
        setThumbErrors((prev) => new Set(prev).add(relPath));

    // Folders first (to navigate), then image files (to pick); everything else hidden.
    const entries = (listing?.entries ?? [])
        .filter((e) => e.type === 'dir' || e.category === 'image')
        .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

    return (
        <div className={styles.picker}>
            <div className={styles.toolbar}>
                <button
                    type="button"
                    className={styles.upBtn}
                    onClick={() => listing?.parent != null && setCurrentPath(listing.parent)}
                    disabled={!listing || listing.parent == null}
                    title="Up one folder"
                >
                    <i className="fas fa-arrow-up" /> Up
                </button>
                <span className={styles.breadcrumb} title={listing?.path || 'Patient folder'}>
                    <i className="fas fa-folder-open" />{' '}
                    {listing?.path ? listing.path : 'Patient folder'}
                </span>
            </div>

            {loading ? (
                <div className={styles.state}>
                    <i className="fas fa-spinner fa-spin" /> Loading…
                </div>
            ) : error ? (
                <div className={styles.state}>
                    <i className="fas fa-exclamation-triangle" /> {error}
                    <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
                        Retry
                    </button>
                </div>
            ) : entries.length === 0 ? (
                <div className={styles.state}>No images or folders here.</div>
            ) : (
                <div className={styles.grid}>
                    {entries.map((entry) => {
                        if (entry.type === 'dir') {
                            return (
                                <button
                                    key={entry.relPath}
                                    type="button"
                                    className={styles.tile}
                                    onClick={() => setCurrentPath(entry.relPath)}
                                >
                                    <span className={styles.thumb}>
                                        <i className={`fas fa-folder ${styles.folderIcon}`} />
                                    </span>
                                    <span className={styles.name} title={entry.name}>{entry.name}</span>
                                </button>
                            );
                        }

                        const isSelected = selectedRelPath === entry.relPath;
                        const showThumb = !thumbErrors.has(entry.relPath);
                        return (
                            <button
                                key={entry.relPath}
                                type="button"
                                className={`${styles.tile} ${isSelected ? styles.selected : ''}`}
                                onClick={() => onSelect(entry)}
                                title={entry.name}
                            >
                                <span className={styles.thumb}>
                                    {showThumb ? (
                                        <img
                                            src={buildContentUrl(personId, entry.relPath, { thumb: 240, v: entry.modified })}
                                            alt={entry.name}
                                            loading="lazy"
                                            onError={() => markThumbError(entry.relPath)}
                                        />
                                    ) : (
                                        <i className={`fas ${categoryIcon(entry)} ${styles.fileIcon}`} />
                                    )}
                                    {isSelected && (
                                        <span className={styles.check}>
                                            <i className="fas fa-check-circle" />
                                        </span>
                                    )}
                                </span>
                                <span className={styles.name}>{entry.name}</span>
                                {entry.size != null && <span className={styles.meta}>{formatSize(entry.size)}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default PatientFolderPicker;
