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
  startIn?: FileSystemDirectoryHandle | 'desktop' | 'documents' | 'downloads';
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
 * Open IndexedDB database for storing file handles
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Save a handle to IndexedDB for persistence across sessions
 */
export async function saveHandle(
  key: string,
  handle: FileSystemHandle,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const entry: StoredHandleEntry = {
      key,
      handle,
      type: handle.kind,
      timestamp: Date.now(),
      metadata
    };
    const request = store.put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a saved handle from IndexedDB
 */
export async function getHandle(key: string): Promise<FileSystemHandle | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const entry = request.result as StoredHandleEntry | undefined;
      resolve(entry?.handle);
    };
    request.onerror = () => reject(request.error);
  });
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
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * List all saved handles
 */
export async function listHandles(): Promise<StoredHandleEntry[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as StoredHandleEntry[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all saved handles
 */
export async function clearHandles(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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
    const pickerOptions: Parameters<typeof window.showOpenFilePicker>[0] = {
      multiple: options?.multiple ?? false,
      excludeAcceptAllOption: options?.excludeAcceptAllOption ?? false
    };

    if (options?.accept) {
      pickerOptions!.types = [{
        description: options.description ?? 'Files',
        accept: options.accept
      }];
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
export async function pickFile(
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
 * Pick an INI file specifically
 */
export async function pickIniFile(): Promise<FileOperationResult<FileSystemFileHandle>> {
  return pickFile(
    { 'text/plain': ['.ini', '.INI'] },
    'INI Configuration Files'
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
  handle: FileSystemFileHandle,
  encoding: string = 'utf-8'
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
 * Get a file from a directory
 */
export async function getFileFromDirectory(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  create: boolean = false
): Promise<FileOperationResult<FileSystemFileHandle>> {
  try {
    const fileHandle = await directory.getFileHandle(fileName, { create });
    return { success: true, data: fileHandle };
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

/**
 * Check if error is permission denied
 */
export function isPermissionError(error: unknown): boolean {
  return (error as Error)?.name === 'NotAllowedError';
}

export default {
  // Browser support
  checkBrowserSupport,
  isFileSystemAccessSupported,
  // IndexedDB
  saveHandle,
  getHandle,
  getFileHandle,
  getDirectoryHandle,
  removeHandle,
  listHandles,
  clearHandles,
  // Permissions
  checkPermission,
  requestPermission,
  ensurePermission,
  // File picker
  showFilePicker,
  pickFile,
  pickIniFile,
  showDirectoryPickerDialog,
  // File operations
  readTextFile,
  writeTextFile,
  getFile,
  // Directory navigation
  navigateToDirectory,
  getFileFromDirectory,
  // Error helpers
  isAbortError,
  isNotFoundError,
  isPermissionError
};
