/**
 * The file explorer's actions menu — what a right-click (a long-press on a phone)
 * or a tile's ⋯ button opens, like a desktop file manager's context menu.
 *
 * On entries it offers Open, Download, Share, Cut, Copy, Move to…, Copy to…,
 * Rename (and, on a folder, Rename to existing timepoint…) and Delete; on the
 * folder's empty space, New folder, Paste, Upload and
 * Refresh. Several entries (a right-click on part of the selection) get only what
 * applies to many. Portaled to <body> and fixed-positioned so the virtualized
 * list's overflow can't clip it; focus, arrows, Escape and viewport clamping are
 * `useFloatingMenu`'s.
 */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FileEntry } from '@/types/api.types';
import { useFloatingMenu, type MenuAnchor } from '@/hooks/useFloatingMenu';
import styles from './FileExplorer.module.css';

export type FileAction =
  | 'open'
  | 'share'
  | 'cut'
  | 'copy'
  | 'moveTo'
  | 'copyTo'
  | 'rename'
  | 'renameToTimepoint'
  | 'delete'
  | 'paste'
  | 'newFolder'
  | 'upload'
  | 'refresh';

interface Props {
  anchor: MenuAnchor;
  /** The entries it acts on, or null for the folder being viewed (its empty space). */
  targets: FileEntry[] | null;
  /** Download link for a single file (the menu item is a real link). */
  downloadHref?: string;
  /** Paste: the label ("Paste 3 items"), or null when there is nothing to paste. */
  pasteLabel: string | null;
  /** Why Paste / New folder / Upload can't run here (flat view, folder into itself…). */
  pasteBlockedReason?: string | null;
  /** Flat view lists a whole subtree: nothing is created in it. */
  flat: boolean;
  onAction: (action: FileAction) => void;
  onClose: () => void;
}

const countLabel = (n: number): string => `${n} item${n === 1 ? '' : 's'}`;

const FileActionsMenu = ({
  anchor,
  targets,
  downloadHref,
  pasteLabel,
  pasteBlockedReason,
  flat,
  onAction,
  onClose,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const { position, onKeyDown } = useFloatingMenu(ref, anchor, onClose);

  const item = (
    action: FileAction,
    icon: string,
    label: string,
    opts: { disabled?: boolean; title?: string; danger?: boolean; hint?: string } = {}
  ) => (
    <button
      type="button"
      role="menuitem"
      className={`${styles.menuItem} ${opts.danger ? styles.menuDanger : ''}`}
      onClick={() => onAction(action)}
      disabled={opts.disabled}
      title={opts.title}
    >
      <i className={`fas ${icon}`} aria-hidden="true" />
      <span className={styles.menuLabel}>{label}</span>
      {opts.hint && <kbd className={styles.menuHint}>{opts.hint}</kbd>}
    </button>
  );

  let body;
  if (!targets) {
    body = (
      <>
        {item('newFolder', 'fa-folder-plus', 'New folder', {
          disabled: flat,
          title: flat ? 'Switch off flat view to create folders' : undefined,
        })}
        {pasteLabel &&
          item('paste', 'fa-paste', pasteLabel, {
            disabled: !!pasteBlockedReason,
            title: pasteBlockedReason ?? undefined,
            hint: 'Ctrl+V',
          })}
        {item('upload', 'fa-upload', 'Upload files', {
          disabled: flat,
          title: flat ? 'Switch off flat view to upload' : undefined,
        })}
        <div className={styles.menuDivider} role="separator" />
        {item('refresh', 'fa-rotate-right', 'Refresh')}
      </>
    );
  } else {
    const single = targets.length === 1 ? targets[0] : null;
    const files = targets.filter((e) => e.type !== 'dir');
    const what = single ? '' : ` ${countLabel(targets.length)}`;
    body = (
      <>
        {single &&
          item('open', single.type === 'dir' ? 'fa-folder-open' : 'fa-eye', single.type === 'dir' ? 'Open' : 'Preview')}
        {single && single.type !== 'dir' && downloadHref && (
          // Closed on the next tick: unmounting the link inside its own click could cancel the download.
          <a
            role="menuitem"
            className={styles.menuItem}
            href={downloadHref}
            onClick={() => window.setTimeout(onClose, 0)}
          >
            <i className="fas fa-download" aria-hidden="true" />
            <span className={styles.menuLabel}>Download</span>
          </a>
        )}
        {files.length > 0 &&
          item('share', 'fa-share-nodes', files.length === targets.length ? `Share${what}` : `Share ${countLabel(files.length)}`)}
        <div className={styles.menuDivider} role="separator" />
        {item('cut', 'fa-scissors', `Cut${what}`)}
        {item('copy', 'fa-copy', `Copy${what}`)}
        {item('moveTo', 'fa-folder-tree', `Move${what} to…`)}
        {item('copyTo', 'fa-clone', `Copy${what} to…`)}
        <div className={styles.menuDivider} role="separator" />
        {single && item('rename', 'fa-pen', 'Rename')}
        {single?.type === 'dir' && item('renameToTimepoint', 'fa-camera', 'Rename to existing timepoint…')}
        {item('delete', 'fa-trash-can', `Delete${what}`, { danger: true })}
      </>
    );
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      tabIndex={-1}
      aria-label={targets ? (targets.length === 1 ? targets[0].name : countLabel(targets.length)) : 'Folder actions'}
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {body}
    </div>,
    document.body
  );
};

export default FileActionsMenu;
