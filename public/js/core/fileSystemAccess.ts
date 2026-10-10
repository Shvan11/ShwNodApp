/**
 * File System Access API Utility
 * Provides cross-browser file system access with IndexedDB persistence
 * for FileSystemHandles (Chrome/Edge only)
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Supported permission modes */
export type PermissionMode = 'read' | 'readwrite';

/** Result of checking browser support */
export interface BrowserSupportResult {
  isSupported: boolean;
  hasFilePicker: boolean;
  hasDirectoryPicker: boolean;
  browser: 'chrome' | 'edge' | 'opera' | 'unsupported';
}

/** Options for file picker */
export interface FilePickerOptions {
  description?: string;
  accept?: Record<string, string[]>;
  multiple?: boolean;
  startIn?: FileSystemDirectoryHandle | 'desktop' | 'documents' | 'downloads';
  excludeAcceptAllOption?: boolean;
}

/** Options for directory picker */
export interface DirectoryPickerOptions {
  id?: string;
  mode?: PermissionMode;
  /** A handle opens the dialog in that folder (a file's handle: in the folder holding it). */
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads';
}

/** Result of a file operation */
export interface FileOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  errorName?: string;
}

/** Stored handle entry in IndexedDB */
export interface StoredHandleEntry {
  key: string;
  handle: FileSystemHandle;
  type: 'file' | 'directory';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DB_NAME = 'FileSystemHandles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

// ============================================================================
// BROWSER SUPPORT
// ============================================================================

/**
 * Check browser support for File System Access API
 */
export function checkBrowserSupport(): BrowserSupportResult {
  const hasFilePicker = 'showOpenFilePicker' in window;
  const hasDirectoryPicker = 'showDirectoryPicker' in window;
  const isSupported = hasFilePicker && hasDirectoryPicker;

  // Detect browser
  const ua = navigator.userAgent;
  let browser: BrowserSupportResult['browser'] = 'unsupported';

  if (ua.includes('Edg/')) {
    browser = 'edge';
  } else if (ua.includes('OPR/') || ua.includes('Opera/')) {
    browser = 'opera';
  } else if (ua.includes('Chrome/') && !ua.includes('Chromium/')) {
    browser = 'chrome';
  }

  return { isSupported, hasFilePicker, hasDirectoryPicker, browser };
}

/**
 * Check if the API is supported (quick check)
 */
export function isFileSystemAccessSupported(): boolean {
  return 'showOpenFilePicker' in window;
}

// ============================================================================
// INDEXEDDB OPERATIONS
// ============================================================================

/**
 * Open IndexedDB database for storing file handles.
 *
 * `onblocked` rejects instead of waiting: a `DB_VERSION` bump with another tab
 * still holding an old connection fires only `blocked`, and with no handler the
 * promise never settled — "remember this folder" spun with no error (audit
 * FE-F1-5). Every connection also yields to a later upgrade (`onversionchange`),
 * though `withStore` below closes each one as soon as its transaction ends.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('The saved-folder store is being upgraded — close the app\'s other tabs and try again.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Run ONE request against the handle store and close the connection when its
 * transaction ends. Every helper used to open a connection and never close it —
 * one live `IDBDatabase` per call on a long-lived tab, and each one blocks a
 * future upgrade. Resolves on the transaction's `complete` (so a write is
 * committed, not merely queued) with the request's result.
 */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], mode);
      const request = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/**
 * Save a handle to IndexedDB for persistence across sessions
 */
export async function saveHandle(
  key: string,
  handle: FileSystemHandle,
  metadata?: Record<string, unknown>
): Promise<void> {
  const entry: StoredHandleEntry = {
    key,
    handle,
    type: handle.kind,
    timestamp: Date.now(),
    metadata
  };
  await withStore('readwrite', (store) => store.put(entry));
}

/**
 * Get a saved handle from IndexedDB
 */
