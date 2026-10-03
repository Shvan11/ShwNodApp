/**
 * Actions popover for a time-point tab: Edit, Re-import, and three delete
 * variants. Portaled to <body> and fixed-positioned from the kebab button's
 * viewport coordinates so it escapes the timepoint selector's `overflow-x` clip
 * and the tab `:hover` transform. Keyboard behaviour (focus in on open, arrows,
 * Escape, focus back to the kebab on close) and viewport clamping come from the
 * shared `useFloatingMenu` (FE-F12-13b).
 */
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingMenu } from '@/hooks/useFloatingMenu';
import styles from './TimepointActionsMenu.module.css';

export type DeleteScope = 'cropped' | 'entry' | 'all';
export type FolderState = 'checking' | 'present' | 'absent';

interface Props {
    x: number;
    y: number;
    folderState: FolderState;
    onEdit: () => void;
    onReimport: () => void;
    onOpenFolder: () => void;
    onOpenWorking: () => void;
    onDelete: (scope: DeleteScope) => void;
    onClose: () => void;
}

const MENU_WIDTH = 270;

const TimepointActionsMenu = ({
    x,
    y,
    folderState,
    onEdit,
    onReimport,
    onOpenFolder,
    onOpenWorking,
    onDelete,
    onClose,
}: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const { position, onKeyDown } = useFloatingMenu(ref, { x, y }, onClose);

    return createPortal(
        <div
            ref={ref}
            className={styles.menu}
            role="menu"
            tabIndex={-1}
            aria-label="Photo session actions"
            style={{ left: position.x, top: position.y, width: MENU_WIDTH }}
            onKeyDown={onKeyDown}
        >
            <button type="button" role="menuitem" className={styles.item} onClick={onEdit}>
                <i className="fas fa-pen" aria-hidden="true"></i>
                <span className={styles.itemText}>Edit name &amp; date</span>
            </button>
            <button type="button" role="menuitem" className={styles.item} onClick={onReimport}>
                <i className="fas fa-images" aria-hidden="true"></i>
                <span className={styles.itemText}>Re-import photos</span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={onOpenFolder}
                disabled={folderState !== 'present'}
                title={
                    folderState === 'absent'
                        ? 'No original photos folder for this photo session'
                        : undefined
                }
            >
                <i className="fas fa-folder-open" aria-hidden="true"></i>
                <span className={styles.itemText}>
                    Open original folder
                    {folderState === 'checking' && <small className={styles.hint}>Checking…</small>}
                    {folderState === 'absent' && <small className={styles.hint}>No folder</small>}
                </span>
            </button>
            <button type="button" role="menuitem" className={styles.item} onClick={onOpenWorking}>
                <i className="fas fa-images" aria-hidden="true"></i>
                <span className={styles.itemText}>
                    Open working files
                    <small className={styles.hint}>Rendered photos for this patient</small>
                </span>
            </button>

            <div className={styles.divider} role="separator" />
            <div className={styles.sectionLabel}>Delete</div>

            <button
                type="button"
                role="menuitem"
                className={`${styles.item} ${styles.danger}`}
                onClick={() => onDelete('cropped')}
            >
                <i className="fas fa-crop-simple" aria-hidden="true"></i>
                <span className={styles.itemText}>
                    Cropped photos only
                    <small className={styles.hint}>Keeps session &amp; originals</small>
                </span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={`${styles.item} ${styles.danger}`}
                onClick={() => onDelete('entry')}
            >
                <i className="fas fa-eraser" aria-hidden="true"></i>
                <span className={styles.itemText}>
                    Cropped + session
                    <small className={styles.hint}>Keeps original photos</small>
                </span>
            </button>
            <button
                type="button"
                role="menuitem"
                className={`${styles.item} ${styles.danger}`}
                onClick={() => onDelete('all')}
            >
                <i className="fas fa-trash" aria-hidden="true"></i>
                <span className={styles.itemText}>
                    Everything
                    <small className={styles.hint}>Originals to trash + cropped + session</small>
                </span>
            </button>
        </div>,
        document.body
    );
};

export default TimepointActionsMenu;
