/**
 * One file/folder entry, rendered as a grid tile or a list row. Image entries
 * show a lazily-loaded server thumbnail (falling back to an icon on error).
 *
 * In selection mode the whole tile becomes a checkbox: clicking toggles
 * selection instead of opening/previewing, and the per-entry action buttons are
 * hidden (bulk actions live in the explorer's selection bar).
 *
 * The keyboard/screen-reader control is the NAME button (a checkbox in selection
 * mode); the tile's own click is a mouse convenience. The tile used to be a
 * `role="button"` wrapping its own Download/Share/Rename/Delete buttons — nested
 * interactive controls whose accessible name ran them all together (FE-F12-13a).
 *
 * With `onMenu` the tile behaves like one in a desktop file manager: a right-click
 * (long-press on a phone) or its ⋯ button opens the actions menu (Rename, Delete,
 * Cut, Copy, Move to… live there), it can be dragged, and a folder takes drops.
 */
import { useState, type DragEvent, type MouseEvent } from 'react';
import type { FileEntry } from '@/types/api.types';
import { anchorFrom, type MenuAnchor } from '@/hooks/useFloatingMenu';
import {
  buildContentUrl,
  categoryIcon,
  formatSize,
  formatDate,
  type ContentUrlOptions,
} from './fileHelpers';
import { formatLocaleDate, formatLocaleTime, formatPhotoTakenAt } from '@/utils/formatters';
import styles from './FileExplorer.module.css';

type UrlBuilder = (personId: number, relPath: string, opts?: ContentUrlOptions) => string;

