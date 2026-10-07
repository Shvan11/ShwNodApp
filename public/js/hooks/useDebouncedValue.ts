import { useEffect, useState } from 'react';

/**
 * `value`, once it has stopped changing for `delayMs`.
 *
 * For a value that drives a request as it is typed: the request follows the
 * pauses, not the keystrokes.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
