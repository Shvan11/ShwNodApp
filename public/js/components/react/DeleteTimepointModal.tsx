/**
 * Confirm deletion of a time point at one of three scopes. The parent runs the
 * DELETE and refreshes; this just spells out exactly what will and won't be
 * removed so the action is never ambiguous.
 */
import Modal from './Modal';
import styles from './TimepointModals.module.css';
import type { DeleteScope } from './TimepointActionsMenu';

interface Timepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

interface Props {
    isOpen: boolean;
    timepoint: Timepoint | null;
    scope: DeleteScope;
    deleting: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

interface Consequence {
    removed: boolean;
    text: string;
}

const SCOPE_CONFIG: Record<DeleteScope, { title: string; confirmLabel: string; lines: Consequence[] }> = {
    cropped: {
        title: 'Delete cropped photos',
        confirmLabel: 'Delete cropped photos',
        lines: [
            { removed: true, text: 'Modified (cropped) photos will be deleted' },
            { removed: false, text: 'Original photos are kept' },
            { removed: false, text: 'Time point entry is kept' },
        ],
    },
    entry: {
        title: 'Delete cropped photos + time point',
        confirmLabel: 'Delete time point',
        lines: [
            { removed: true, text: 'Modified (cropped) photos will be deleted' },
            { removed: true, text: 'The time point entry will be removed' },
            { removed: false, text: 'Original photos are kept in their folder' },
        ],
    },
    all: {
        title: 'Delete everything',
        confirmLabel: 'Delete everything',
        lines: [
            { removed: true, text: 'Original photos will be permanently deleted' },
            { removed: true, text: 'Modified (cropped) photos will be deleted' },
            { removed: true, text: 'The time point entry will be removed' },
        ],
    },
};

const DeleteTimepointModal = ({ isOpen, timepoint, scope, deleting, onConfirm, onCancel }: Props) => {
    if (!timepoint) return null;

    const cfg = SCOPE_CONFIG[scope];
    const date = (timepoint.tpDateTime ?? '').substring(0, 10).split('-').reverse().join('-');
    const label = `${timepoint.tpDescription || 'this time point'}${date ? ` (${date})` : ''}`;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            contentClassName={`${styles.modalContent} ${styles.modalSm}`}
            ariaLabelledBy="delete-tp-title"
        >
            <div className={styles.modalHeader}>
                <h2 id="delete-tp-title">{cfg.title}</h2>
                <button type="button" className={styles.closeBtn} onClick={onCancel} aria-label="Close modal">
                    &times;
                </button>
            </div>

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
                <p className={styles.warningSubtle}>This action cannot be undone.</p>
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