interface Props {
  personId: number;
  entry: FileEntry;
  view: 'grid' | 'list';
  /** Flat mode: show the full relative subpath instead of just the name. */
  showFullPath?: boolean;
  /** Shown instead of the name/path (the working-files view names a tile by its slot, "OPG"). */
  displayName?: string;
  /**
   * A short mark in the tile's corner, with a hover explanation (the working-files view
   * tags Dolphin's originals "V file"). Visual only: say the same in `displayName`.
   */
  badge?: { label: string; title: string };
  /** When the photo was taken (EXIF, 'YYYY-MM-DDTHH:MM:SS'), shown under the name. */
  takenAt?: string | null;
  /** Selection mode: tile toggles selection instead of opening. */
  selectMode?: boolean;
  selected?: boolean;
  /** Override how content/thumbnail/download URLs are built (default: patient files). */
  buildUrl?: UrlBuilder;
  onOpen: (entry: FileEntry) => void;
  /**
   * Rename / Delete buttons on the tile, each shown when given — only without `onMenu`,
   * which holds them instead. The working-files view passes Delete alone.
   */
  onRename?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onToggleSelect: (entry: FileEntry) => void;
  /** Share this file (opens the share sheet: LocalSend / Telegram). Omitted → no share button. */
  onShare?: (entry: FileEntry) => void;
  /**
   * Open the actions menu at `anchor` (right-click, long-press, the ⋯ button). When
   * set, Rename/Delete move into that menu instead of being buttons on the tile.
   */
  onMenu?: (entry: FileEntry, anchor: MenuAnchor) => void;
  /** On the clipboard as cut, waiting for Paste. */
  cut?: boolean;
  /** Makes the tile draggable (onto a folder: move, or copy with Ctrl held). */
  onDragStart?: (entry: FileEntry, e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  /**
   * A folder's drop target. `onDragOver` returns whether this drag can land here
   * (and has then called preventDefault); the tile only shows its highlight then.
   */
  drop?: {
    onDragOver: (entry: FileEntry, e: DragEvent<HTMLDivElement>) => boolean;
    onDrop: (entry: FileEntry, e: DragEvent<HTMLDivElement>) => void;
  };
}

const FileEntryTile = ({
  personId,
  entry,
  view,
  showFullPath,
  displayName,
  badge,
  takenAt,
  selectMode,
  selected,
  buildUrl = buildContentUrl,
  onOpen,
  onRename,
  onDelete,
  onToggleSelect,
  onShare,
  onMenu,
  cut,
  onDragStart,
  onDragEnd,
  drop,
}: Props) => {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const isDir = entry.type === 'dir';
  const showThumb = entry.category === 'image' && !thumbFailed;
  const label = displayName ?? (showFullPath ? entry.relPath : entry.name);

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
  const dropHandlers = isDir ? drop : undefined;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- mouse convenience: the whole tile is a click target; the name button below is the keyboard/AT control
    <div
      className={[
        view === 'grid' ? styles.tile : styles.row,
        selectedClass,
        cut ? styles.entryCut : '',
        dropOver ? styles.dropTarget : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={activate}
      onDoubleClick={selectMode ? undefined : () => onOpen(entry)}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu(entry, anchorFrom(e));
            }
          : undefined
      }
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart ? (e) => onDragStart(entry, e) : undefined}
      onDragEnd={onDragEnd}
      onDragOver={
        dropHandlers
          ? (e) => {
              const ok = dropHandlers.onDragOver(entry, e);
              if (ok !== dropOver) setDropOver(ok);
            }
          : undefined
      }
      onDragLeave={
        dropHandlers
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
            }
          : undefined
      }
      onDrop={
        dropHandlers
          ? (e) => {
              setDropOver(false);
              dropHandlers.onDrop(entry, e);
            }
          : undefined
      }
      title={label}
    >
      {selectMode && (
        <span
          className={`${styles.selectCheck} ${selected ? styles.selectCheckOn : ''}`}
          aria-hidden="true"
        >
          {selected && <i className="fas fa-check" aria-hidden="true" />}
        </span>
      )}

      {badge && (
        <span className={styles.entryBadge} title={badge.title} aria-hidden="true">
          {badge.label}
        </span>
      )}

      <div className={styles.entryVisual}>{visual}</div>

      <div className={styles.entryInfo}>
        <button
          type="button"
          className={styles.entryName}
          onClick={(e) => {
            e.stopPropagation();
            activate();
          }}
          role={selectMode ? 'checkbox' : undefined}
          aria-checked={selectMode ? !!selected : undefined}
          aria-label={selectMode ? label : `${isDir ? 'Open folder' : 'Preview'} ${label}`}
        >
          {label}
        </button>
        {takenAt && (
          <span className={styles.entryTaken} title={`Taken ${formatPhotoTakenAt(takenAt)}`}>
            <i className="fas fa-camera" aria-hidden="true" />
            <span className="sr-only">Taken </span>
            {formatLocaleDate(takenAt, { year: 'numeric', month: 'short', day: 'numeric' })}{' '}
            {formatLocaleTime(takenAt, { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        {meta && <span className={styles.entryMeta}>{meta}</span>}
      </div>

      {!selectMode && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- click-isolation wrapper (stopPropagation only); inner link/button are natively keyboard-accessible
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
              title="Share"
              aria-label={`Share ${entry.name}`}
            >
              <i className="fas fa-share-nodes" aria-hidden="true" />
            </button>
          )}
          {onMenu && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={(e) => onMenu(entry, anchorFrom(e))}
              title="More actions"
              aria-label={`More actions for ${entry.name}`}
              aria-haspopup="menu"
            >
              <i className="fas fa-ellipsis" aria-hidden="true" />
            </button>
          )}
          {!onMenu && onRename && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => onRename(entry)}
              title="Rename"
              aria-label={`Rename ${entry.name}`}
            >
              <i className="fas fa-pen" aria-hidden="true" />
            </button>
          )}
          {!onMenu && onDelete && (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.danger}`}
              onClick={() => onDelete(entry)}
              title="Delete"
              aria-label={`Delete ${entry.name}`}
            >
              <i className="fas fa-trash-can" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FileEntryTile;
