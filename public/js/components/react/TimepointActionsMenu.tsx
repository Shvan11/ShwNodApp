/**
 * Actions popover for a time-point tab: Edit, Re-import, and three delete
 * variants. Portaled to <body> and fixed-positioned from the kebab button's
 * viewport coordinates so it escapes the timepoint selector's `overflow-x` clip
 * and the tab `:hover` transform. Closes on outside-click/Esc.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
const MENU_HEIGHT = 380;

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

    useEffect(() => {
        const handleOutside = (e: globalThis.MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const handleEsc = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        // Defer the outside-click listener one frame so the opening click
        // doesn't immediately close the menu.
        const frame = requestAnimationFrame(() => document.addEventListener('mousedown', handleOutside));
        document.addEventListener('keydown', handleEsc);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    // Keep the menu inside the viewport.
    const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8));

    return createPortal(
        <div ref={ref} className={styles.menu} role="menu" style={{ left, top, width: MENU_WIDTH }}>
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
                    <small className={styles.hint}>Originals + cropped + session</small>
                </span>
            </button>
        </div>,
        document.body
    );
};

export default TimepointActionsMenu;
