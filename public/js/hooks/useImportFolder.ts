/**
 * useImportFolder — remembers the camera/memory-card import folder across sessions and
 * tracks its File System Access permission status. Shared by the "New Photo Session"
 * modal (to show status) and the photo editor's "Move from card" flow (to reuse the
 * folder so importing is one-click once access is granted).
 *
 * The directory handle is persisted in IndexedDB (survives reloads), but its permission
 * usually resolves to 'prompt' on a fresh load — re-granting must happen from a user
 * gesture (a button click), so this hook never calls requestPermission on mount.
 * Mirrors the persisted-handle pattern in pages/aligner/PatientSets.tsx.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  isFileSystemAccessSupported,
  showDirectoryPickerDialog,
  saveHandle,
  getDirectoryHandle,
  removeHandle,
  checkPermission,
  requestPermission,
  type PermissionMode,
} from '@/core/fileSystemAccess';

/** IndexedDB key for the remembered import (memory-card) folder handle. */
export const IMPORT_FOLDER_KEY = 'photo-import-folder';

export type ImportFolderStatus = 'unsupported' | 'unset' | 'granted' | 'prompt' | 'denied';

export interface UseImportFolder {
  /** Browser supports the File System Access API (Chromium + secure context). */
  supported: boolean;
  /** The remembered directory handle, or null if none/unsupported. */
  handle: FileSystemDirectoryHandle | null;
  status: ImportFolderStatus;
  /** Leaf name of the folder (the API never exposes the full path). */
  folderName: string | null;
  loading: boolean;
  /** Open the picker, persist the chosen folder, return the handle (null on cancel/error). */
  choosePick: () => Promise<FileSystemDirectoryHandle | null>;
  /** Re-request permission for the remembered handle. Must run inside a click handler. */
  grant: () => Promise<boolean>;
  /** Forget the remembered folder. */
  clear: () => Promise<void>;
  /** Re-read the saved handle + permission state without prompting. */
  refresh: () => Promise<void>;
}

function toStatus(p: PermissionState): ImportFolderStatus {
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  return 'prompt';
}

export function useImportFolder(mode: PermissionMode = 'readwrite'): UseImportFolder {
  const [supported] = useState(() => isFileSystemAccessSupported());
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<ImportFolderStatus>(supported ? 'unset' : 'unsupported');
  const [loading, setLoading] = useState(supported);

  // Read the saved handle + its permission without prompting. Written as a
  // .then-chain (NOT an async fn) so every setState lives in a chained callback,
  // never synchronously in the caller — that's the shape the React Compiler accepts
  // from a mount effect (an `async` callee trips react-hooks/set-state-in-effect).
  // Assumes `supported` — callers guard it.
  const loadSaved = useCallback(
    (): Promise<void> =>
      getDirectoryHandle(IMPORT_FOLDER_KEY)
        .then(saved => {
          if (!saved) {
            setHandle(null);
            setStatus('unset');
            return;
          }
          setHandle(saved);
          return checkPermission(saved, mode).then(perm => setStatus(toStatus(perm)));
        })
        .catch(() => {
          setHandle(null);
          setStatus('unset');
        })
        .finally(() => setLoading(false)),
    [mode]
  );

  // Mount: read once. `loading` starts true (initial state) and the unsupported
  // case is already reflected in the initial state, so the effect sets nothing
  // synchronously — it only kicks off the read when supported.
  useEffect(() => {
    if (!supported) return;
    void loadSaved();
  }, [supported, loadSaved]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!supported) {
      setStatus('unsupported');
      setLoading(false);
      return;
    }
    setLoading(true);
    await loadSaved();
  }, [supported, loadSaved]);

  const choosePick = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!supported) return null;
    // `id` lets Chrome reopen the last-used card folder; readwrite so we can delete originals later.
    const result = await showDirectoryPickerDialog({ mode, id: 'photo-card-import' });
    if (!result.success || !result.data) return null; // cancelled or error — caller stays silent
    const dir = result.data;
    await saveHandle(IMPORT_FOLDER_KEY, dir, { expectedName: dir.name });
    setHandle(dir);
    setStatus('granted'); // picking with readwrite grants in-gesture
    return dir;
  }, [supported, mode]);

  const grant = useCallback(async (): Promise<boolean> => {
    if (!handle) return false;
    const perm = await requestPermission(handle, mode);
    setStatus(toStatus(perm));
    return perm === 'granted';
  }, [handle, mode]);

  const clear = useCallback(async (): Promise<void> => {
    await removeHandle(IMPORT_FOLDER_KEY);
    setHandle(null);
    setStatus(supported ? 'unset' : 'unsupported');
  }, [supported]);

  return {
    supported,
    handle,
    status,
    folderName: handle?.name ?? null,
    loading,
    choosePick,
    grant,
    clear,
    refresh,
  };
}
