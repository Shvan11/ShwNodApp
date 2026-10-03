import { useSyncExternalStore } from 'react';

/**
 * Remembers which photo session (timepoint tab) was last open for each patient, so
 * the sidebar's Photos button reopens it instead of always landing on tp0 — on a
 * patient with a long session strip, finding your place again was the slow part.
 *
 * Kept in sessionStorage (per browser tab, survives a reload, gone when the tab
 * closes) so it never accumulates across days and thousands of patients. A small
 * external store rather than a plain storage read in render: the sidebar stays
 * mounted while the tabs change, and React Compiler would memoize a bare read on
 * `personId` and hand back the stale tab.
 */
const KEY_PREFIX = 'shwan_photo_tab:';
const listeners = new Set<() => void>();
// Mirror of what was written, so a blocked/unavailable sessionStorage still
// remembers for the life of the page.
const memory = new Map<string, string>();

function read(personId: string): string | null {
    if (memory.has(personId)) return memory.get(personId) ?? null;
    try {
        return sessionStorage.getItem(KEY_PREFIX + personId);
    } catch {
        return null;
    }
}

export function rememberPhotoTab(personId: number | string, tpCode: string): void {
    const id = String(personId);
    if (read(id) === tpCode) return;
    memory.set(id, tpCode);
    try {
        sessionStorage.setItem(KEY_PREFIX + id, tpCode);
    } catch {
        // Storage blocked (private mode, quota) — the in-memory copy still serves.
    }
    listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The tp_code last shown for this patient in this browser tab, or null. */
export function useLastPhotoTab(personId: number | string | null | undefined): string | null {
    return useSyncExternalStore(subscribe, () => (personId == null ? null : read(String(personId))));
}
