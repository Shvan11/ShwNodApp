/**
 * One file/folder entry, rendered as a grid tile or a list row. Image entries
 * show a lazily-loaded server thumbnail (falling back to an icon on error).
 *
 * In selection mode the whole tile becomes a checkbox: clicking toggles
 * selection instead of opening/previewing, and the per-entry action buttons are
 * hidden (bulk actions live in the explorer's selection bar).
 */
import { useState, type MouseEvent } from 'react';
import type { FileEntry } from '@/types/api.types';
import {
  buildContentUrl,
  categoryIcon,
  formatSize,
  formatDate,
  type ContentUrlOptions,
} from './fileHelpers';
import styles from './FileExplorer.module.css';

type UrlBuilder = (personId: number, relPath: string, opts?: ContentUrlOptions) => string;

interface Props {
  personId: number;
  entry: FileEntry;
  view: 'grid' | 'list';
  /** Flat mode: show the full relative subpath instead of just the name. */
  showFullPath?: boolean;
  /** Selection mode: tile toggles selection instead of opening. */
  selectMode?: boolean;
  selected?: boolean;
  /** Read-only: hide rename/delete (download stays). Used by the working-files view. */
  readOnly?: boolean;
  /** Override how content/thumbnail/download URLs are built (default: patient files). */
  buildUrl?: UrlBuilder;
  onOpen: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onToggleSelect: (entry: FileEntry) => void;
  /** Share this file to a LAN device (LocalSend). Omitted → no share button. */
  onShare?: (entry: FileEntry) => void;
}

const FileEntryTile = ({
  personId,
  entry,
  view,
  showFullPath,
  selectMode,
  selected,
  readOnly,
  buildUrl = buildContentUrl,
  onOpen,
  onRename,
  onDelete,
  onToggleSelect,
  onShare,
}: Props) => {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isDir = entry.type === 'dir';
  const showThumb = entry.category === 'image' && !thumbFailed;
  const label = showFullPath ? entry.relPath : entry.name;

  const stop = (e: MouseEvent): void => {
    e.stopPropagation();
  };

  const activate = (): void => {
    if (selectMode) onToggleSelect(entry);
    else onOpen(entry);
  };

  // Version the thumbnail URL by the file's mtime so a re-rendered image busts
  // the browser's (7-day) thumbnail cache instead of showing a stale crop.
  const thumbVersion = entry.modified ? Date.parse(entry.modified) || undefined : undefined;
  const visual = showThumb ? (
    <img
      className={styles.thumb}
      src={buildUrl(personId, entry.relPath, { thumb: 240, v: thumbVersion })}
      loading="lazy"
      alt=""
      onError={() => setThumbFailed(true)}
    />
  ) : (
    <i className={`fas ${categoryIcon(entry)} ${styles.entryIcon}`} aria-hidden="true" />
  );

  const meta = [formatSize(entry.size), formatDate(entry.modified)].filter(Boolean).join(' · ');

  const selectedClass =
    selectMode && selected ? (view === 'grid' ? styles.tileSelected : styles.rowSelected) : '';

  return (
    <div
      className={`${view === 'grid' ? styles.tile : styles.row} ${selectedClass}`.trim()}
      onClick={activate}
      onDoubleClick={selectMode ? undefined : () => onOpen(entry)}
      role={selectMode ? 'checkbox' : 'button'}
      aria-checked={selectMode ? !!selected : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      title={label}
    >
      {selectMode && (
        <span
          className={`${styles.selectCheck} ${selected ? styles.selectCheckOn : ''}`}
          aria-hidden="true"
        >
          {selected && <i className="fas fa-check" />}
        </span>
      )}

      <div className={styles.entryVisual}>{visual}</div>

      <div className={styles.entryInfo}>
        <span className={styles.entryName}>{label}</span>
        {meta && <span className={styles.entryMeta}>{meta}</span>}
      </div>

      {!selectMode && (
        <div className={styles.entryActions} onClick={stop}>
          {!isDir && (
            <a
              className={styles.iconButton}
              href={buildUrl(personId, entry.relPath, { download: true })}
              title="Download"
              aria-label={`Download ${entry.name}`}
            >
              <i className="fas fa-download" aria-hidden="true" />
            </a>
          )}
          {!isDir && onShare && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => onShare(entry)}
              title="Share to device"
              aria-label={`Share ${entry.name} to a device`}
            >
              <i className="fas fa-share-nodes" aria-hidden="true" />
            </button>
          )}
          {!readOnly && (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FileEntryTile;
