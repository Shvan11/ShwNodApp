/**
 * Reading the working-files listing as photo sessions: which images each session
 * holds beyond the 8-cell grid (a Dolphin OPG, a ceph, …), how to name them in a
 * few words, and the order the working-files page shows a session's images in.
 *
 * The listing tags each entry with its session (`tpCode`) and Dolphin slot (`view`)
 * server-side (`services/files/working-files.service.ts`), so nothing here parses a
 * filename. Labels come from `shared/photo-views.ts`.
 */
import type { WorkingFileEntry } from '@shared/contracts/file-explorer.contract';
import { VIEW_CODES, isViewCode, isXraySlot, slotLabel } from '@shared/photo-views';

/** Slot order within a session: the 8 grid views as the grid lays them out, then the rest by code. */
export function compareSlots(a: string, b: string): number {
  const ia = (VIEW_CODES as readonly string[]).indexOf(a);
  const ib = (VIEW_CODES as readonly string[]).indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a.localeCompare(b);
}

/**
 * Each session's images that the 8-cell grid has no place for, keyed by the session's
 * code as the timepoints read spells it (a string). Sessions without any are absent.
 */
export function extrasBySession(entries: readonly WorkingFileEntry[]): Map<string, WorkingFileEntry[]> {
  const out = new Map<string, WorkingFileEntry[]>();
  for (const entry of entries) {
    if (isViewCode(entry.view)) continue;
    const key = String(entry.tpCode);
    const list = out.get(key);
    if (list) list.push(entry);
    else out.set(key, [entry]);
  }
  for (const list of out.values()) list.sort((a, b) => compareSlots(a.view, b.view));
  return out;
}

/**
 * A session's extras in a few words: the X-rays by name, the rest counted, since only
 * an X-ray slot says what is in it ("OPG · Ceph", "OPG · 2 images", "1 image").
 */
export function summarizeExtras(extras: readonly WorkingFileEntry[]): string {
  const xrays = [...new Set(extras.filter((e) => isXraySlot(e.view)).map((e) => slotLabel(e.view)))];
  const others = extras.filter((e) => !isXraySlot(e.view)).length;
  const parts = [...xrays];
  if (others > 0) parts.push(`${others} image${others === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Whether any of the extras is an X-ray (picks the indicator's icon). */
export function hasXray(extras: readonly WorkingFileEntry[]): boolean {
  return extras.some((e) => isXraySlot(e.view));
}
