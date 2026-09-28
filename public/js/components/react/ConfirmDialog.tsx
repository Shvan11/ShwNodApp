import { useId } from 'react';
import type { ReactNode } from 'react';
import Modal from './Modal';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string | ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
}

const ConfirmDialog = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDangerous = false,
}: ConfirmDialogProps) => {
    // Generated, not a literal: a confirm can be raised from inside another
    // ConfirmDialog, so two can be mounted at once.
    const titleId = useId();

    const messageContent = typeof message === 'string'
        ? message.split('\n').filter((l) => l.trim() !== '').map((line, i) => (
            <p key={i} className={styles.line}>{line}</p>
        ))
        : <div className={styles.line}>{message}</div>;

    return (
        <Modal isOpen={isOpen} onClose={onCancel} closeOnBackdropClick={false} overlayClassName={styles.overlay} ariaLabelledBy={titleId}>
            <div className={styles.dialog}>
                {/* data-modal-drag-handle: without a handle the shared Modal treats the
                    WHOLE body as a drag surface and sets user-select:none on <body> at
                    pointerdown, so the message text couldn't be selected or copied. */}
                <h2 id={titleId} className={styles.title} data-modal-drag-handle>{title}</h2>
                <div className={styles.body}>{messageContent}</div>
                <div className={styles.actions}>
                    <button className="btn btn-secondary" onClick={onCancel}>
                        {cancelText}
                    </button>
                    <button
                        className={`btn ${isDangerous ? 'btn-danger' : 'btn-primary'}`}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ConfirmDialog;
