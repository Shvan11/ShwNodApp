import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

/**
 * Tracks/controls the browser Fullscreen API for a single element.
 * Mirrors the pattern in CompareComponent (requestFullscreen + fullscreenchange).
 *
 * `isFullscreen` is true only while OUR element owns fullscreen, so a caller can
 * detect the user exiting via Esc / the OS gesture and react (e.g. close a player).
 * `enter()` swallows rejection so callers can fall back to a fixed overlay.
 */
export function useFullscreen<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  const enter = useCallback(async () => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;
    try {
      await el.requestFullscreen();
    } catch {
      /* Denied (permissions / unsupported) — caller stays in fixed-overlay fallback. */
    }
  }, [ref]);

  const exit = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
  }, []);

  return { isFullscreen, enter, exit };
}
