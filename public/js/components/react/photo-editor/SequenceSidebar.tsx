/**
 * "Sequence Files" sidebar — lists image files in a patient subfolder (default
 * the timepoint's {tpName}_{DD-MM-YYYY} folder) via the existing file-explorer
 * endpoints. Each thumbnail is an HTML5-native drag source carrying its relPath.
 *
 * Step 1 of the photo workflow lives here: get the original camera photos into the
 * timepoint folder so they appear below as drag sources. Two buttons, named for what
 * they do (FE-F14-10 — one "Upload" button used to DELETE the picked photos from
 * the remembered folder, said only in its tooltip):
 *   - "Move from card" (Chromium, File System Access): a multi-select picker that defaults to
 *     the remembered memory-card folder and MOVES the chosen photos — deletes each original
 *     from the card after the upload succeeds. It asks once before the first move.
 *   - "Upload (copy)": a plain file input; the originals stay where they are.
 * A photo can be dragged onto a slot, or clicked (Enter) and then a slot clicked — the
 * keyboard path (FE-F14-13a).
 * (Step 2 — framing + Save → working/ — happens in the slot grid.)
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './SequenceSidebar.module.css';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { postFormData, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { patientFilesQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import type { FileEntry } from '@/types/api.types';
import type { TimepointRow } from '@shared/contracts/patient.contract';
import { ensurePermission, showFilePicker } from '@/core/fileSystemAccess';
import { useImportFolder } from '@/hooks/useImportFolder';
import RenameFolderModal from './RenameFolderModal';

/** Extensions offered in the "Move from card" picker (mirrors the Upload accept list). */
const IMAGE_ACCEPT: Record<string, string[]> = {
  'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff'],
};

/** A photo picked by click/keyboard, waiting for the slot to place it in. */
export interface ArmedPhoto {
  relPath: string;
  name: string;
}

/** Set once the user has confirmed that "Move from card" deletes from the card. */
const MOVE_CONFIRMED_KEY = 'pe:moveFromCardConfirmed';

interface Props {
  personId: number;
  /** The patient's photo sessions — RenameFolderModal tells their folders apart. */
  sessions: TimepointRow[];
  defaultFolder: string;
  /** relPaths already dropped into a slot — hidden from the list while in use. */
  usedRelPaths: Set<string>;
  /** Bumped by the parent to force a re-list (e.g. after a view's original is untagged). */
  refreshSignal?: number;
  armed: ArmedPhoto | null;
  onArm: (photo: ArmedPhoto | null) => void;
}

