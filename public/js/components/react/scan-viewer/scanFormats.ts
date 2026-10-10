/**
 * Which files the 3D scan viewer opens. Kept apart from `scanScene.ts` so a screen
 * can decide whether to offer the viewer without pulling three.js into its chunk.
 */
export type ScanFormat = 'stl' | 'ply' | 'zip';

export function scanFormat(fileName: string): ScanFormat | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext === 'stl' || ext === 'ply' || ext === 'zip' ? ext : null;
}
