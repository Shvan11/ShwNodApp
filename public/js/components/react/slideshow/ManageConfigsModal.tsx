/**
 * ManageConfigsModal — rename or delete saved slideshow configs.
 *
 * Lists this patient's saved sequences and the clinic-wide generic templates
 * (both groups are managed here — configs are clinic-wide, not per-user). Rename
 * is inline; delete asks for a one-tap confirm in the row. Writes go through the
 * parent's `onRename`/`onDelete` (which own the React Query invalidation).
 */
import { useState } from 'react';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import type { ConfigRow } from '@shared/contracts/slideshow.contract';
import styles from './SlideshowModals.module.css';

interface Props {
  personId: number;
  configs: ConfigRow[];
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

const ManageConfigsModal = ({ personId, configs, onRename, onDelete, onClose }: Props) => {
  const toast = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const patientConfigs = configs.filter((c) => c.kind === 'literal' && c.person_id === personId);
  const templates = configs.filter((c) => c.kind === 'template');

  const startEdit = (c: ConfigRow): void => {
    setEditingId(c.id);
    setEditName(c.name);
    setConfirmId(null);
  };
  const cancelEdit = (): void => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async (id: number): Promise<void> => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setBusyId(id);
    try {
      await onRename(id, trimmed);
      toast.success('Renamed');
      cancelEdit();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to rename'));
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (id: number): Promise<void> => {
    setBusyId(id);
    try {
      await onDelete(id);
      toast.success('Deleted');
      setConfirmId(null);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to delete'));
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = (c: ConfigRow) => {
    const isEditing = editingId === c.id;
    const isConfirming = confirmId === c.id;
    const busy = busyId === c.id;
    const slideCount = c.config.slides.length;

    if (isEditing) {
      return (
        <li key={c.id} className={styles.row}>
          <form
            className={styles.editForm}
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(c.id);
            }}
          >
            <input
              className={styles.editInput}
              value={editName}
              maxLength={120}
              aria-label="New name"
              onChange={(e) => setEditName(e.target.value)}
            />
            <button type="submit" className={styles.iconBtn} disabled={!editName.trim() || busy} title="Save">
              <i className="fas fa-check" />
            </button>
            <button type="button" className={styles.iconBtn} onClick={cancelEdit} disabled={busy} title="Cancel">
              <i className="fas fa-times" />
            </button>
          </form>
        </li>
      );
    }

    if (isConfirming) {
      return (
        <li key={c.id} className={styles.row}>
          <div className={styles.confirmRow}>
            <span className={styles.confirmText}>Delete “{c.name}”?</span>
            <button
              type="button"
              className={styles.iconBtnDanger}
              onClick={() => void doDelete(c.id)}
              disabled={busy}
              title="Confirm delete"
            >
              <i className="fas fa-trash" /> Delete
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => setConfirmId(null)} disabled={busy} title="Cancel">
              <i className="fas fa-times" />
            </button>
          </div>
        </li>
      );
    }

    return (
      <li key={c.id} className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.rowName} title={c.name}>
            {c.name}
          </span>
          <span className={styles.rowMeta}>
            {slideCount} slide{slideCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={styles.iconBtn} onClick={() => startEdit(c)} title="Rename" aria-label={`Rename ${c.name}`}>
            <i className="fas fa-pen" />
          </button>
          <button
            type="button"
            className={styles.iconBtnDanger}
            onClick={() => {
              setConfirmId(c.id);
              setEditingId(null);
            }}
            title="Delete"
            aria-label={`Delete ${c.name}`}
          >
            <i className="fas fa-trash" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <Modal isOpen onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="slideshow-manage-title">
      <ModalHeader
        title="Manage saved presentations"
        titleId="slideshow-manage-title"
        icon={<i className="fas fa-sliders" />}
        onClose={onClose}
      />
      <div className={styles.body}>
        {configs.length === 0 ? (
          <p className={styles.empty}>No saved presentations yet.</p>
        ) : (
          <>
            <div className={styles.group}>
              <div className={styles.groupLabel}>This patient</div>
              {patientConfigs.length === 0 ? (
                <p className={styles.empty}>No saved sequences for this patient.</p>
              ) : (
                <ul className={styles.list}>{patientConfigs.map(renderRow)}</ul>
              )}
            </div>
            <div className={styles.group}>
              <div className={styles.groupLabel}>Generic templates</div>
              {templates.length === 0 ? (
                <p className={styles.empty}>No generic templates.</p>
              ) : (
                <ul className={styles.list}>{templates.map(renderRow)}</ul>
              )}
            </div>
          </>
        )}
      </div>
      <div className={styles.footer}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};

export default ManageConfigsModal;
