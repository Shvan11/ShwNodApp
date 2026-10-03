import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Click-and-drag horizontal scrolling for an overflowing strip (a mouse user's
 * equivalent of swiping it). Touch and pen already pan the strip natively, so only
 * a primary-button MOUSE press is handled here.
 *
 * A press only becomes a drag once it moves past DRAG_THRESHOLD_PX, so an ordinary
 * click on an item inside the strip still lands on that item. Pointer capture is
 * taken at that moment, not on pointerdown: capturing early retargets the click to
 * the strip itself and every item click would be lost. The click a drag ends with is
 * swallowed (capture phase), so releasing the mouse over a tab doesn't select it.
 *
 * Pass the scroll container's ref and spread the returned handlers onto that same
 * element (the ref stays the caller's: React Compiler's rules forbid spreading an
 * object that carries a ref in render). While a drag is active the container carries
 * `data-dragging`, for a grabbing cursor in CSS. No React state is touched mid-drag —
 * a re-render per pointermove would be pure waste.
 */
const DRAG_THRESHOLD_PX = 5;

export function useDragScroll<T extends HTMLElement>(ref: RefObject<T | null>) {
    const drag = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);

    const onPointerDown = (e: ReactPointerEvent<T>) => {
        // A stale flag (a drag whose click the browser never dispatched) must not
        // eat this press's click.
        suppressClick.current = false;
        const el = ref.current;
        if (e.pointerType !== 'mouse' || e.button !== 0 || !el) return;
        if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
        drag.current = { pointerId: e.pointerId, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
    };

    const onPointerMove = (e: ReactPointerEvent<T>) => {
        const d = drag.current;
        const el = ref.current;
        if (!d || !el || e.pointerId !== d.pointerId) return;
        const dx = e.clientX - d.startX;
        if (!d.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
            d.moved = true;
            el.setPointerCapture(e.pointerId);
            el.dataset.dragging = 'true';
        }
        el.scrollLeft = d.startScroll - dx;
    };

    const endDrag = (e: ReactPointerEvent<T>) => {
        const d = drag.current;
        const el = ref.current;
        if (!d || e.pointerId !== d.pointerId) return;
        drag.current = null;
        if (!d.moved || !el) return;
        delete el.dataset.dragging;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        // The click (if any) is dispatched synchronously after pointerup; clear the
        // flag right after it so it can never outlive this gesture.
        suppressClick.current = true;
        setTimeout(() => {
            suppressClick.current = false;
        }, 0);
    };

    const onClickCapture = (e: ReactMouseEvent<T>) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
    };

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onClickCapture,
    };
}
