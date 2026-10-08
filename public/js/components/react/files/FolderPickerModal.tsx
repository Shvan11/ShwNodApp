/**
 * "Move to…" / "Copy to…" — pick the folder of this patient to move or copy entries
 * into. Browses one folder at a time (its subfolders, from the same listing read and
 * cache as the explorer) with its own breadcrumb, and can make a new folder on the
 * way: the common case is "put these photos in a new folder".
 *
 * The parent runs the move/copy (`onPick`) and closes this when it is done; a folder
 * being moved can't be entered or chosen, the same rule the server enforces.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, httpErrorMessage } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import Modal from '@/components/react/Modal';
import ModalHeader from '@/components/react/ModalHeader';
import type { FileEntry } from '@/types/api.types';
import * as fileExplorer from '@shared/contracts/file-explorer.contract';
import { patientFilesQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { folderOf, isSameOrInside } from './fileHelpers';
import styles from './FileExplorer.module.css';

interface Props {
  personId: number;
  mode: 'move' | 'copy';
  entries: FileEntry[];
  /** The folder it opens on (the one being viewed). */
  startPath: string;
  busy: boolean;
  onPick: (dest: string) => void;
  onClose: () => void;
}

const TITLE_ID = 'file-folder-picker-title';

const FolderPickerModal = ({ personId, mode, entries, startPath, busy, onPick, onClose }: Props) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [path, setPath] = useState(startPath);
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery(patientFilesQuery(personId, path, false));
  const folders = (data?.entries ?? [])
    .filter((e) => e.type === 'dir')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // A folder being moved or copied can't receive itself or go into its own subfolder.
  const movingDirs = entries.filter((e) => e.type === 'dir').map((e) => e.relPath);
  const isBlocked = (rel: string): boolean => movingDirs.some((d) => isSameOrInside(rel, d));
  const alreadyHere = mode === 'move' && entries.every((e) => folderOf(e.relPath) === path);
  const blockedReason = isBlocked(path)
    ? `Can't ${mode} a folder into itself`
    : alreadyHere
      ? `${entries.length === 1 ? 'It is' : 'They are'} already in this folder`
      : null;

  const verb = mode === 'move' ? 'Move' : 'Copy';
  const what = entries.length === 1 ? `"${entries[0].name}"` : `${entries.length} items`;
  const segments = path ? path.split('/') : [];

  const createFolder = async (): Promise<void> => {
    const name = (newName ?? '').trim();
    if (!name || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const created = await postJSON<FileEntry>(
        `/api/patients/${personId}/files/folder`,
        { path, name },
        { schema: fileExplorer.folder.response }
      );
      await queryClient.invalidateQueries({ queryKey: qk.patient.filesAll(personId) });
      setNewName(null);
      setPath(created.relPath);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not create the folder'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={TITLE_ID} contentClassName={styles.pickerModal}>
      <ModalHeader
        titleId={TITLE_ID}
        title={`${verb} ${what} to…`}
        icon={<i className={`fas ${mode === 'move' ? 'fa-folder-tree' : 'fa-clone'}`} aria-hidden="true" />}
        onClose={onClose}
        dense
      />

      <nav className={styles.pickerCrumbs} aria-label="Destination folder">
        <button type="button" className={styles.crumb} onClick={() => setPath('')} disabled={!path}>
          <i className="fas fa-folder-tree" aria-hidden="true" /> Files
        </button>
        {segments.map((seg, i) => {
          const cumulative = segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          return (
            <span key={cumulative} className={styles.crumbWrap}>
              <i className="fas fa-chevron-right" aria-hidden="true" />
              {isLast ? (
                <span className={styles.crumbCurrent}>{seg}</span>
              ) : (
                <button type="button" className={styles.crumb} onClick={() => setPath(cumulative)}>
                  {seg}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <div className={styles.pickerList}>
        {isLoading && <div className={styles.message}>Loading…</div>}
        {error && (
          <div className={styles.error}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />{' '}
            {httpErrorMessage(error, 'Failed to load folders')}
          </div>
        )}
        {!isLoading && !error && folders.length === 0 && newName === null && (
          <div className={styles.message}>No folders in here.</div>
        )}
        {folders.map((f) => {
          const blocked = isBlocked(f.relPath);
          return (
            <button
              key={f.relPath}
              type="button"
              className={styles.pickerFolder}
              onClick={() => setPath(f.relPath)}
              disabled={blocked}
              title={blocked ? `This is what you are ${mode === 'move' ? 'moving' : 'copying'}` : `Open ${f.name}`}
            >
              <i className="fas fa-folder" aria-hidden="true" />
              <span className={styles.pickerFolderName}>{f.name}</span>
              {!blocked && <i className="fas fa-chevron-right" aria-hidden="true" />}
            </button>
          );
        })}
        {newName !== null && (
          <div className={styles.pickerNew}>
            <i className="fas fa-folder-plus" aria-hidden="true" />
            <input
              ref={newNameRef}
              className={styles.promptInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFolder();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNewName(null);
                }
              }}
              placeholder="New folder name"
              aria-label="New folder name"
            />
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void createFolder()}
              disabled={creating || !newName.trim()}
            >
              Create
            </button>
          </div>
        )}
      </div>

      <div className={styles.pickerFooter}>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => {
            setNewName('');
            requestAnimationFrame(() => newNameRef.current?.focus());
          }}
          disabled={newName !== null || isBlocked(path)}
        >
          <i className="fas fa-folder-plus" aria-hidden="true" /> New folder
        </button>
        <div className={styles.toolbarSpacer} />
        {blockedReason && <span className={styles.pickerReason}>{blockedReason}</span>}
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => onPick(path)}
          disabled={busy || !!blockedReason || isLoading || !!error}
        >
          {busy ? (mode === 'move' ? 'Moving…' : 'Copying…') : `${verb} here`}
        </button>
      </div>
    </Modal>
  );
};

export default FolderPickerModal;