const SequenceSidebar = ({
  personId,
  sessions,
  defaultFolder,
  usedRelPaths,
  refreshSignal = 0,
  armed,
  onArm,
}: Props) => {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState<string>(defaultFolder);
  const [uploading, setUploading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showRename, setShowRename] = useState(false);
  // Remembers the memory-card folder (and its permission) across sessions, shared with the
  // New Photo Session modal. `.supported` gates the "Move from card" button (Chromium + secure ctx).
  const importFolder = useImportFolder('readwrite');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Top-level folders for the picker (path=''). Best-effort: a failure just leaves
  // the picker empty.
  const foldersQ = useQuery(patientFilesQuery(personId, ''));
  const folders = useMemo<string[]>(
    () => (foldersQ.data?.entries ?? []).filter((e) => e.type === 'dir').map((e) => e.name),
    [foldersQ.data]
  );

  // Images in the selected folder. A 404 means "not created yet" (folderExists=false);
  // retry is off so that empty state shows immediately instead of after 2 retries.
  const filesQ = useQuery({ ...patientFilesQuery(personId, folder), retry: false });
  const files = useMemo<FileEntry[]>(
    () => (filesQ.data?.entries ?? []).filter((e) => e.type === 'file' && e.category === 'image'),
    [filesQ.data]
  );
  const loading = filesQ.isFetching;
  // 404 = folder doesn't exist yet; any other status (or success) counts as "exists".
  const folderStatus = (filesQ.error as HttpError | null)?.status;
  const folderExists = folderStatus !== 404;
  // Only a transport/parse failure (no .status) surfaces a toast — matching the old chain.
  useEffect(() => {
    if (filesQ.error && folderStatus === undefined) toast.error('Failed to load folder');
  }, [filesQ.error, folderStatus, toast]);

  // The parent bumps refreshSignal (e.g. after a view's original is untagged) to
  // force a re-list of the current folder.
  useEffect(() => {
    if (refreshSignal) {
      void queryClient.invalidateQueries({ queryKey: qk.patient.files(personId, folder) });
    }
    // folder intentionally omitted: a refreshSignal bump targets the folder shown
    // at bump time, and a folder change already refetches via its own query key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, personId, queryClient]);

  // Refresh helpers for the mutation handlers below.
  const reloadFolders = () =>
    queryClient.invalidateQueries({ queryKey: qk.patient.files(personId, '') });
  const reloadFiles = () =>
    queryClient.invalidateQueries({ queryKey: qk.patient.files(personId, folder) });

  /** Create the folder on the share; a 409 (already there) is treated as success. */
  const ensureFolder = async (name: string): Promise<void> => {
    try {
      await postJSON(`/api/patients/${personId}/files/folder`, { path: '', name });
      void reloadFolders();
    } catch (err) {
      if ((err as HttpError).status !== 409) throw err;
    }
  };

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.target;
    const list = input.files ? Array.from(input.files) : [];
    input.value = ''; // let the same files be re-picked later
    if (list.length === 0) return;

    const target = folder || defaultFolder;
    if (!target) {
      toast.warning('Pick or create a folder first.');
      return;
    }

    setUploading(true);
    try {
      await ensureFolder(target); // upload target must exist on the share
      const form = new FormData();
      list.forEach((f) => form.append('files', f));
      const qs = new URLSearchParams({ path: target });
      // 120s to match the server's timeouts.long — a photo-session import exceeds
      // the funnel's 30s default, which would abort it mid-write.
      await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form, { timeoutMs: 120000 });
      if (folder !== target) setFolder(target);
      void reloadFiles();
      toast.success(`Uploaded ${list.length} photo${list.length === 1 ? '' : 's'}`);
    } catch (err) {
      // The server's reason, not the funnel's "HTTP Error: 403 Forbidden" (FE-F14-9).
      toast.error(`Upload failed: ${httpErrorMessage(err, 'unknown error')}`);
    } finally {
      setUploading(false);
    }
  };

  /**
   * Move (not copy) selected photos off the memory card. Works like Upload — a multi-select
   * file picker — but defaults to the remembered card folder and DELETES each chosen original
   * after the upload succeeds. Deletion runs under the card folder's read-write grant
   * (resolve + removeEntry), so there's no per-file permission prompt.
   */
  const handleMoveFromCard = async (): Promise<void> => {
    const target = folder || defaultFolder;
    if (!target) {
      toast.warning('Pick or create a folder first.');
      return;
    }

    // Moving deletes from the card — say so plainly once, before the first move.
    let confirmed = false;
    try {
      confirmed = localStorage.getItem(MOVE_CONFIRMED_KEY) === '1';
    } catch {
      /* storage unavailable: ask every time */
    }
    if (!confirmed) {
      const ok = await confirm(
        'Move from card uploads the photos you pick and then DELETES them from the memory-card folder. Use "Upload (copy)" to keep the originals where they are.',
        { title: 'Move photos off the card?', confirmText: 'Move', cancelText: 'Cancel' }
      );
      if (!ok) return;
      try {
        localStorage.setItem(MOVE_CONFIRMED_KEY, '1');
      } catch {
        /* ignore */
      }
    }

    // The remembered card folder is both the default picker location and the read-write grant
    // we delete under. First use picks it once; after that it's silent.
    let cardDir: FileSystemDirectoryHandle | null;
    if (importFolder.handle && (await ensurePermission(importFolder.handle, 'readwrite'))) {
      cardDir = importFolder.handle;
    } else {
      cardDir = await importFolder.choosePick();
    }
    if (!cardDir) return;

    // Pick the specific photos to move, defaulting to the card folder. Null/empty = cancelled.
    const picked = await showFilePicker({ multiple: true, description: 'Photos', accept: IMAGE_ACCEPT, startIn: cardDir });
    if (!picked.success || !picked.data || picked.data.length === 0) return;
    const handles = picked.data;

    setMoving(true);
    try {
      await ensureFolder(target); // upload target must exist on the share
      const form = new FormData();
      for (const fh of handles) {
        form.append('files', await fh.getFile());
      }
      const qs = new URLSearchParams({ path: target });
      // 120s to match the server's timeouts.long — a photo-session import exceeds
      // the funnel's 30s default, which would abort it mid-write.
      await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form, { timeoutMs: 120000 });

      // Upload confirmed on the share — now delete each chosen original from the card. Resolve
      // the file within the granted card folder and removeEntry under that read-write grant.
      let removed = 0;
      const failed: string[] = [];
      for (const fh of handles) {
        try {
          const rel = await cardDir.resolve(fh);
          if (rel && rel.length > 0) {
            let dir = cardDir;
            for (let i = 0; i < rel.length - 1; i++) {
              dir = await dir.getDirectoryHandle(rel[i]);
            }
            await dir.removeEntry(rel[rel.length - 1]);
          } else {
            // Picked from outside the granted folder — fall back to the handle's own remove().
            await (fh as FileSystemFileHandle & { remove: () => Promise<void> }).remove();
          }
          removed++;
        } catch {
          failed.push(fh.name);
        }
      }

      if (folder !== target) setFolder(target);
      void reloadFiles();

      if (failed.length === 0) {
        toast.success(`Moved ${removed} photo${removed === 1 ? '' : 's'} — originals removed from the card`);
      } else {
        toast.warning(
          `Uploaded ${handles.length}; ${removed} removed, ${failed.length} could not be deleted (left on the card)`
        );
      }
    } catch (err) {
      // A remembered handle whose folder was renamed/ejected throws NotFoundError — forget it
      // so the next attempt re-picks instead of failing again.
      if ((err as DOMException)?.name === 'NotFoundError') {
        await importFolder.clear();
        toast.error('That folder is no longer available — please choose the card folder again.');
      } else {
        toast.error(`Move failed: ${httpErrorMessage(err, 'unknown error')}`);
      }
    } finally {
      setMoving(false);
    }
  };

  const onDragStart = (e: DragEvent<HTMLElement>, f: FileEntry): void => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ relPath: f.relPath, name: f.name }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Hide photos already placed in a slot; they return here when the slot is cleared.
  const visibleFiles = files.filter((f) => !usedRelPaths.has(f.relPath));

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Sequence Files</span>
        <div className={styles.actions}>
          {importFolder.supported && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void handleMoveFromCard()}
              disabled={uploading || moving}
              title="Upload photos from the memory card into the selected folder, then delete them from the card"
            >
              <i className="fas fa-sd-card" aria-hidden="true" /> {moving ? 'Moving…' : 'Move from card'}
            </button>
          )}
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || moving}
            title="Upload copies of photos into the selected folder — the originals stay where they are"
          >
            <i className="fas fa-upload" aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload (copy)'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => setShowRename(true)}
            disabled={uploading || moving || !defaultFolder}
            title="Rename an existing patient folder to this session's folder"
          >
            <i className="fas fa-folder-tree" aria-hidden="true" /> Rename folder
          </button>
        </div>
        <select
          className={styles.folderSelect}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-label="Folder to show"
        >
          {!folders.includes(folder) && <option value={folder}>{folder || '(root)'}</option>}
          {folders.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFilesSelected}
        />
      </div>

      {loading ? (
        <div className={styles.note}>Loading…</div>
      ) : files.length === 0 ? (
        <div className={styles.note}>{folderExists ? 'No images in this folder.' : 'Folder is not created yet.'}</div>
      ) : visibleFiles.length === 0 ? (
        <div className={styles.note}>All photos placed.</div>
      ) : (
        <div className={styles.list}>
          {visibleFiles.map((f) => {
            const isArmed = armed?.relPath === f.relPath;
            return (
              <figure key={f.relPath} className={`${styles.thumb} ${isArmed ? styles.thumbArmed : ''}`}>
                <button
                  type="button"
                  className={styles.thumbButton}
                  draggable
                  onDragStart={(e) => onDragStart(e, f)}
                  onClick={() => onArm(isArmed ? null : { relPath: f.relPath, name: f.name })}
                  aria-pressed={isArmed}
                  aria-label={`${f.name} — pick, then choose a slot`}
                >
                  <img
                    src={`/api/patients/${personId}/files/content?path=${encodeURIComponent(f.relPath)}&thumb=240`}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    className={styles.thumbImg}
                  />
                </button>
                <figcaption className={styles.thumbName} title={f.name}>
                  {f.name}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <div className={styles.hint} aria-live="polite">
        {armed ? `Now click a slot to place “${armed.name}” (Esc cancels)` : 'Drag a photo onto a slot — or click it, then a slot →'}
      </div>

      {showRename && defaultFolder && (
        <RenameFolderModal
          personId={personId}
          sessions={sessions}
          targetName={defaultFolder}
          onClose={() => setShowRename(false)}
          onRenamed={(name) => {
            setShowRename(false);
            setFolder(name);
            void reloadFolders();
            void reloadFiles();
          }}
        />
      )}
    </aside>
  );
};

export default SequenceSidebar;
