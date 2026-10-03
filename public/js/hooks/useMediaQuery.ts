import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept live across resizes and rotation.
 *
 * For a layout that must exist ONCE in the DOM. Showing one of two copies with a
 * `display: none` breakpoint leaves the hidden copy mounted: its `required`
 * inputs still take part in form validation, and every id and radio group is
 * doubled (audit FE-F6-5).
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        [query]
    );
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(query).matches,
        () => false
    );
}
