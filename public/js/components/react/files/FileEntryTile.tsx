/**
 * One file/folder entry, rendered as a grid tile or a list row. Image entries
 * show a lazily-loaded server thumbnail (falling back to an icon on error).
 */
import { useState, type MouseEvent } from 'react';
import type { FileEntry } from '@/types/api.types';
import { buildContentUrl, categoryIcon, formatSize, formatDate } from './fileHelpers';
import styles from './FileExplorer.module.css';

interface Props {
  personId: number;
  entry: FileEntry;
  view: 'grid' | 'list';
  /** Flat mode: show the full relative subpath instead of just the name. */
  showFullPath?: boolean;
  onOpen: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}

const FileEntryTile = ({ personId, entry, view, showFullPath, onOpen, onRename, onDelete }: Props) => {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isDir = entry.type === 'dir';
  const showThumb = entry.category === 'image' && !thumbFailed;
  const label = showFullPath ? entry.relPath : entry.name;

  const stop = (e: MouseEvent): void => {
    e.stopPropagation();
  };

  const visual = showThumb ? (
    <img
      className={styles.thumb}
      src={buildContentUrl(personId, entry.relPath, { thumb: 240 })}
      loading="lazy"
      alt=""
      onError={() => setThumbFailed(true)}
    />
  ) : (
    <i className={`fas ${categoryIcon(entry)} ${styles.entryIcon}`} aria-hidden="true" />
  );

  const meta = [formatSize(entry.size), formatDate(entry.modified)].filter(Boolean).join(' · ');

  return (
    <div
      className={view === 'grid' ? styles.tile : styles.row}
      onClick={() => onOpen(entry)}
      onDoubleClick={() => onOpen(entry)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(entry);
        }
      }}
      title={label}
    >
      <div className={styles.entryVisual}>{visual}</div>

      <div className={styles.entryInfo}>
        <span className={styles.entryName}>{label}</span>
        {meta && <span className={styles.entryMeta}>{meta}</span>}
      </div>

      <div className={styles.entryActions} onClick={stop}>
        {!isDir && (
          <a
            className={styles.iconButton}
            href={buildContentUrl(personId, entry.relPath, { download: true })}
            title="Download"
            aria-label={`Download ${entry.name}`}
          >
            <i className="fas fa-download" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => onRename(entry)}
          title="Rename"
          aria-label={`Rename ${entry.name}`}
        >
          <i className="fas fa-pen" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          onClick={() => onDelete(entry)}
          title="Delete"
          aria-label={`Delete ${entry.name}`}
        >
          <i className="fas fa-trash-can" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default FileEntryTile;
