/**
 * Catch a barcode scan wherever the focus is.
 *
 * A USB scanner is a keyboard: it types the code very fast and presses Enter. The
 * Stand till's barcode box only took focus on mount, so a scan made after a sale
 * (focus on <body>) was lost, and one made with the cursor in *Amount Paid* typed
 * its digits into the amount (audit FE-F19-6). This hook listens on the window in
 * the capture phase, recognises a burst — at least `MIN_LENGTH` printable keys,
 * each within `MAX_GAP_MS` of the last, ended by Enter — outside the barcode box,
 * swallows the Enter, puts back whatever the burst typed into the focused field,
 * and hands the code to `onScan`. A person typing is far slower than 50 ms a key,
 * so ordinary typing (and Enter in a form) is untouched.
 */
import { useEffect, useRef, type RefObject } from 'react';

const MAX_GAP_MS = 50;
const MIN_LENGTH = 4;

/** Set a field's value the way typing would, so a React-controlled input's onChange sees it. */
function restoreValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useScannerCapture(
  onScan: (code: string) => void,
  /** The dedicated barcode box: it handles its own Enter, so it is left alone. */
  scannerInput: RefObject<HTMLInputElement | null>
): void {
  // Latest callback without re-subscribing on every render.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    let chars = '';
    let last = 0;
    let target: HTMLInputElement | HTMLTextAreaElement | null = null;
    let before = '';
    const reset = () => {
      chars = '';
      target = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target === scannerInput.current || e.ctrlKey || e.metaKey || e.altKey) {
        reset();
        return;
      }
      const now = e.timeStamp;
      if (e.key === 'Enter') {
        const isScan = chars.length >= MIN_LENGTH && now - last <= MAX_GAP_MS * 2;
        const code = chars;
        const field = target;
        const original = before;
        reset();
        if (!isScan) return;
        e.preventDefault();
        e.stopPropagation();
        if (field) restoreValue(field, original);
        onScanRef.current(code);
        return;
      }
      if (e.key.length !== 1) {
        reset();
        return;
      }
      if (!chars || now - last > MAX_GAP_MS) {
        // A new burst: remember the field and what it held before the first key landed.
        const t = e.target;
        target = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t : null;
        before = target?.value ?? '';
        chars = '';
      }
      chars += e.key;
      last = now;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [scannerInput]);
}
