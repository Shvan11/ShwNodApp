/**
 * "Sequence Files" sidebar — lists image files in a patient subfolder (default
 * the timepoint's {tpName}_{DD-MM-YYYY} folder) via the existing file-explorer
 * endpoints. Each thumbnail is an HTML5-native drag source carrying its relPath.
 */
import { useEffect, useState, type DragEvent } from 'react';
import styles from './SequenceSidebar.module.css';
import { useToast } from '../../../contexts/ToastContext';

interface FileEntryLite {
  name: string;
  relPath: string;
  type: string;
  category: string;
}

interface Props {
  personId: number;
  defaultFolder: string;
}

const SequenceSidebar = ({ personId, defaultFolder }: Props) => {
  const toast = useToast();
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState<string>(defaultFolder);
  const [files, setFiles] = useState<FileEntryLite[]>([]);
  const [loading, setLoading] = useState(false);

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
  }, [personId]);

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
  }, [personId, folder, toast]);

  const onDragStart = (e: DragEvent<HTMLImageElement>, f: FileEntryLite): void => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ relPath: f.relPath, name: f.name }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Sequence Files</span>
        <select className={styles.folderSelect} value={folder} onChange={(e) => setFolder(e.target.value)}>
          {!folders.includes(folder) && <option value={folder}>{folder || '(root)'}</option>}
          {folders.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className={styles.note}>Loading…</div>
      ) : files.length === 0 ? (
        <div className={styles.note}>No images in this folder.</div>
      ) : (
        <div className={styles.list}>
          {files.map((f) => (
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
