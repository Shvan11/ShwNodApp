/**
 * RenameFolderModal — pick an existing folder in the patient directory and rename it to the
 * current timepoint's folder name, so photos that were dropped into a differently-named folder
 * become this timepoint's official photo folder.
 *
 * Only the patient's top-level folders are offered: the rename keeps a folder in its parent
 * (`renameEntry`), and the timepoint folder must live at the patient root, so a nested folder
 * couldn't become the root timepoint folder anyway.
 *
 * Folders that already BELONG to something — another session's originals, or one the app
 * reads by name (`OPG`, `OPGIMG`, `CBCT`) — are listed apart, under a warning, and renaming
 * one asks first. The dialog used to offer them like any other, and renaming one silently
 * detached it from its owner: that session lost *Restore original*, or the X-ray card went
 * empty (FE-F14-5). The server refuses the same renames unless confirmed (`force`).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { patientFilesQuery } from '@/query/queries';
import { invalidatePatientPhotos } from '@/query/photos';
import { folderOwner, type FolderOwner } from '@shared/photo-session-folder';
import type { TimepointRow } from '@shared/contracts/patient.contract';
import type { FileEntry } from '@/types/api.types';
import styles from './RenameFolderModal.module.css';

interface Props {
  personId: number;
  /** The patient's sessions — to tell their folders apart. */
  sessions: TimepointRow[];
  /** The timepoint's folder name (e.g. `Initial_01-06-2026`) the chosen folder is renamed to. */
  targetName: string;
  onClose: () => void;
  /** Called with the target name after a successful rename. */
  onRenamed: (newName: string) => void;
}

interface Candidate {
  entry: FileEntry;
  owner: FolderOwner;
}

const ownerText = (owner: FolderOwner): string =>
  owner?.kind === 'session'
    ? `the originals of the photo session “${owner.name}” (${owner.date})`
    : 'read by the app under this name (X-rays)';

const RenameFolderModal = ({ personId, sessions, targetName, onClose, onRenamed }: Props) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Top-level patient folders (path=''), minus the timepoint folder itself.
  const { data, isLoading: loading, isError } = useQuery(patientFilesQuery(personId, ''));
  const candidates: Candidate[] = (data?.entries ?? [])
    .filter((e) => e.type === 'dir' && e.name.toLowerCase() !== targetName.toLowerCase())
    .map((entry) => ({ entry, owner: folderOwner(entry.name, sessions) }));
  const free = candidates.filter((c) => c.owner === null);
  const owned = candidates.filter((c) => c.owner !== null);
  useEffect(() => {
    if (isError) toast.error('Failed to load folders');
  }, [isError, toast]);

  const handleRename = async (): Promise<void> => {
    const choice = candidates.find((c) => c.entry.relPath === selected);
    if (!choice || busy) return;
    if (choice.owner) {
      const ok = await confirm(
        `“${choice.entry.name}” holds ${ownerText(choice.owner)}. Renaming it to “${targetName}” takes it away from there.`,
        { title: 'Rename a folder that is in use?', confirmText: 'Rename anyway', danger: true }
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await postJSON(`/api/patients/${personId}/files/rename`, {
        path: choice.entry.relPath,
        newName: targetName,
        ...(choice.owner ? { force: true } : {}),
      });
      void invalidatePatientPhotos(personId);
      toast.success(`Renamed “${choice.entry.name}” to “${targetName}”`);
      onRenamed(targetName);
    } catch (err) {
      const status = (err as HttpError).status;
      toast.error(
        status === 409
          ? httpErrorMessage(err, `A folder named “${targetName}” already exists — remove or merge it first.`)
          : `Rename failed: ${httpErrorMessage(err, 'unknown error')}`
      );
    } finally {
      setBusy(false);
    }
  };

  const row = (c: Candidate) => (
    <li key={c.entry.relPath}>
      <button
        type="button"
        className={`${styles.folderRow} ${selected === c.entry.relPath ? styles.selected : ''}`}
        onClick={() => setSelected(c.entry.relPath)}
        aria-pressed={selected === c.entry.relPath}
      >
        <i className={`fas ${c.owner ? 'fa-folder-closed' : 'fa-folder'}`} aria-hidden="true" />
        <span className={styles.folderName} title={c.entry.name}>
          {c.entry.name}
          {c.owner && <small className={styles.ownerNote}>{ownerText(c.owner)}</small>}
        </span>
        {selected === c.entry.relPath && <i className="fas fa-check" aria-hidden="true" />}
      </button>
    </li>
  );

  return (
    <Modal isOpen onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="rename-folder-title">
      <ModalHeader title="Rename a folder to this session" titleId="rename-folder-title" onClose={onClose} />

      <div className={styles.body}>
        <p className={styles.lead}>
          Pick a folder in the patient directory to rename to <code>{targetName}</code> — it becomes this
          timepoint's photo folder.
        </p>

        {loading ? (
          <div className={styles.note}>Loading folders…</div>
        ) : candidates.length === 0 ? (
          <div className={styles.note}>No other folders in the patient directory.</div>
        ) : (
          <>
            {free.length > 0 ? (
              <ul className={styles.list}>{free.map(row)}</ul>
            ) : (
              <div className={styles.note}>No unused folders — every folder here belongs to something.</div>
            )}
            {owned.length > 0 && (
              <>
                <p className={styles.ownedHeading}>
                  <i className="fas fa-triangle-exclamation" aria-hidden="true" /> In use — renaming one takes it
                  away from its owner
                </p>
                <ul className={styles.list}>{owned.map(row)}</ul>
              </>
            )}
          </>
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
