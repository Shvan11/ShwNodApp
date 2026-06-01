/**
 * RenameFolderModal — pick an existing folder in the patient directory and rename it to the
 * current timepoint's folder name, so photos that were dropped into a differently-named folder
 * become this timepoint's official photo folder.
 *
 * Only the patient's top-level folders are offered: the rename keeps a folder in its parent
 * (`renameEntry`), and the timepoint folder must live at the patient root, so a nested folder
 * couldn't become the root timepoint folder anyway.
 */
import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { useToast } from '@/contexts/ToastContext';
import { fetchJSON, postJSON, type HttpError } from '@/core/http';
import type { ApiResponse, FileListing, FileEntry } from '@/types/api.types';
import styles from './RenameFolderModal.module.css';

interface Props {
  personId: number;
  /** The timepoint's folder name (e.g. `Initial_01-06-2026`) the chosen folder is renamed to. */
  targetName: string;
  onClose: () => void;
  /** Called with the target name after a successful rename. */
  onRenamed: (newName: string) => void;
}

const RenameFolderModal = ({ personId, targetName, onClose, onRenamed }: Props) => {
  const toast = useToast();
  const [folders, setFolders] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJSON<ApiResponse<FileListing>>(`/api/patients/${personId}/files?path=`)
      .then((res) => {
        if (cancelled) return;
        // Top-level folders only, minus the timepoint folder itself if it already exists.
        const dirs = (res?.data?.entries ?? []).filter((e) => e.type === 'dir' && e.name !== targetName);
        setFolders(dirs);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load folders');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, targetName, toast]);

  const handleRename = async (): Promise<void> => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await postJSON(`/api/patients/${personId}/files/rename`, { path: selected, newName: targetName });
      toast.success(`Renamed “${selected}” to “${targetName}”`);
      onRenamed(targetName);
    } catch (err) {
      if ((err as HttpError).status === 409) {
        toast.error(`A folder named “${targetName}” already exists — remove or merge it first.`);
      } else {
        toast.error(`Rename failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} contentClassName={styles.dialog}>
      <div className={styles.header}>
        <h3>Rename a folder to this timepoint</h3>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <i className="fas fa-times" aria-hidden="true" />
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.lead}>
          Pick a folder in the patient directory to rename to <code>{targetName}</code> — it becomes this
          timepoint's photo folder.
        </p>

        {loading ? (
          <div className={styles.note}>Loading folders…</div>
        ) : folders.length === 0 ? (
          <div className={styles.note}>No other folders in the patient directory.</div>
        ) : (
          <ul className={styles.list}>
            {folders.map((f) => (
              <li key={f.relPath}>
                <button
                  type="button"
                  className={`${styles.folderRow} ${selected === f.relPath ? styles.selected : ''}`}
                  onClick={() => setSelected(f.relPath)}
                >
                  <i className="fas fa-folder" aria-hidden="true" />
                  <span className={styles.folderName} title={f.name}>
                    {f.name}
                  </span>
                  {selected === f.relPath && <i className="fas fa-check" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={handleRename} disabled={!selected || busy}>
          {busy ? 'Renaming…' : `Rename to “${targetName}”`}
        </button>
      </div>
    </Modal>
  );
};

export default RenameFolderModal;
