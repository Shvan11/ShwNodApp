/// <reference types="vite/client" />

// File System Access API types (not fully standardized yet)
interface FileSystemPermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

interface FileSystemHandlePermissionDescriptor extends FileSystemPermissionDescriptor {}

interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: 'directory';
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: 'file';
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string | { type: 'write' | 'seek' | 'truncate'; data?: BufferSource | Blob | string; position?: number; size?: number }): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
}

interface Window {
    showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: { multiple?: boolean; excludeAcceptAllOption?: boolean; types?: { description?: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: { excludeAcceptAllOption?: boolean; suggestedName?: string; types?: { description?: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>;
}

// JSX modules - temporary until migration is complete
declare module '*.jsx' {
  import type { ComponentType, ReactNode } from 'react';
  const component: ComponentType<Record<string, unknown>>;
  export default component;
  export const RouteErrorBoundary: ComponentType<Record<string, unknown>>;
  export const RouteError: ComponentType<Record<string, unknown>>;
  // PrintQueueContext exports
  export const PrintQueueProvider: ComponentType<{ children: ReactNode }>;
  export function usePrintQueue(): {
    queue: unknown[];
    buildLabelsForPrint: () => unknown;
    clearQueue: () => void;
    getStats: () => unknown;
  };
  // WhatsApp Auth components
  export const StatusDisplay: ComponentType<Record<string, unknown>>;
  export const QRCodeDisplay: ComponentType<Record<string, unknown>>;
  export const SuccessDisplay: ComponentType<Record<string, unknown>>;
  export const ErrorDisplay: ComponentType<Record<string, unknown>>;
  export const ControlButtons: ComponentType<Record<string, unknown>>;
  export const ConnectionStatusFooter: ComponentType<Record<string, unknown>>;
}

// JS modules - temporary until migration is complete
declare module '*.js' {
  const content: unknown;
  export default content;
  export const PatientProvider: unknown;
}

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}