async function getHandle(key: string): Promise<FileSystemHandle | undefined> {
  const entry = (await withStore('readonly', (store) => store.get(key))) as StoredHandleEntry | undefined;
  return entry?.handle;
}

/**
 * Get a saved file handle from IndexedDB
 */
export async function getFileHandle(key: string): Promise<FileSystemFileHandle | undefined> {
  const handle = await getHandle(key);
  if (handle && handle.kind === 'file') {
    return handle as FileSystemFileHandle;
  }
  return undefined;
}

/**
 * Get a saved directory handle from IndexedDB
 */
export async function getDirectoryHandle(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  const handle = await getHandle(key);
  if (handle && handle.kind === 'directory') {
    return handle as FileSystemDirectoryHandle;
  }
  return undefined;
}

/**
 * Remove a saved handle from IndexedDB
 */
export async function removeHandle(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key));
}

// ============================================================================
// PERMISSION MANAGEMENT
// ============================================================================

/**
 * Check if we have permission for a handle
 */
export async function checkPermission(
  handle: FileSystemHandle,
  mode: PermissionMode = 'read'
): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return 'denied';
  }
}

/**
 * Request permission for a handle
 */
export async function requestPermission(
  handle: FileSystemHandle,
  mode: PermissionMode = 'read'
): Promise<PermissionState> {
  try {
    return await handle.requestPermission({ mode });
  } catch {
    return 'denied';
  }
}

/**
 * Ensure we have permission, requesting if needed
 * @returns true if permission granted
 */
export async function ensurePermission(
  handle: FileSystemHandle,
  mode: PermissionMode = 'read'
): Promise<boolean> {
  let permission = await checkPermission(handle, mode);

  if (permission !== 'granted') {
    permission = await requestPermission(handle, mode);
  }

  return permission === 'granted';
}

// ============================================================================
// FILE PICKER OPERATIONS
// ============================================================================

/**
 * Show file picker dialog
 */
