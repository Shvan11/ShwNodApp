/**
 * Per-patient file explorer. Navigates the patient folder via the URL splat,
 * previews media inline, and fully manages files (upload, rename, delete, new
 * folder). A flat toggle recursively lists every file in the current subtree.
 *
 * Rendering is virtualized (@tanstack/react-virtual) so large/flat listings
 * keep only the visible tiles in the DOM — essential on phones, which are the
 * primary beneficiary (they can't reach the SMB share directly).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { fetchJSON, postJSON, postFormData, deleteJSON } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import Modal from '@/components/react/Modal';
import type { FileEntry, FileListing, FileBatchDeleteResult } from '@/types/api.types';
import * as fileExplorer from '@shared/contracts/file-explorer.contract';
import { encodeRelPath, errorMessage } from './fileHelpers';
import FileEntryTile from './FileEntryTile';
import FilePreviewModal from './FilePreviewModal';
import LocalSendShareModal, { type ShareSource } from '@/components/react/localsend/LocalSendShareModal';
import styles from './FileExplorer.module.css';

interface Props {
  personId?: number | null;
  subPath?: string;
}

type ViewMode = 'grid' | 'list';
interface PromptState {
  mode: 'newFolder' | 'rename';
  target?: FileEntry;
  value: string;
}
interface PreviewState {
  files: FileEntry[];
  index: number;
}

const VIEW_KEY = 'fileExplorer.view';
const FLAT_KEY = 'fileExplorer.flat';
const TILE_MIN_PX = 170;

const FileExplorer = ({ personId, subPath }: Props) => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const currentPath = useMemo(() => (subPath || '').replace(/^\/+|\/+$/g, ''), [subPath]);

  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'grid'
  );
  const [flat, setFlat] = useState<boolean>(() => localStorage.getItem(FLAT_KEY) === '1');
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem(FLAT_KEY, flat ? '1' : '0');
  }, [flat]);

  // Selection is keyed by relPath, which is only meaningful within one listing —
  // drop it when the folder or flat/nested context changes.
  useEffect(() => {
    setSelected(new Set());
  }, [currentPath, flat]);

  // ── Fetch listing (AbortController cancels in-flight on rapid nav) ──
  useEffect(() => {
    if (!personId) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ path: currentPath, flat: flat ? '1' : '0' });
    fetchJSON<FileListing>(`/api/patients/${personId}/files?${qs}`, {
      signal: ac.signal,
      schema: fileExplorer.list.response,
    })
      .then((listing) => {
        if (ac.signal.aborted) return;
        setListing(listing);
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted && (err as Error)?.name !== 'AbortError') {
          setError(errorMessage(err, 'Failed to load files'));
        }
      })
      .finally(() => {
        // Don't flip loading for an aborted (superseded) request — otherwise the
        // empty state flashes between an aborted fetch and its replacement.
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [personId, currentPath, flat, refreshKey]);

  // ── Sorted entries (folders first, then name) ──
  const entries = useMemo(() => {
    const arr = [...(listing?.entries ?? [])];
    arr.sort((a, b) => {
      const ad = a.type === 'dir' ? 0 : 1;
      const bd = b.type === 'dir' ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return arr;
  }, [listing]);

  // ── Virtualization (column count from container width) ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = (): void => {
      if (view === 'list') {
        setColumns(1);
        return;
      }
      setColumns(Math.max(1, Math.floor(el.clientWidth / TILE_MIN_PX)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const rowCount = Math.ceil(entries.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (view === 'grid' ? 188 : 60),
    overscan: 8,
  });
  // Re-measure when the layout-affecting inputs change.
  useEffect(() => {
    virtualizer.measure();
  }, [view, columns, entries.length, virtualizer]);

  // ── Navigation / preview ──
  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'dir') {
        navigate(`/patient/${personId}/files/${encodeRelPath(entry.relPath)}`);
        return;
      }
      const files = entries.filter((e) => e.type !== 'dir');
      const index = Math.max(
        0,
        files.findIndex((e) => e.relPath === entry.relPath)
      );
      setPreview({ files, index });
    },
    [navigate, personId, entries]
  );

  const goToSegment = (cumulative: string): void => {
    navigate(`/patient/${personId}/files${cumulative ? `/${encodeRelPath(cumulative)}` : ''}`);
  };

  // ── Mutations ──
  const doUpload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!personId || list.length === 0) return;
      const form = new FormData();
      list.forEach((f) => form.append('files', f));
      const qs = new URLSearchParams({ path: currentPath });
      setBusy(true);
      try {
        await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form);
        toast.success(`Uploaded ${list.length} file(s)`);
        reload();
      } catch (err) {
        toast.error(errorMessage(err, 'Upload failed'));
      } finally {
        setBusy(false);
      }
    },
    [personId, currentPath, toast, reload]
  );

  const submitPrompt = useCallback(async () => {
    if (!prompt || !personId) return;
    const value = prompt.value.trim();
    if (!value) return;
    setBusy(true);
    try {
      if (prompt.mode === 'newFolder') {
        await postJSON(`/api/patients/${personId}/files/folder`, { path: currentPath, name: value });
        toast.success('Folder created');
      } else if (prompt.target) {
        await postJSON(`/api/patients/${personId}/files/rename`, {
          path: prompt.target.relPath,
          newName: value,
        });
        toast.success('Renamed');
      }
      setPrompt(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Operation failed'));
    } finally {
      setBusy(false);
    }
  }, [prompt, personId, currentPath, toast, reload]);

  const doDelete = useCallback(
    async (entry: FileEntry) => {
      if (!personId) return;
      const ok = await confirm(`Move "${entry.name}" to trash?`, {
        title: 'Delete',
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const qs = new URLSearchParams({ path: entry.relPath });
        await deleteJSON(`/api/patients/${personId}/files?${qs}`);
        toast.success('Moved to trash');
        reload();
      } catch (err) {
        toast.error(errorMessage(err, 'Delete failed'));
      } finally {
        setBusy(false);
      }
    },
    [personId, confirm, toast, reload]
  );

  // ── Selection (bulk) ──
  const toggleSelect = useCallback((entry: FileEntry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.relPath)) next.delete(entry.relPath);
      else next.add(entry.relPath);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // Every currently-listed entry is selected (respects flat view + truncation:
  // "all" means everything shown, not everything on disk).
  const allVisibleSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.relPath));

  const toggleSelectAll = useCallback(() => {
    setSelected(allVisibleSelected ? new Set() : new Set(entries.map((e) => e.relPath)));
  }, [allVisibleSelected, entries]);

  const toSource = useCallback(
    (en: FileEntry): ShareSource => ({
      source: 'patient-file',
      personId: personId as number,
      ref: en.relPath,
      displayName: en.name,
    }),
    [personId]
  );

  const shareSelected = useCallback(() => {
    if (!personId) return;
    const sel = entries.filter((e) => selected.has(e.relPath) && e.type !== 'dir');
    if (sel.length === 0) return;
    setShareSources(sel.map(toSource));
  }, [personId, entries, selected, toSource]);

  const doDeleteBatch = useCallback(async () => {
    if (!personId) return;
    // Intersect with the live listing so we never send stale relPaths.
    const sel = entries.filter((e) => selected.has(e.relPath));
    if (sel.length === 0) return;

    const folders = sel.filter((e) => e.type === 'dir').length;
    const files = sel.length - folders;
    const parts: string[] = [];
    if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
    if (files) parts.push(`${files} file${files === 1 ? '' : 's'}`);
    const ok = await confirm(`Move ${parts.join(' and ')} to trash?`, {
      title: 'Delete selected',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await postJSON<FileBatchDeleteResult>(
        `/api/patients/${personId}/files/delete-batch`,
        { paths: sel.map((e) => e.relPath) },
        { schema: fileExplorer.deleteBatch.response }
      );
      const { succeeded, failed } = result;
      if (failed === 0) toast.success(`Moved ${succeeded} item(s) to trash`);
      else if (succeeded === 0) toast.error(`Failed to delete ${failed} item(s)`);
      else toast.warning(`Moved ${succeeded} to trash, ${failed} failed`);
      setSelected(new Set());
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  }, [personId, entries, selected, confirm, toast, reload]);

  // ── Drag & drop ──
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (e.currentTarget === e.target) setDragActive(false);
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files?.length) void doUpload(e.target.files);
    e.target.value = '';
  };

  if (!personId) {
    return <div className={styles.message}>No patient selected.</div>;
  }

  const segments = currentPath ? currentPath.split('/') : [];

  return (
    <div className={styles.explorer}>
      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Folder path">
        <button type="button" className={styles.crumb} onClick={() => goToSegment('')}>
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
                <button type="button" className={styles.crumb} onClick={() => goToSegment(cumulative)}>
                  {seg}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {/* Toolbar / selection bar */}
      {selectMode ? (
        <div className={styles.selectBar}>
          <button type="button" className={styles.toolButton} onClick={exitSelectMode}>
            <i className="fas fa-xmark" aria-hidden="true" /> Done
          </button>
          <span className={styles.selectCount}>{selected.size} selected</span>

          <div className={styles.toolbarSpacer} />

          <button
            type="button"
            className={styles.toolButton}
            onClick={toggleSelectAll}
            disabled={entries.length === 0}
          >
            <i
              className={`fas ${allVisibleSelected ? 'fa-square' : 'fa-square-check'}`}
              aria-hidden="true"
            />{' '}
            {allVisibleSelected ? 'Clear' : 'Select all'}
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={shareSelected}
            disabled={selected.size === 0}
          >
            <i className="fas fa-share-nodes" aria-hidden="true" /> Share selected
          </button>
          <button
            type="button"
            className={`${styles.toolButton} ${styles.dangerButton}`}
            onClick={() => void doDeleteBatch()}
            disabled={selected.size === 0 || busy}
          >
            <i className="fas fa-trash-can" aria-hidden="true" /> Delete
          </button>
        </div>
      ) : (
        <div className={styles.toolbar}>
          <label className={styles.flatToggle}>
            <input type="checkbox" checked={flat} onChange={(e) => setFlat(e.target.checked)} />
            <span>Flat view (all subfolders)</span>
          </label>

          <div className={styles.toolbarSpacer} />

          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
            title={view === 'grid' ? 'List view' : 'Grid view'}
            aria-label="Toggle view"
          >
            <i className={`fas ${view === 'grid' ? 'fa-list' : 'fa-table-cells-large'}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setSelectMode(true)}
            disabled={entries.length === 0}
            title="Select multiple"
          >
            <i className="fas fa-square-check" aria-hidden="true" /> Select
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setPrompt({ mode: 'newFolder', value: '' })}
            disabled={flat}
            title={flat ? 'Switch off flat view to create folders' : 'New folder'}
          >
            <i className="fas fa-folder-plus" aria-hidden="true" /> New folder
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={flat || busy}
            title={flat ? 'Switch off flat view to upload' : 'Upload files'}
          >
            <i className="fas fa-upload" aria-hidden="true" /> Upload
          </button>
          <button type="button" className={styles.toolButton} onClick={reload} title="Refresh" aria-label="Refresh">
            <i className="fas fa-rotate-right" aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.hiddenInput}
            onChange={onFileInput}
          />
        </div>
      )}

      {listing?.truncated && (
        <div className={styles.notice}>
          Showing the first {entries.length} items — narrow the folder to see everything.
        </div>
      )}

      {/* Body (drop zone + virtualized list) */}
      <div
        className={`${styles.scrollArea} ${dragActive ? styles.dragActive : ''}`}
        ref={scrollRef}
        onDrop={flat || selectMode ? undefined : onDrop}
        onDragOver={flat || selectMode ? undefined : onDragOver}
        onDragLeave={flat || selectMode ? undefined : onDragLeave}
      >
        {loading && <div className={styles.message}>Loading…</div>}
        {error && !loading && (
          <div className={styles.error}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" /> {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className={styles.message}>This folder is empty.</div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className={styles.virtualSpacer} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const start = vRow.index * columns;
              const rowItems = entries.slice(start, start + columns);
              return (
                <div
                  key={vRow.key}
                  className={view === 'grid' ? styles.gridRow : styles.listRow}
                  style={{
                    transform: `translateY(${vRow.start}px)`,
                    height: vRow.size,
                    ...(view === 'grid'
                      ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
                      : {}),
                  }}
                >
                  {rowItems.map((entry) => (
                    <FileEntryTile
                      key={entry.relPath}
                      personId={personId}
                      entry={entry}
                      view={view}
                      showFullPath={flat}
                      selectMode={selectMode}
                      selected={selected.has(entry.relPath)}
                      onOpen={openEntry}
                      onRename={(en) => setPrompt({ mode: 'rename', target: en, value: en.name })}
                      onDelete={doDelete}
                      onToggleSelect={toggleSelect}
                      onShare={personId ? (en) => setShareSources([toSource(en)]) : undefined}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {dragActive && !flat && (
          <div className={styles.dropOverlay}>
            <i className="fas fa-cloud-arrow-up" aria-hidden="true" /> Drop files to upload
          </div>
        )}
      </div>

      {/* New-folder / rename prompt */}
      {prompt && (
        <Modal
          isOpen
          onClose={() => setPrompt(null)}
          ariaLabelledBy="file-prompt-title"
          initialFocusRef={promptInputRef}
          contentClassName={styles.promptModal}
        >
          <h3 id="file-prompt-title" className={styles.promptTitle}>
            {prompt.mode === 'newFolder' ? 'New folder' : 'Rename'}
          </h3>
          <input
            ref={promptInputRef}
            className={styles.promptInput}
            value={prompt.value}
            onChange={(e) => setPrompt((p) => (p ? { ...p, value: e.target.value } : p))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPrompt();
            }}
            placeholder={prompt.mode === 'newFolder' ? 'Folder name' : 'New name'}
          />
          <div className={styles.promptActions}>
            <button type="button" className={styles.toolButton} onClick={() => setPrompt(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void submitPrompt()}
              disabled={busy || !prompt.value.trim()}
            >
              {prompt.mode === 'newFolder' ? 'Create' : 'Rename'}
            </button>
          </div>
        </Modal>
      )}

      {/* Preview */}
      {preview && (
        <FilePreviewModal
          personId={personId}
          files={preview.files}
          startIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Share to LAN device */}
      <LocalSendShareModal
        open={!!shareSources}
        sources={shareSources ?? []}
        onClose={() => setShareSources(null)}
      />
    </div>
  );
};

export default FileExplorer;
