/**
 * Per-patient file explorer. Navigates the patient folder via the URL splat,
 * previews media inline, and fully manages files (upload, rename, delete, new
 * folder, move, copy). A flat toggle recursively lists every file in the current
 * subtree.
 *
 * Move and copy work the way a desktop file manager's do: Cut / Copy then Paste in
 * another folder (a clipboard bar carries them while you navigate), "Move to…" /
 * "Copy to…" with a folder picker, or dragging tiles onto a folder or a breadcrumb
 * (Ctrl held copies). A right-click — a long-press on a phone — or a tile's ⋯ opens
 * the actions menu; in selection mode Ctrl+X / C / A, Delete, F2 and Escape act on
 * the selection, and Ctrl+V pastes anywhere.
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
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, postFormData, deleteJSON, httpErrorMessage } from '@/core/http';
import { anchorFrom, type MenuAnchor } from '@/hooks/useFloatingMenu';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import Modal from '@/components/react/Modal';
import type { FileEntry, FileBatchDeleteResult } from '@/types/api.types';
import * as fileExplorer from '@shared/contracts/file-explorer.contract';
import { patientFilesQuery, takenDatesQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { invalidatePatientPhotos } from '@/query/photos';
import { buildContentUrl, encodeRelPath, folderOf, isSameOrInside } from './fileHelpers';
import FileEntryTile from './FileEntryTile';
import FilePreviewModal from './FilePreviewModal';
import FileActionsMenu, { type FileAction } from './FileActionsMenu';
import FolderPickerModal from './FolderPickerModal';
import TimepointFolderModal from './TimepointFolderModal';
import type { ShareSource } from '@/components/react/localsend/LocalSendShareModal';
import ShareSheet from '@/components/react/share/ShareSheet';
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
type TransferMode = 'move' | 'copy';
/** Cut (`move`) or copied entries waiting for Paste. */
interface ClipboardState {
  personId: number;
  mode: TransferMode;
  entries: FileEntry[];
}
interface MenuState {
  anchor: MenuAnchor;
  /** null = the folder being viewed (a right-click on its empty space). */
  targets: FileEntry[] | null;
}
interface PickerState {
  mode: TransferMode;
  entries: FileEntry[];
}

/** Marks a drag that began on one of this page's tiles, as opposed to files from the computer. */
const DRAG_MIME = 'application/x-shwan-patient-files';
const isEntryDrag = (e: DragEvent): boolean => e.dataTransfer.types.includes(DRAG_MIME);
/** Ctrl (Option on a Mac) held over a drop makes it a copy, as in Explorer. */
const isCopyDrag = (e: DragEvent): boolean => e.ctrlKey || e.altKey;
const countLabel = (n: number): string => `${n} item${n === 1 ? '' : 's'}`;

/** A 409 from the rename guard: the folder belongs to a photo session or the X-ray card. */
function isOwnedFolderConflict(err: unknown): boolean {
  const e = err as { status?: number; data?: { details?: { code?: unknown } } };
  const code = e?.data?.details?.code;
  return e?.status === 409 && (code === 'SESSION_FOLDER' || code === 'RESERVED_FOLDER');
}

const VIEW_KEY = 'fileExplorer.view';
const FLAT_KEY = 'fileExplorer.flat';
const TILE_MIN_PX = 170;
// Virtualized row heights: a tile/row plus the gap. A listing with photos is a line
// taller, for the date taken (`.withTaken` in the CSS — keep the two in step).
const ROW_PX = { grid: 188, list: 60 } as const;
const ROW_WITH_TAKEN_PX = { grid: 206, list: 68 } as const;

