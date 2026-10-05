import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Modal from './Modal';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string | ReactNode;
    /**
     * May be async. While its promise is pending both buttons are disabled and a
     * second Confirm is ignored: a double click used to run the handler twice — two
     * DELETEs (the second toasting "not found" after the success) and two POSTs for
     * an "Add" (FE-F17-10 / FE-F18-9).
     */
    onConfirm: () => void | Promise<unknown>;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
    /** The caller's own in-flight flag, for a confirm whose work outlives `onConfirm`'s promise. */
    busy?: boolean;
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
    busy = false,
}: ConfirmDialogProps) => {
    // Generated, not a literal: a confirm can be raised from inside another
    // ConfirmDialog, so two can be mounted at once.
    const titleId = useId();
    const [running, setRunning] = useState(false);
    const working = busy || running;

    const handleConfirm = (): void => {
        if (working) return;
        const result = onConfirm();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            setRunning(true);
            void (result as Promise<unknown>).finally(() => setRunning(false));
        }
    };
    const handleCancel = (): void => {
        if (!working) onCancel();
    };

    const messageContent = typeof message === 'string'
        ? message.split('\n').filter((l) => l.trim() !== '').map((line, i) => (
            <p key={i} className={styles.line}>{line}</p>
        ))
        : <div className={styles.line}>{message}</div>;

    return (
        <Modal isOpen={isOpen} onClose={handleCancel} closeOnBackdropClick={false} overlayClassName={styles.overlay} ariaLabelledBy={titleId}>
            <div className={styles.dialog}>
                {/* data-modal-drag-handle: without a handle the shared Modal treats the
                    WHOLE body as a drag surface and sets user-select:none on <body> at
                    pointerdown, so the message text couldn't be selected or copied. */}
                <h2 id={titleId} className={styles.title} data-modal-drag-handle>{title}</h2>
                <div className={styles.body}>{messageContent}</div>
                <div className={styles.actions}>
                    <button className="btn btn-secondary" onClick={handleCancel} disabled={working}>
                        {cancelText}
                    </button>
                    <button
                        className={`btn ${isDangerous ? 'btn-danger' : 'btn-primary'}`}
                        onClick={handleConfirm}
                        disabled={working}
                        aria-busy={working}
                    >
                        {working ? 'Working…' : confirmText}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ConfirmDialog;
