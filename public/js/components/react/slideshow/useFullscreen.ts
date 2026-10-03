import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

/**
 * Tracks/controls the browser Fullscreen API for a single element, with a fixed-overlay
 * FALLBACK where element fullscreen is missing or refused (iPhone Safari has none —
 * Compare's Fullscreen button used to do nothing there, FE-F13-13c).
 *
 * `isFullscreen` is true while OUR element owns native fullscreen OR the overlay is on,
 * so a caller can detect the user leaving (Esc / the OS gesture) and react (e.g. close a
 * player). `isOverlay` says which: the caller styles its element `position: fixed` for it.
 * Escape leaves the overlay, as it leaves native fullscreen. A caller that is already a
 * full-viewport overlay (the slideshow player) passes `{ fallback: false }`.
 */
export function useFullscreen<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { fallback = true }: { fallback?: boolean } = {}
) {
  const [native, setNative] = useState(false);
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    const onChange = () => setNative(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay]);

  const enter = useCallback(async () => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;
    if (typeof el.requestFullscreen !== 'function') {
      if (fallback) setOverlay(true);
      return;
    }
    try {
      await el.requestFullscreen();
    } catch {
      // Denied (permissions / unsupported) — fall back to the fixed overlay.
      if (fallback) setOverlay(true);
    }
  }, [ref, fallback]);

  const exit = useCallback(async () => {
    setOverlay(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
  }, []);

  return { isFullscreen: native || overlay, isOverlay: overlay, enter, exit };
}
