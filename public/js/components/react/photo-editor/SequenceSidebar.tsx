/**
 * "Sequence Files" sidebar — lists image files in a patient subfolder (default
 * the timepoint's {tpName}_{DD-MM-YYYY} folder) via the existing file-explorer
 * endpoints. Each thumbnail is an HTML5-native drag source carrying its relPath.
 *
 * Step 1 of the photo workflow lives here: get the original camera photos into the
 * timepoint folder so they appear below as drag sources. The "Upload" button:
 *   - On Chromium (File System Access): a multi-select picker that defaults to the remembered
 *     memory-card folder and MOVES the chosen photos — deletes each original from the card
 *     after the upload succeeds. The card folder (useImportFolder) is both the default picker
 *     location and the read-write grant we delete under.
 *   - Elsewhere: falls back to a plain file-input that COPIES (originals stay put), so upload
 *     still works on non-Chromium browsers.
 * (Step 2 — framing + Save → working/ — happens in the slot grid.)
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import styles from './SequenceSidebar.module.css';
import { useToast } from '../../../contexts/ToastContext';
import { postFormData, postJSON, type HttpError } from '@/core/http';
import { ensurePermission, showFilePicker } from '@/core/fileSystemAccess';
import { useImportFolder } from '@/hooks/useImportFolder';
import RenameFolderModal from './RenameFolderModal';

/** Extensions offered in the "Move from card" picker (mirrors the Upload accept list). */
const IMAGE_ACCEPT: Record<string, string[]> = {
  'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff'],
};

interface FileEntryLite {
  name: string;
  relPath: string;
  type: string;
  category: string;
}

interface Props {
  personId: number;
  defaultFolder: string;
  /** relPaths already dropped into a slot — hidden from the list while in use. */
  usedRelPaths: Set<string>;
  /** Bumped by the parent to force a re-list (e.g. after a view's original is untagged). */
  refreshSignal?: number;
}

const SequenceSidebar = ({ personId, defaultFolder, usedRelPaths, refreshSignal = 0 }: Props) => {
  const toast = useToast();
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string>(defaultFolder);
  const [files, setFiles] = useState<FileEntryLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [moving, setMoving] = useState(false);
  // Whether the selected folder exists on the share (a listing 404 means "not created yet").
  const [folderExists, setFolderExists] = useState(true);
  const [showRename, setShowRename] = useState(false);
  // Remembers the memory-card folder (and its permission) across sessions, shared with the
  // New Photo Session modal. `.supported` gates the "Move from card" button (Chromium + secure ctx).
  const importFolder = useImportFolder('readwrite');
  // Bumping these re-runs the loaders after a folder/upload mutation.
  const [refreshFolders, setRefreshFolders] = useState(0);
  const [refreshFiles, setRefreshFiles] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Top-level folders for the picker.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/patients/${personId}/files?path=`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled || !res?.data?.entries) return;
        const dirs = (res.data.entries as FileEntryLite[])
          .filter((e) => e.type === 'dir')
          .map((e) => e.name);
        setFolders(dirs);
      })
      .catch(() => {
        /* picker is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [personId, refreshFolders]);

  // Images in the selected folder.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/patients/${personId}/files?path=${encodeURIComponent(folder)}`)
      .then((r) => {
        if (!cancelled) setFolderExists(r.status !== 404); // 404 = folder doesn't exist yet
        return r.ok ? r.json() : null;
      })
      .then((res) => {
        if (cancelled) return;
        const entries = (res?.data?.entries as FileEntryLite[] | undefined) || [];
        setFiles(entries.filter((e) => e.type === 'file' && e.category === 'image'));
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([]);
          toast.error('Failed to load folder');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, folder, toast, refreshFiles, refreshSignal]);

  /** Create the folder on the share; a 409 (already there) is treated as success. */
  const ensureFolder = async (name: string): Promise<void> => {
    try {
      await postJSON(`/api/patients/${personId}/files/folder`, { path: '', name });
      setRefreshFolders((n) => n + 1);
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
      await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form);
      if (folder !== target) setFolder(target);
      setRefreshFiles((n) => n + 1);
      toast.success(`Uploaded ${list.length} photo${list.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`);
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

    // The remembered card folder is both the default picker location and the read-write grant
    // we delete under. First use picks it once; after that it's silent.
    let cardDir: FileSystemDirectoryHandle | null = null;
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
      await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form);

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
      setRefreshFiles((n) => n + 1);

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
        toast.error(`Move failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    } finally {
      setMoving(false);
    }
  };

  // One "Upload": on Chromium it moves the chosen photos off the card (deletes originals);
  // elsewhere it falls back to the plain file-input copy so upload still works.
  const handleUpload = (): void => {
    if (uploading || moving) return;
    if (importFolder.supported) {
      void handleMoveFromCard();
    } else {
      fileInputRef.current?.click();
    }
  };

  const onDragStart = (e: DragEvent<HTMLImageElement>, f: FileEntryLite): void => {
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
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleUpload}
            disabled={uploading || moving}
            title="Upload the patient's photos into the selected folder — moved off the memory card (originals removed after upload)"
          >
            <i className="fas fa-upload" aria-hidden="true" /> {uploading || moving ? 'Uploading…' : 'Upload'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => setShowRename(true)}
            disabled={uploading || moving || !defaultFolder}
            title="Rename an existing patient folder to this timepoint's folder"
          >
            <i className="fas fa-folder-tree" aria-hidden="true" /> Rename folder
          </button>
        </div>
        <select className={styles.folderSelect} value={folder} onChange={(e) => setFolder(e.target.value)}>
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
          {visibleFiles.map((f) => (
            <figure key={f.relPath} className={styles.thumb}>
              <img
                src={`/api/patients/${personId}/files/content?path=${encodeURIComponent(f.relPath)}&thumb=240`}
                alt={f.name}
                draggable
                onDragStart={(e) => onDragStart(e, f)}
                loading="lazy"
                className={styles.thumbImg}
              />
              <figcaption className={styles.thumbName} title={f.name}>
                {f.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className={styles.hint}>Drag a photo onto a slot →</div>

      {showRename && defaultFolder && (
        <RenameFolderModal
          personId={personId}
          targetName={defaultFolder}
          onClose={() => setShowRename(false)}
          onRenamed={(name) => {
            setShowRename(false);
            setFolder(name);
            setRefreshFolders((n) => n + 1);
            setRefreshFiles((n) => n + 1);
          }}
        />
      )}
    </aside>
  );
};

export default SequenceSidebar;