export async function showFilePicker(
  options?: FilePickerOptions
): Promise<FileOperationResult<FileSystemFileHandle[]>> {
  if (!isFileSystemAccessSupported()) {
    return {
      success: false,
      error: 'File System Access API not supported',
      errorName: 'NotSupportedError'
    };
  }

  try {
    // `startIn` is part of the spec but missing from the lib.dom type, so widen locally.
    const pickerOptions: NonNullable<Parameters<typeof window.showOpenFilePicker>[0]> & {
      startIn?: FilePickerOptions['startIn'];
    } = {
      multiple: options?.multiple ?? false,
      excludeAcceptAllOption: options?.excludeAcceptAllOption ?? false
    };

    if (options?.accept) {
      pickerOptions.types = [{
        description: options.description ?? 'Files',
        accept: options.accept
      }];
    }

    // Default the picker's starting location (e.g. a remembered directory handle).
    if (options?.startIn) {
      pickerOptions.startIn = options.startIn;
    }

    const handles = await window.showOpenFilePicker(pickerOptions);
    return { success: true, data: handles };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

/**
 * Pick a single file with specific type
 */
async function pickFile(
  accept: Record<string, string[]>,
  description?: string
): Promise<FileOperationResult<FileSystemFileHandle>> {
  const result = await showFilePicker({
    accept,
    description,
    multiple: false
  });

  if (result.success && result.data && result.data.length > 0) {
    return { success: true, data: result.data[0] };
  }

  return {
    success: false,
    error: result.error ?? 'No file selected',
    errorName: result.errorName
  };
}

/**
 * Pick an INI file specifically. `includeBackups` also lists `.backup` files — the
 * Protocol Handlers page saves its backups as `ProtocolHandlers.ini.backup`, which an
 * `.ini`-only filter hid from its own Restore picker (audit FE-F22-13).
 */
export async function pickIniFile(
  { includeBackups = false }: { includeBackups?: boolean } = {}
): Promise<FileOperationResult<FileSystemFileHandle>> {
  return pickFile(
    { 'text/plain': includeBackups ? ['.ini', '.INI', '.backup'] : ['.ini', '.INI'] },
    includeBackups ? 'INI files and backups' : 'INI Configuration Files'
  );
}

/**
 * Show directory picker dialog
 */
export async function showDirectoryPickerDialog(
  options?: DirectoryPickerOptions
): Promise<FileOperationResult<FileSystemDirectoryHandle>> {
  if (!('showDirectoryPicker' in window)) {
    return {
      success: false,
      error: 'Directory picker not supported',
      errorName: 'NotSupportedError'
    };
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      id: options?.id,
      mode: options?.mode ?? 'read',
      startIn: options?.startIn ?? 'desktop'
    });
    return { success: true, data: dirHandle };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

// ============================================================================
// FILE READ/WRITE OPERATIONS
// ============================================================================

/**
 * Read text content from a file handle
 */
export async function readTextFile(
  handle: FileSystemFileHandle
): Promise<FileOperationResult<string>> {
  try {
    const file = await handle.getFile();
    const content = await file.text();
    return { success: true, data: content };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

/**
 * Write text content to a file handle
 */
export async function writeTextFile(
  handle: FileSystemFileHandle,
  content: string
): Promise<FileOperationResult<void>> {
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

/**
 * Get File object from a file handle
 */
export async function getFile(
  handle: FileSystemFileHandle
): Promise<FileOperationResult<File>> {
  try {
    const file = await handle.getFile();
    return { success: true, data: file };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

// ============================================================================
// DIRECTORY NAVIGATION
// ============================================================================

/**
 * Navigate to a subdirectory
 * @param parent Parent directory handle
 * @param path Subdirectory path (can be nested like "foo/bar/baz")
 * @param create Create directories if they don't exist
 */
export async function navigateToDirectory(
  parent: FileSystemDirectoryHandle,
  path: string,
  create: boolean = false
): Promise<FileOperationResult<FileSystemDirectoryHandle>> {
  try {
    const parts = path.split('/').filter(p => p.length > 0);
    let current = parent;

    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }

    return { success: true, data: current };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: err.message,
      errorName: err.name
    };
  }
}

/**
 * Where each handle sits under `dir`, as the path segments `resolve()` returns (the last
 * is the entry's own name) — or null when ANY of them is not inside `dir`. A caller that
 * will delete under `dir`'s read-write grant asks this BEFORE it starts: an entry from
 * outside the folder can only be removed through its own handle, and for that Chrome
 * asks "Save changes to <file>?" once per file.
 */
export async function locateWithin(
  dir: FileSystemDirectoryHandle,
  handles: FileSystemHandle[]
): Promise<string[][] | null> {
  const paths: string[][] = [];
  for (const handle of handles) {
    const segments = await dir.resolve(handle).catch(() => null);
    if (!segments || segments.length === 0) return null;
    paths.push(segments);
  }
  return paths;
}

/** Delete the entry at `segments` (as `locateWithin` returned them) under `dir`'s own grant. */
export async function removeEntryAt(dir: FileSystemDirectoryHandle, segments: string[]): Promise<void> {
  let parent = dir;
  for (const part of segments.slice(0, -1)) {
    parent = await parent.getDirectoryHandle(part);
  }
  await parent.removeEntry(segments[segments.length - 1]);
}

// ============================================================================
// ERROR HANDLING HELPERS
// ============================================================================

/**
 * Check if error is user cancellation (AbortError)
 */
export function isAbortError(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError';
}

/**
 * Check if error is file not found
 */
export function isNotFoundError(error: unknown): boolean {
  return (error as Error)?.name === 'NotFoundError';
}

// No `export default {…}`: all four consumers use named imports. The object was
// the only reference to listHandles, clearHandles, getFileFromDirectory and
// isPermissionError, which are now deleted; getHandle and pickFile are
// module-internal and no longer exported.
