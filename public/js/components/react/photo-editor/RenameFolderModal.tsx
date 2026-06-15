/**
 * RenameFolderModal — pick an existing folder in the patient directory and rename it to the
 * current timepoint's folder name, so photos that were dropped into a differently-named folder
 * become this timepoint's official photo folder.
 *
 * Only the patient's top-level folders are offered: the rename keeps a folder in its parent
 * (`renameEntry`), and the timepoint folder must live at the patient root, so a nested folder
 * couldn't become the root timepoint folder anyway.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { postJSON, type HttpError } from '@/core/http';
import { patientFilesQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import type { FileListing, FileEntry } from '@/types/api.types';
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
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Top-level patient folders (path=''), minus the timepoint folder if it already exists.
  const { data, isLoading: loading, isError } = useQuery(patientFilesQuery(personId, ''));
  const folders = useMemo<FileEntry[]>(() => {
    const listing = data as FileListing | undefined;
    return (listing?.entries ?? []).filter((e) => e.type === 'dir' && e.name !== targetName);
  }, [data, targetName]);
  useEffect(() => {
    if (isError) toast.error('Failed to load folders');
  }, [isError, toast]);

  const handleRename = async (): Promise<void> => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await postJSON(`/api/patients/${personId}/files/rename`, { path: selected, newName: targetName });
      void queryClient.invalidateQueries({ queryKey: qk.patient.files(personId, '') });
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
    <Modal isOpen onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="rename-folder-title">
      <ModalHeader title="Rename a folder to this timepoint" titleId="rename-folder-title" onClose={onClose} />

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