const FileExplorer = ({ personId, subPath }: Props) => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const currentPath = useMemo(() => (subPath || '').replace(/^\/+|\/+$/g, ''), [subPath]);

  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'grid'
  );
  const [flat, setFlat] = useState<boolean>(() => localStorage.getItem(FLAT_KEY) === '1');
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  // The synchronous twin of `busy`: a second Enter in the prompt, or a drop while an
  // upload runs, fires before the re-render that disables the button — two
  // identical renames, the second failing ENOENT into the server's error log
  // (FE-F12-9). State alone cannot close that window; a ref can.
  const busyRef = useRef(false);
  const begin = (): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const end = (): void => {
    busyRef.current = false;
    setBusy(false);
  };
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);
  const [clipboardState, setClipboard] = useState<ClipboardState | null>(null);
  // The explorer stays mounted from one patient to the next, and a relPath names the
  // same-named file under ANY patient: a clipboard only counts on its own patient.
  const clipboard = clipboardState && clipboardState.personId === personId ? clipboardState : null;
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [picker, setPicker] = useState<PickerState | null>(null);
  /** The folder being renamed to a timepoint's folder name. */
  const [timepointFolder, setTimepointFolder] = useState<FileEntry | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** The breadcrumb a drag is over (its folder's relPath). */
  const [crumbOver, setCrumbOver] = useState<string | null>(null);
  /** What a tile drag carries; read on drop (dataTransfer can't be read during dragover). */
  const dragRef = useRef<FileEntry[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  // ── Listing read (React Query; keyed on path + flat, so rapid nav supersedes
  // cleanly and back/forward is instant from cache). ──
  const { data, isLoading, error: queryError } = useQuery({
    ...patientFilesQuery(personId ?? '', currentPath, flat),
    enabled: !!personId,
  });
  const listing = data ?? null;
  const loading = !!personId && isLoading;
  const error = queryError ? httpErrorMessage(queryError, 'Failed to load files') : null;
  // Refresh every listing for this patient (any path/flat) after a file mutation.
  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: qk.patient.filesAll(personId ?? '') }),
    [queryClient, personId]
  );

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
  // Decided by the listing, not by the dates: rows never grow once those arrive.
  const hasImages = entries.some((e) => e.category === 'image');
  const rowPx = (hasImages ? ROW_WITH_TAKEN_PX : ROW_PX)[view];
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns non-memoizable functions, so the React Compiler deliberately skips optimizing this component. There is no code-level fix short of dropping virtualization (needed for large patient file lists); the component is correct unmemoized.
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowPx,
    overscan: 8,
  });
  // Re-measure when the layout-affecting inputs change.
  useEffect(() => {
    virtualizer.measure();
  }, [rowPx, columns, entries.length, virtualizer]);
  const virtualRows = virtualizer.getVirtualItems();

  // When each photo was taken (its EXIF date), shown under its name. Read per folder,
  // and only for the folders whose photos are on screen: one read inside a folder, a
  // few in flat view, more as it scrolls (a whole patient tree at once would be
  // thousands of header reads). Held 5 minutes; Refresh and every write here reload it.
  const dateFolders = [
    ...new Set(
      virtualRows
        .flatMap((vRow) => entries.slice(vRow.index * columns, (vRow.index + 1) * columns))
        .filter((e) => e.category === 'image')
        .map((e) => folderOf(e.relPath))
    ),
  ];
  const takenAtByPath = useQueries({
    queries: dateFolders.map((folder) => ({
      ...takenDatesQuery(personId ?? '', folder, 'all'),
      enabled: !!personId,
      staleTime: 5 * 60_000,
    })),
    combine: (results) => {
      const byPath: Record<string, string | null> = {};
      results.forEach((result, i) => {
        const folder = dateFolders[i] ?? '';
        for (const [name, takenAt] of Object.entries(result.data?.dates ?? {})) {
          byPath[folder ? `${folder}/${name}` : name] = takenAt;
        }
      });
      return byPath;
    },
  });

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
    async (files: FileList | File[], dest: string = currentPath) => {
      const list = Array.from(files);
      if (!personId || list.length === 0) return;
      const form = new FormData();
      list.forEach((f) => form.append('files', f));
      const qs = new URLSearchParams({ path: dest });
      if (!begin()) {
        toast.info('Wait for the current operation to finish');
        return;
      }
      try {
        // 120s to match the server's timeouts.long — a multi-file drop exceeds the
        // funnel's 30s default, which would abort it while the server was still writing.
        await postFormData(`/api/patients/${personId}/files/upload?${qs}`, form, { timeoutMs: 120000 });
        toast.success(`Uploaded ${list.length} file(s)`);
        reload();
      } catch (err) {
        toast.error(httpErrorMessage(err, 'Upload failed'));
      } finally {
        end();
      }
    },
    [personId, currentPath, toast, reload]
  );

  const submitPrompt = useCallback(async () => {
    if (!prompt || !personId) return;
    const value = prompt.value.trim();
    if (!value) return;
    if (!begin()) return;
    try {
      if (prompt.mode === 'newFolder') {
        await postJSON(`/api/patients/${personId}/files/folder`, { path: currentPath, name: value });
        toast.success('Folder created');
      } else if (prompt.target) {
        const rename = (force: boolean) =>
          postJSON(`/api/patients/${personId}/files/rename`, {
            path: prompt.target!.relPath,
            newName: value,
            ...(force ? { force: true } : {}),
          });
        try {
          await rename(false);
        } catch (err) {
          // A photo session's originals folder, or one the X-ray card reads by name:
          // the server refuses unless the user confirms, because the rename detaches
          // it from its owner (FE-F14-5).
          if (!isOwnedFolderConflict(err)) throw err;
          const ok = await confirm(
            `${httpErrorMessage(err, 'This folder belongs to something else.')} Rename it anyway?`,
            { title: 'Rename this folder?', confirmText: 'Rename anyway', danger: true }
          );
          if (!ok) return;
          await rename(true);
        }
        toast.success('Renamed');
        // A session folder rename moves what the photo editor and the grid's
        // "Open original folder" point at.
        void invalidatePatientPhotos(personId);
      }
      setPrompt(null);
      reload();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Operation failed'));
    } finally {
      end();
    }
  }, [prompt, personId, currentPath, toast, reload, confirm]);

  const doDelete = useCallback(
    async (entry: FileEntry) => {
      if (!personId) return;
      const ok = await confirm(`Move "${entry.name}" to trash?`, {
        title: 'Delete',
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok || !begin()) return;
      try {
        const qs = new URLSearchParams({ path: entry.relPath });
        await deleteJSON(`/api/patients/${personId}/files?${qs}`);
        toast.success('Moved to trash');
        reload();
      } catch (err) {
        toast.error(httpErrorMessage(err, 'Delete failed'));
      } finally {
        end();
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

  const deleteEntries = useCallback(async (sel: FileEntry[]) => {
    if (!personId || sel.length === 0) return;

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
    if (!ok || !begin()) return;

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
      toast.error(httpErrorMessage(err, 'Delete failed'));
    } finally {
      end();
    }
  }, [personId, confirm, toast, reload]);

  // Intersect with the live listing so we never send stale relPaths.
  const selectedEntries = useMemo(() => entries.filter((e) => selected.has(e.relPath)), [entries, selected]);

  // ── Move / copy ──
  // Move or copy `items` into `dest` (a folder of this patient). Returns the result,
  // or null when nothing ran (busy, the user cancelled, or it failed — each already said so).
  const transfer = useCallback(
    async (mode: TransferMode, items: FileEntry[], dest: string): Promise<fileExplorer.FileTransferResult | null> => {
      if (!personId || items.length === 0) return null;
      if (!begin()) {
        toast.info('Wait for the current operation to finish');
        return null;
      }
      setBusyLabel(`${mode === 'move' ? 'Moving' : 'Copying'} ${countLabel(items.length)}…`);
      const send = (force: boolean) =>
        postJSON<fileExplorer.FileTransferResult>(
          `/api/patients/${personId}/files/${mode}`,
          { paths: items.map((e) => e.relPath), dest, ...(force ? { force: true } : {}) },
          // The server's own deadlines: a copy rewrites every byte (10 min), a move renames (2 min).
          { schema: fileExplorer[mode].response, timeoutMs: mode === 'copy' ? 600_000 : 120_000 }
        );
      try {
        let result: fileExplorer.FileTransferResult;
        try {
          result = await send(false);
        } catch (err) {
          // A photo session's originals folder, or one the X-ray card reads by name:
          // moving it detaches it from its owner, so the server asks first (FE-F14-5).
          if (mode !== 'move' || !isOwnedFolderConflict(err)) throw err;
          const ok = await confirm(
            `${httpErrorMessage(err, 'This folder belongs to something else.')} Move it anyway?`,
            { title: 'Move this folder?', confirmText: 'Move anyway', danger: true }
          );
          if (!ok) return null;
          result = await send(true);
        }

        const done = result.results.filter((r) => r.ok && !r.skipped).length;
        const renamed = result.results.filter((r) => r.renamed).length;
        const firstError = result.results.find((r) => !r.ok)?.error ?? 'failed';
        const verb = mode === 'move' ? 'Moved' : 'Copied';
        if (result.failed > 0 && done === 0) {
          toast.error(result.failed === 1 ? firstError : `${countLabel(result.failed)} failed: ${firstError}`);
        } else if (result.failed > 0) {
          toast.warning(`${verb} ${countLabel(done)}; ${result.failed} failed: ${firstError}`);
        } else if (done === 0) {
          toast.info('Already in that folder');
        } else {
          toast.success(
            `${verb} ${countLabel(done)}${renamed ? ` (${renamed} renamed: that name was already taken there)` : ''}`
          );
        }
        // A move can carry a session's originals folder, or photos out of one.
        if (mode === 'move') void invalidatePatientPhotos(personId);
        else void reload();
        return result;
      } catch (err) {
        toast.error(httpErrorMessage(err, mode === 'move' ? 'Move failed' : 'Copy failed'));
        return null;
      } finally {
        setBusyLabel(null);
        end();
      }
    },
    [personId, toast, confirm, reload]
  );

  const toClipboard = useCallback(
    (mode: TransferMode, items: FileEntry[]) => {
      if (!personId || items.length === 0) return;
      setClipboard({ personId, mode, entries: items });
      // In selection mode a click selects instead of opening a folder — and opening
      // the folder to paste into is the next step.
      exitSelectMode();
    },
    [personId, exitSelectMode]
  );

  // Why Paste can't run in the folder being viewed, or null when it can.
  let pasteBlockedReason: string | null = null;
  if (clipboard) {
    if (flat) {
      pasteBlockedReason = 'Switch off flat view to paste';
    } else if (clipboard.entries.some((e) => e.type === 'dir' && isSameOrInside(currentPath, e.relPath))) {
      pasteBlockedReason = "Can't paste a folder into itself";
    } else if (clipboard.mode === 'move' && clipboard.entries.every((e) => folderOf(e.relPath) === currentPath)) {
      pasteBlockedReason = 'Already in this folder';
    }
  }

  const paste = useCallback(async () => {
    if (!clipboard) return;
    if (pasteBlockedReason) {
      toast.info(pasteBlockedReason);
      return;
    }
    const result = await transfer(clipboard.mode, clipboard.entries, currentPath);
    // Cut-and-paste moves once, as in any file manager, but what failed stays on the
    // clipboard to try elsewhere. A copy can be pasted again.
    if (result && clipboard.mode === 'move') {
      const failed = new Set(result.results.filter((r) => !r.ok).map((r) => r.relPath));
      const left = clipboard.entries.filter((e) => failed.has(e.relPath));
      setClipboard(left.length ? { ...clipboard, entries: left } : null);
    }
  }, [clipboard, pasteBlockedReason, transfer, currentPath, toast]);

  const cutPaths = clipboard?.mode === 'move' ? new Set(clipboard.entries.map((e) => e.relPath)) : null;

  const pickDestination = useCallback(
    async (dest: string) => {
      if (!picker) return;
      const result = await transfer(picker.mode, picker.entries, dest);
      if (!result) return; // cancelled or failed: the picker stays open to choose again
      setPicker(null);
      if (picker.mode === 'move') setSelected(new Set());
    },
    [picker, transfer]
  );

  // "Rename to existing timepoint": rename a folder to a session's folder name, which
  // is all that links it (the editor finds a session's originals by that name). A
  // session folder lives in the patient folder, so a deeper one is moved up first.
  // True when the dialog is done: renamed, or moved up but then not renamed (its
  // folder path is stale from there on, so it closes and says where the folder went).
  const renameToTimepoint = useCallback(
    async (folder: FileEntry, folderName: string, sessionName: string): Promise<boolean> => {
      if (!personId || !begin()) return false;
      let path = folder.relPath;
      const movedUpButNotRenamed = (): boolean => {
        if (path === folder.relPath) return false;
        toast.info(`“${folder.name}” was moved up to Files as “${path}” but not renamed`);
        return true;
      };
      try {
        if (folderOf(path) !== '') {
          const moved = await postJSON<fileExplorer.FileTransferResult>(
            `/api/patients/${personId}/files/move`,
            { paths: [path], dest: '' },
            { schema: fileExplorer.move.response, timeoutMs: 120_000 }
          );
          const r = moved.results[0];
          if (!r?.ok || !r.newPath) throw new Error(r?.error ?? 'Could not move the folder up to Files');
          path = r.newPath;
        }
        const rename = (force: boolean) =>
          postJSON<FileEntry>(
            `/api/patients/${personId}/files/rename`,
            { path, newName: folderName, ...(force ? { force: true } : {}) },
            { schema: fileExplorer.rename.response }
          );
        try {
          await rename(false);
        } catch (err) {
          // The folder already belongs to another session (or is OPG/CBCT): the
          // rename takes it away from there, so the server asks first (FE-F14-5).
          if (!isOwnedFolderConflict(err)) throw err;
          const ok = await confirm(
            `${httpErrorMessage(err, 'This folder belongs to something else.')} Rename it anyway?`,
            { title: 'Rename this folder?', confirmText: 'Rename anyway', danger: true }
          );
          if (!ok) return movedUpButNotRenamed();
          await rename(true);
        }
        toast.success(`“${folder.name}” is now the folder of the timepoint “${sessionName}”`);
        return true;
      } catch (err) {
        toast.error(httpErrorMessage(err, 'Rename failed'));
        return movedUpButNotRenamed();
      } finally {
        // Also after a failure: the move up may have happened before the rename failed.
        void invalidatePatientPhotos(personId);
        end();
      }
    },
    [personId, confirm, toast]
  );

  // ── Actions menu (right-click / long-press / ⋯) ──
  // On part of the selection it acts on the whole selection, as in Explorer.
  const openMenu = useCallback(
    (entry: FileEntry | null, anchor: MenuAnchor) => {
      const targets = !entry ? null : selectMode && selected.has(entry.relPath) ? selectedEntries : [entry];
      setMenu({ anchor, targets });
    },
    [selectMode, selected, selectedEntries]
  );

  const runAction = (action: FileAction): void => {
    const targets = menu?.targets ?? null;
    setMenu(null);
    const single = targets?.length === 1 ? targets[0] : null;
    switch (action) {
      case 'newFolder':
        setPrompt({ mode: 'newFolder', value: '' });
        break;
      case 'paste':
        void paste();
        break;
      case 'upload':
        fileInputRef.current?.click();
        break;
      case 'refresh':
        void reload();
        break;
      case 'open':
        if (single) openEntry(single);
        break;
      case 'share': {
        const files = (targets ?? []).filter((e) => e.type !== 'dir');
        if (files.length) setShareSources(files.map(toSource));
        break;
      }
      case 'cut':
      case 'copy':
        if (targets) toClipboard(action === 'cut' ? 'move' : 'copy', targets);
        break;
      case 'moveTo':
      case 'copyTo':
        if (targets) setPicker({ mode: action === 'moveTo' ? 'move' : 'copy', entries: targets });
        break;
      case 'rename':
        if (single) setPrompt({ mode: 'rename', target: single, value: single.name });
        break;
      case 'renameToTimepoint':
        if (single?.type === 'dir') setTimepointFolder(single);
        break;
      case 'delete':
        if (single) void doDelete(single);
        else if (targets) void deleteEntries(targets);
        break;
    }
  };

  // ── Keyboard: Ctrl+V pastes; in selection mode Ctrl+X / C / A, Delete, F2 (one
  // selected) and Escape work as in a desktop file manager. Never while typing, nor
  // under a dialog or menu — they own their keys. ──
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'v' && clipboard) {
        e.preventDefault();
        void paste();
        return;
      }
      if (!selectMode) return;
      if (mod && key === 'a') {
        e.preventDefault();
        setSelected(new Set(entries.map((x) => x.relPath)));
      } else if (e.key === 'Escape') {
        exitSelectMode();
      } else if (selectedEntries.length === 0 || window.getSelection()?.toString()) {
        // Nothing selected, or the user is copying text off the page.
      } else if (mod && (key === 'x' || key === 'c')) {
        e.preventDefault();
        toClipboard(key === 'x' ? 'move' : 'copy', selectedEntries);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        void deleteEntries(selectedEntries);
      } else if (e.key === 'F2' && selectedEntries.length === 1) {
        e.preventDefault();
        setPrompt({ mode: 'rename', target: selectedEntries[0], value: selectedEntries[0].name });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clipboard, paste, selectMode, entries, selectedEntries, exitSelectMode, toClipboard, deleteEntries]);

  // ── Drag & drop ──
  // Files from the computer dropped on the listing upload into this folder; dropped
  // on a folder tile or a breadcrumb, into that one. Tiles dragged onto a folder or a
  // breadcrumb move there (copy with Ctrl held); a tile dragged out of the selection
  // carries the whole selection.
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (isEntryDrag(e)) return;
    if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (isEntryDrag(e)) return; // a tile over empty space: nowhere to drop it
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };

  const onEntryDragStart = (entry: FileEntry, e: DragEvent<HTMLDivElement>): void => {
    dragRef.current = selectMode && selected.has(entry.relPath) ? selectedEntries : [entry];
    e.dataTransfer.setData(DRAG_MIME, String(personId));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const onEntryDragEnd = (): void => {
    dragRef.current = null;
    setCrumbOver(null);
  };

  /** Whether this drag can land on folder `dest`; when it can, it is accepted (preventDefault). */
  const acceptDrop = (dest: string, e: DragEvent<HTMLElement>): boolean => {
    let effect: 'move' | 'copy';
    if (isEntryDrag(e)) {
      const items = dragRef.current;
      if (!items || items.some((i) => i.type === 'dir' && isSameOrInside(dest, i.relPath))) return false;
      effect = isCopyDrag(e) ? 'copy' : 'move';
      if (effect === 'move' && items.every((i) => folderOf(i.relPath) === dest)) return false;
    } else if (e.dataTransfer.types.includes('Files')) {
      effect = 'copy';
    } else {
      return false;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = effect;
    return true;
  };
  const dropOn = (dest: string, e: DragEvent<HTMLElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setCrumbOver(null);
    if (isEntryDrag(e)) {
      const items = dragRef.current;
      dragRef.current = null;
      if (!items) return;
      const mode: TransferMode = isCopyDrag(e) ? 'copy' : 'move';
      void transfer(mode, items, dest).then((r) => {
        if (r && mode === 'move') setSelected(new Set());
      });
    } else if (e.dataTransfer.files?.length) {
      void doUpload(e.dataTransfer.files, dest);
    }
  };
  const folderDrop = {
    onDragOver: (en: FileEntry, e: DragEvent<HTMLDivElement>) => acceptDrop(en.relPath, e),
    onDrop: (en: FileEntry, e: DragEvent<HTMLDivElement>) => dropOn(en.relPath, e),
  };
  /** A breadcrumb as a drop target for the folder it names. */
  const crumbDrop = (dest: string) => ({
    onDragOver: (e: DragEvent<HTMLButtonElement>) => {
      if (acceptDrop(dest, e)) setCrumbOver(dest);
    },
    onDragLeave: () => setCrumbOver((c) => (c === dest ? null : c)),
    onDrop: (e: DragEvent<HTMLButtonElement>) => dropOn(dest, e),
  });
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
        <button
          type="button"
          className={`${styles.crumb} ${crumbOver === '' ? styles.crumbDrop : ''}`}
          onClick={() => goToSegment('')}
          {...crumbDrop('')}
        >
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
                <button
                  type="button"
                  className={`${styles.crumb} ${crumbOver === cumulative ? styles.crumbDrop : ''}`}
                  onClick={() => goToSegment(cumulative)}
                  {...crumbDrop(cumulative)}
                >
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
            onClick={() => toClipboard('move', selectedEntries)}
            disabled={selected.size === 0}
            title="Cut (Ctrl+X), then open a folder and Paste"
          >
            <i className="fas fa-scissors" aria-hidden="true" /> Cut
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => toClipboard('copy', selectedEntries)}
            disabled={selected.size === 0}
            title="Copy (Ctrl+C), then open a folder and Paste"
          >
            <i className="fas fa-copy" aria-hidden="true" /> Copy
          </button>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setPicker({ mode: 'move', entries: selectedEntries })}
            disabled={selected.size === 0 || busy}
          >
            <i className="fas fa-folder-tree" aria-hidden="true" /> Move to…
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
            onClick={() => void deleteEntries(selectedEntries)}
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
        </div>
      )}
      {/* Outside the toolbar: the actions menu's Upload uses it in selection mode too. */}
      <input ref={fileInputRef} type="file" multiple className={styles.hiddenInput} onChange={onFileInput} />

      {/* Clipboard: cut / copied entries carried while the user opens another folder */}
      {clipboard && (
        <div className={styles.clipboardBar}>
          <i className={`fas ${clipboard.mode === 'move' ? 'fa-scissors' : 'fa-copy'}`} aria-hidden="true" />
          <span className={styles.clipboardText} role="status">
            {clipboard.entries.length === 1 ? `"${clipboard.entries[0].name}"` : countLabel(clipboard.entries.length)}{' '}
            {clipboard.mode === 'move' ? 'cut' : 'copied'} — open a folder and paste
          </span>
          <div className={styles.toolbarSpacer} />
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void paste()}
            disabled={busy || !!pasteBlockedReason}
            title={pasteBlockedReason ?? 'Paste into this folder (Ctrl+V)'}
          >
            <i className="fas fa-paste" aria-hidden="true" /> Paste here
          </button>
          <button type="button" className={styles.toolButton} onClick={() => setClipboard(null)}>
            Cancel
          </button>
        </div>
      )}

      {busyLabel && (
        <div className={styles.busyNotice} role="status">
          <i className="fas fa-spinner fa-spin" aria-hidden="true" /> {busyLabel}
        </div>
      )}

      {listing?.truncated && (
        <div className={styles.notice}>
          Showing the first {entries.length} items — narrow the folder to see everything.
        </div>
      )}

      {/* Body (drop zone + virtualized list) */}
      <div
        className={`${styles.scrollArea} ${hasImages ? styles.withTaken : ''} ${dragActive ? styles.dragActive : ''}`}
        ref={scrollRef}
        onDrop={flat || selectMode ? undefined : onDrop}
        onDragOver={flat || selectMode ? undefined : onDragOver}
        onDragLeave={flat || selectMode ? undefined : onDragLeave}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(null, anchorFrom(e));
        }}
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
            {virtualRows.map((vRow) => {
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
                      takenAt={takenAtByPath[entry.relPath] ?? null}
                      selectMode={selectMode}
                      selected={selected.has(entry.relPath)}
                      onOpen={openEntry}
                      onToggleSelect={toggleSelect}
                      onShare={personId ? (en) => setShareSources([toSource(en)]) : undefined}
                      onMenu={openMenu}
                      cut={cutPaths?.has(entry.relPath)}
                      onDragStart={onEntryDragStart}
                      onDragEnd={onEntryDragEnd}
                      drop={folderDrop}
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
              if (e.key === 'Enter' && !busyRef.current) void submitPrompt();
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

      {menu && (
        <FileActionsMenu
          anchor={menu.anchor}
          targets={menu.targets}
          downloadHref={
            menu.targets?.length === 1 && menu.targets[0].type !== 'dir'
              ? buildContentUrl(personId, menu.targets[0].relPath, { download: true })
              : undefined
          }
          pasteLabel={clipboard ? `Paste ${countLabel(clipboard.entries.length)}` : null}
          pasteBlockedReason={pasteBlockedReason}
          flat={flat}
          onAction={runAction}
          onClose={closeMenu}
        />
      )}

      {/* Move to… / Copy to… */}
      {picker && (
        <FolderPickerModal
          personId={personId}
          mode={picker.mode}
          entries={picker.entries}
          startPath={currentPath}
          busy={busy}
          onPick={(dest) => void pickDestination(dest)}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Rename to existing timepoint */}
      {timepointFolder && (
        <TimepointFolderModal
          personId={personId}
          folder={timepointFolder}
          busy={busy}
          onPick={(folderName, sessionName) =>
            void renameToTimepoint(timepointFolder, folderName, sessionName).then((ok) => {
              if (ok) setTimepointFolder(null);
            })
          }
          onClose={() => setTimepointFolder(null)}
        />
      )}

      {/* Share — chooser (LocalSend / Telegram / …) */}
      <ShareSheet
        open={!!shareSources}
        sources={shareSources ?? []}
        onClose={() => setShareSources(null)}
      />
    </div>
  );
};

export default FileExplorer;
