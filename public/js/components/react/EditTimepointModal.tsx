/**
 * Edit a time point's name and date. Prefilled from the selected tab; on save it
 * PUTs to /api/patients/:personId/timepoints/:tpCode (the parent owns the request
 * + list refresh). Mirrors the expenses edit-modal pattern.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Modal from './Modal';
import styles from './TimepointModals.module.css';

interface Timepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

interface Props {
    isOpen: boolean;
    timepoint: Timepoint | null;
    saving: boolean;
    onClose: () => void;
    onSave: (fields: { tpDescription: string; tpDateTime: string }) => void;
}

const EditTimepointModal = ({ isOpen, timepoint, saving, onClose, onSave }: Props) => {
    const [name, setName] = useState('');
    const [date, setDate] = useState('');

    useEffect(() => {
        if (timepoint) {
            setName(timepoint.tpDescription ?? '');
            setDate((timepoint.tpDateTime ?? '').substring(0, 10));
        }
    }, [timepoint]);

    if (!timepoint) return null;

    const canSave = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !saving;

    const handleSubmit = (e: FormEvent): void => {
        e.preventDefault();
        if (!canSave) return;
        onSave({ tpDescription: name.trim(), tpDateTime: date });
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            contentClassName={styles.modalContent}
            ariaLabelledBy="edit-tp-title"
        >
            <form onSubmit={handleSubmit}>
                <div className={styles.modalHeader}>
                    <h2 id="edit-tp-title">Edit Time Point</h2>
                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
                        &times;
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <label className={styles.field}>
                        <span className={styles.label}>Name</span>
                        <input
                            className={styles.input}
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Initial, Progress, Final"
                            autoFocus
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.label}>Date</span>
                        <input
                            className={styles.input}
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </label>
                </div>

                <div className={styles.modalFooter}>
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!canSave}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default EditTimepointModal;
