/**
 * "Sequence Files" sidebar — lists image files in a patient subfolder (default
 * the timepoint's {tpName}_{DD-MM-YYYY} folder) via the existing file-explorer
 * endpoints. Each thumbnail is an HTML5-native drag source carrying its relPath.
 *
 * Step 1 of the photo workflow lives here: create the timepoint folder and upload
 * the original camera/memory-card photos into it, so they appear below as drag
 * sources. (Step 2 — framing + Save → working/ — happens in the slot grid.)
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import styles from './SequenceSidebar.module.css';
import { useToast } from '../../../contexts/ToastContext';
import { postFormData, postJSON, type HttpError } from '@/core/http';

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
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
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
      .then((r) => (r.ok ? r.json() : null))
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

  const handleCreateFolder = async (): Promise<void> => {
    if (!defaultFolder || creating) return;
    setCreating(true);
    try {
      await ensureFolder(defaultFolder);
      setFolder(defaultFolder);
      setRefreshFiles((n) => n + 1);
      toast.success(`Folder “${defaultFolder}” is ready`);
    } catch (err) {
      toast.error(`Could not create folder: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setCreating(false);
    }
  };

  const handleUploadClick = (): void => {
    if (!uploading) fileInputRef.current?.click();
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
            onClick={handleCreateFolder}
            disabled={creating || !defaultFolder}
            title={defaultFolder ? `Create folder “${defaultFolder}”` : 'No timepoint folder name'}
          >
            <i className="fas fa-folder-plus" aria-hidden="true" /> {creating ? 'Creating…' : 'Create folder'}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleUploadClick}
            disabled={uploading}
            title="Upload original photos into the selected folder"
          >
            <i className="fas fa-upload" aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload'}
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
        <div className={styles.note}>No images in this folder.</div>
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
    </aside>
  );
};

export default SequenceSidebar;
