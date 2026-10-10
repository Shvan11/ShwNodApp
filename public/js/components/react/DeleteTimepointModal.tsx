/**
 * Confirm deletion of a time point at one of three scopes. The parent runs the
 * DELETE and refreshes; this just spells out exactly what will and won't be
 * removed so the action is never ambiguous.
 */
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './TimepointModals.module.css';
import type { TimepointRow } from '@shared/contracts/patient.contract';
import type { WorkingFileEntry } from '@shared/contracts/file-explorer.contract';
import { isViewCode } from '@shared/photo-views';
import type { DeleteScope } from './TimepointActionsMenu';

// The timepoints read's own row (FE-F12-15: no hand-written copy, no adapter).
type Timepoint = TimepointRow;

interface Props {
    isOpen: boolean;
    timepoint: Timepoint | null;
    scope: DeleteScope;
    /** The session's files in Dolphin's working gallery (the working-files listing), to name what goes. */
    sessionFiles: readonly WorkingFileEntry[];
    deleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

interface Consequence {
    removed: boolean;
    text: string;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
const listOf = (parts: string[]): string =>
    parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * What each scope removes and keeps. Every photo a delete takes goes to the clinic's
 * trash folder, a cropped photo together with Dolphin's original of it (its `.vNN` V
 * file) when the slot has one: the server never splits the pair. Only the session entry
 * itself is gone for good. Dolphin's other slots (X-rays, …) and its V files are named
 * only when the session has some, so a session the app made reads as it always has.
 */
function scopeConfig(
    scope: DeleteScope,
    files: readonly WorkingFileEntry[]
): { title: string; confirmLabel: string; lines: Consequence[] } {
    const vOfViews = files.filter((e) => e.original && isViewCode(e.view)).length;
    const vAll = files.filter((e) => e.original).length;
    const others = files.filter((e) => !e.original && !isViewCode(e.view)).length;
    const vFiles = (n: number): string => `Dolphin's originals of them (${count(n, 'V file', 'V files')})`;
    // Everything of the session's that goes when the session itself does.
    const sessionPhotos = listOf([
        'Modified (cropped) photos',
        ...(others > 0 ? [count(others, 'other Dolphin image (X-ray, …)', 'other Dolphin images (X-rays, …)')] : []),
        ...(vAll > 0 ? [vFiles(vAll)] : []),
    ]);
    switch (scope) {
        case 'cropped':
            return {
                title: 'Delete cropped photos',
                confirmLabel: 'Delete cropped photos',
                lines: [
                    {
                        removed: true,
                        text: `Modified (cropped) photos${vOfViews > 0 ? `, with ${vFiles(vOfViews)},` : ''} will be moved to the clinic's trash folder`,
                    },
                    { removed: false, text: 'Original photos in the session folder are kept' },
                    {
                        removed: false,
                        text:
                            others > 0
                                ? `Photo session entry and its ${count(others, 'other Dolphin image', 'other Dolphin images')} (X-rays, …) are kept`
                                : 'Photo session entry is kept',
                    },
                ],
            };
        case 'entry':
            return {
                title: 'Delete cropped photos + session',
                confirmLabel: 'Delete photo session',
                lines: [
                    { removed: true, text: `${sessionPhotos} will be moved to the clinic's trash folder` },
                    { removed: true, text: 'The photo session entry will be removed' },
                    { removed: false, text: 'Original photos are kept in their folder' },
                ],
            };
        case 'all':
            return {
                title: 'Delete everything',
                confirmLabel: 'Delete everything',
                lines: [
                    { removed: true, text: "Original photos will be moved to the clinic's trash folder (recoverable on the server)" },
                    { removed: true, text: `${sessionPhotos} will be moved there too` },
                    { removed: true, text: 'The photo session entry will be removed' },
                ],
            };
    }
}

const DeleteTimepointModal = ({ isOpen, timepoint, scope, sessionFiles, deleting, onConfirm, onCancel }: Props) => {
    if (!timepoint) return null;

    const cfg = scopeConfig(scope, sessionFiles);
    const date = (timepoint.tp_date_time ?? '').substring(0, 10).split('-').reverse().join('-');
    const label = `${timepoint.tp_description || 'this photo session'}${date ? ` (${date})` : ''}`;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            contentClassName={`${styles.modalContent} ${styles.modalSm}`}
            ariaLabelledBy="delete-tp-title"
        >
            <ModalHeader
                variant="danger"
                title={cfg.title}
                titleId="delete-tp-title"
                onClose={onCancel}
                closeLabel="Close modal"
            />

            <div className={styles.modalBody}>
                <p className={styles.warningText}>
                    For <strong>{label}</strong>:
                </p>
                <ul className={styles.consequenceList}>
                    {cfg.lines.map((line, i) => (
                        <li
                            key={i}
                            className={line.removed ? styles.consequenceRemoved : styles.consequenceKept}
                        >
                            <i
                                className={line.removed ? 'fas fa-times-circle' : 'fas fa-check-circle'}
                                aria-hidden="true"
                            ></i>
                            {line.text}
                        </li>
                    ))}
                </ul>
                <p className={styles.warningSubtle}>
                    {scope === 'cropped'
                        ? "The photos can be restored from the clinic's trash folder on the server."
                        : "The session entry cannot be restored. Its photos can, from the clinic's trash folder on the server."}
                </p>
            </div>

            <div className={styles.modalFooter}>
                <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={deleting}>
                    Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
                    {deleting ? 'Deleting…' : cfg.confirmLabel}
                </button>
            </div>
        </Modal>
    );
};

export default DeleteTimepointModal;
