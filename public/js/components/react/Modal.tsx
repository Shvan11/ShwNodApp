import { useEffect, useRef, useCallback, useContext } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import i18n from 'i18next';
import { ConfirmContext } from '../../contexts/confirm-context';
import styles from './Modal.module.css';

/**
 * Opt-in "this dialog holds unsaved work" policy. Declaring it makes every
 * dismissal GESTURE ask before it discards, through the app's own `useConfirm`.
 *
 * It is opt-in, not the default, on purpose: of the 73 `<Modal>` render sites
 * roughly 50 are viewers, pickers and confirms, where instant dismiss is the
 * correct behaviour and a prompt would be noise.
 */
export interface UnsavedGuard {
    /** Explicit "there is unsaved work here". OR-ed with the `watchInput` signal. */
    isDirty?: boolean;
    /**
     * Let the primitive decide: any native input/change event inside the dialog
     * marks it dirty. React writes controlled values through the DOM property and
     * dispatches nothing, so programmatic seeding — an edit form populating from
     * its row, a suggested payment amount — never trips this; only a real user
     * edit does. Blind spot: state changed by clicking something that is NOT a
     * form control (a button-grid date picker, a canvas) — pass `isDirty` too.
     */
    watchInput?: boolean;
    /**
     * Changing this clears the `watchInput` flag. For a modal that SAVES AND
     * STAYS OPEN: bind it to whatever moves on a successful write (a React Query
     * `dataUpdatedAt`, a "showing the receipt now" flag), or the work the user
     * already saved keeps counting as unsaved.
     */
    resetKey?: string | number;
    /** Overrides the confirm body. The default comes from the `common:unsaved.*` catalog. */
    message?: string;
}

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /**
     * The function form receives `dismiss` — the same guarded exit the backdrop
     * and Escape use. Hand it to the header's ✕ and the footer's Cancel so every
     * way out of a guarded modal asks the same question. Without it those two
     * buttons call `onClose` directly and skip the guard.
     */
    children: ReactNode | ((dismiss: () => void) => ReactNode);
    closeOnBackdropClick?: boolean;
    closeOnEscape?: boolean;
    /**
     * Id of the element that names this dialog — normally the `<ModalHeader>`'s
     * `titleId`, or the id of the modal's own heading when it renders one.
     *
     * Pass it. A `role="dialog"` with no accessible name is announced as just
     * "dialog", and until 2026-09-17 the default here was WORSE than that: a
     * bare `useId()` that was never rendered onto anything, so every modal that
     * omitted this shipped an `aria-labelledby` pointing at a missing element —
     * a dangling reference also suppresses the content fallback a screen reader
     * would otherwise use. Undefined now means the attribute is simply omitted.
     */
    ariaLabelledBy?: string;
    ariaDescribedBy?: string;
    initialFocusRef?: RefObject<HTMLElement | null>;
    contentClassName?: string;
    overlayClassName?: string;
    /** Allow dragging the modal by its non-interactive content (header) area. Default true; auto-disabled for drawers + mobile. */
    draggable?: boolean;
    /** Ask before a dismissal gesture discards unsaved work. See `UnsavedGuard`. */
    unsavedGuard?: UnsavedGuard;
}

const FOCUSABLE_SELECTOR =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// Pointer-down on any of these (or inside them) starts a normal interaction, never a drag.
const DRAG_INTERACTIVE_SELECTOR =
    'a, button, input, select, textarea, label, [contenteditable="true"], [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [data-no-drag]';
// Keep at least this many px of the modal on-screen on every axis so it can't be lost.
const DRAG_MIN_VISIBLE = 60;

interface DragState {
    pointerId: number;
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    startOffsetX: number;
    startOffsetY: number;
    width: number;
}

let openCount = 0;
let savedBodyOverflow: string | null = null;
let savedBodyPaddingRight: string | null = null;

function lockBodyScroll(): void {
    openCount += 1;
    if (openCount === 1) {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        savedBodyOverflow = document.body.style.overflow;
        savedBodyPaddingRight = document.body.style.paddingRight;
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }
        document.getElementById('app-root')?.setAttribute('aria-hidden', 'true');
        document.getElementById('single-spa-application')?.setAttribute('aria-hidden', 'true');
    }
}

function unlockBodyScroll(): void {
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) {
        document.body.style.overflow = savedBodyOverflow ?? '';
        document.body.style.paddingRight = savedBodyPaddingRight ?? '';
        savedBodyOverflow = null;
        savedBodyPaddingRight = null;
        document.getElementById('app-root')?.removeAttribute('aria-hidden');
        document.getElementById('single-spa-application')?.removeAttribute('aria-hidden');
    }
}

function getPortalTarget(): HTMLElement {
    if (typeof document === 'undefined') {
        throw new Error('Modal requires a document');
    }
    return document.getElementById('modal-root') ?? document.body;
}

/**
 * Escape is served by ONE document listener over a stack of the open modals,
 * and only the TOP entry answers it.
 *
 * It cannot be one listener per instance: they all sit on `document`, and
 * `stopPropagation()` does not stop a sibling listener on the same node — so
 * every open modal's handler ran and a single Escape closed the whole stack,
 * taking any half-filled form underneath with it (a `PaymentModal` + its
 * underpayment confirm went 2 dialogs → 0 on one keypress).
 *
 * An open modal ALWAYS registers, even with `closeOnEscape={false}`: the top
 * modal swallows the key either way, so a deliberately non-dismissible dialog
 * (`closeOnEscape={!loading}` mid-save) can't let Escape through to close the
 * modal beneath it.
 *
 * Bubble phase on purpose. A cursor-anchored popover that opens OVER a modal —
 * `LookupContextMenu` — still beats this by listening in the capture phase with
 * `stopImmediatePropagation()`; registering here in capture would run first and
 * close the modal out from under it.
 */
interface EscapeEntry {
    /** Reads the live props through a ref, so the entry survives re-renders. */
    handle: () => void;
}

const escapeStack: EscapeEntry[] = [];
let escapeListenerAttached = false;

function handleDocumentEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (!top) return;
    event.stopPropagation();
    top.handle();
}

function pushEscapeEntry(entry: EscapeEntry): void {
    escapeStack.push(entry);
    if (!escapeListenerAttached) {
        document.addEventListener('keydown', handleDocumentEscape);
        escapeListenerAttached = true;
    }
}

function removeEscapeEntry(entry: EscapeEntry): void {
    // Remove by identity, not pop: a modal lower in the stack can close first.
    const index = escapeStack.indexOf(entry);
    if (index !== -1) escapeStack.splice(index, 1);
    if (escapeStack.length === 0 && escapeListenerAttached) {
        document.removeEventListener('keydown', handleDocumentEscape);
        escapeListenerAttached = false;
    }
}

const Modal = ({
    isOpen,
    onClose,
    children,
    closeOnBackdropClick = true,
    closeOnEscape = true,
    ariaLabelledBy,
    ariaDescribedBy,
    initialFocusRef,
    contentClassName,
    overlayClassName,
    draggable = true,
    unsavedGuard,
}: ModalProps) => {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const mouseDownOnBackdropRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const dragStateRef = useRef<DragState | null>(null);

    // Drawers are docked to a screen edge — dragging them makes no sense.
    const isDrawer = !!overlayClassName && /drawer/i.test(overlayClassName);
    const dragEnabled = draggable && !isDrawer;

    useEffect(() => {
        if (!isOpen) return;

        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        lockBodyScroll();

        const contentEl = contentRef.current;
        if (contentEl) {
            const target = initialFocusRef?.current
                ?? contentEl.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
                ?? contentEl;
            target.focus({ preventScroll: true });
        }

        return () => {
            unlockBodyScroll();
            // A drag in progress when the modal unmounts would leave the body un-selectable.
            document.body.style.removeProperty('user-select');
            dragStateRef.current = null;
            const prev = previouslyFocusedRef.current;
            if (prev && document.contains(prev)) {
                prev.focus({ preventScroll: true });
            }
            previouslyFocusedRef.current = null;
        };
    }, [isOpen, initialFocusRef]);

    // Re-center on each open — a previously-dragged position shouldn't persist to the next open.
    useEffect(() => {
        if (!isOpen) return;
        dragOffsetRef.current = { x: 0, y: 0 };
        if (contentRef.current) {
            contentRef.current.style.removeProperty('transform');
        }
    }, [isOpen]);

    // `useConfirm()` throws without a provider and Modal must stay usable outside
    // RootLayout, so read the raw context and treat null as "cannot ask".
    const confirmFn = useContext(ConfirmContext);

    /**
     * Has the user edited a form control in here?
     *
     * A REF, and it must stay one: this is not render state, and making it state
     * silently ate the first keystroke of every guarded form. The listener below
     * sits on the content node, DEEPER than the node React delegates to (the
     * portal container), so it runs BEFORE React turns the same event into
     * `onChange`. A `setState` there forces a synchronous re-render mid-dispatch,
     * the controlled input is rewritten with its pre-keystroke value, and React's
     * own handler then reads that stale value back off the DOM — "typed" arrived
     * as "yped". A ref never renders, so it cannot interleave.
     */
    const sawInputRef = useRef(false);

    // A NATIVE listener, deliberately not React's `onInput`: synthetic events
    // bubble through the REACT tree, so a portaled child — the lookup manager
    // stacked on the expense form — would mark its parent dirty. A DOM listener
    // sees only real descendants.
    const watchInput = unsavedGuard?.watchInput === true;
    const dirtyResetKey = unsavedGuard?.resetKey;
    useEffect(() => {
        // Also the `resetKey` reset: a modal that saved and stayed open starts clean.
        sawInputRef.current = false;
        if (!isOpen || !watchInput) return;
        const el = contentRef.current;
        if (!el) return;
        const mark = () => {
            sawInputRef.current = true;
        };
        el.addEventListener('input', mark);
        el.addEventListener('change', mark);
        return () => {
            el.removeEventListener('input', mark);
            el.removeEventListener('change', mark);
        };
    }, [isOpen, watchInput, dirtyResetKey]);

    /**
     * The single exit for every dismissal GESTURE — backdrop, Escape, and (via
     * the children-as-function form) the header's ✕ and the footer's Cancel.
     *
     * A programmatic `onClose()` from the consumer is deliberately NOT routed
     * here: saving and closing must never ask.
     *
     * No re-entrancy guard is needed. While the confirm is open it owns the top
     * of the escape stack and its own overlay covers this dialog, so no second
     * gesture can reach the modal underneath it.
     */
    const requestDismiss = useCallback(() => {
        const dirty = !!unsavedGuard
            && (unsavedGuard.isDirty === true || (unsavedGuard.watchInput === true && sawInputRef.current));
        if (!dirty || !confirmFn) {
            onClose();
            return;
        }
        void confirmFn(unsavedGuard.message ?? i18n.t('unsaved.message'), {
            title: i18n.t('unsaved.title'),
            confirmText: i18n.t('unsaved.discard'),
            cancelText: i18n.t('unsaved.keepEditing'),
            danger: true,
        }).then((discard) => {
            if (discard) onClose();
        });
    }, [unsavedGuard, confirmFn, onClose]);

    // The escape-stack entry must stay the SAME object across re-renders —
    // re-pushing on every `onClose` identity change would move an already-open
    // modal back to the top of the stack — so it reads both live values through
    // refs. Both reads happen inside a document keydown handler, never in render.
    const escapeOptionsRef = useRef({ closeOnEscape });
    useEffect(() => {
        escapeOptionsRef.current = { closeOnEscape };
    }, [closeOnEscape]);

    const requestDismissRef = useRef(requestDismiss);
    useEffect(() => {
        requestDismissRef.current = requestDismiss;
    }, [requestDismiss]);

    const escapeEntryRef = useRef<EscapeEntry>({
        handle: () => {
            if (escapeOptionsRef.current.closeOnEscape) requestDismissRef.current();
        },
    });

    useEffect(() => {
        if (!isOpen) return;
        const entry = escapeEntryRef.current;
        pushEscapeEntry(entry);
        return () => removeEscapeEntry(entry);
    }, [isOpen]);

    const handleContentKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;

        const contentEl = contentRef.current;
        if (!contentEl) return;

        const focusables = Array.from(contentEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusables.length === 0) {
            event.preventDefault();
            contentEl.focus();
            return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || active === contentEl)) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
        }
    }, []);

    const handleOverlayMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        mouseDownOnBackdropRef.current = event.target === event.currentTarget;
    }, []);

    const handleOverlayClick = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            if (!closeOnBackdropClick) return;
            const clickedBackdrop = event.target === event.currentTarget;
            if (clickedBackdrop && mouseDownOnBackdropRef.current) {
                requestDismiss();
            }
            mouseDownOnBackdropRef.current = false;
        },
        [closeOnBackdropClick, requestDismiss],
    );

    const handleDragPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragEnabled || event.button !== 0) return;
            // Modals are near full-width on phones — dragging there is pointless and steals scroll.
            if (window.matchMedia('(max-width: 768px)').matches) return;

            const content = contentRef.current;
            if (!content) return;
            const target = event.target as HTMLElement;

            // If a modal declares explicit handle(s), only those start a drag.
            const hasHandle = content.querySelector('[data-modal-drag-handle]') !== null;
            if (hasHandle && !target.closest('[data-modal-drag-handle]')) return;
            // Never start a drag from an interactive control (button, input, link, …).
            if (target.closest(DRAG_INTERACTIVE_SELECTOR)) return;

            const rect = content.getBoundingClientRect();
            dragStateRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                baseLeft: rect.left - dragOffsetRef.current.x,
                baseTop: rect.top - dragOffsetRef.current.y,
                startOffsetX: dragOffsetRef.current.x,
                startOffsetY: dragOffsetRef.current.y,
                width: rect.width,
            };
            content.setPointerCapture(event.pointerId);
            document.body.style.userSelect = 'none';
        },
        [dragEnabled],
    );

    const handleDragPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        const content = contentRef.current;
        if (!drag || !content || event.pointerId !== drag.pointerId) return;

        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        // Clamp so at least DRAG_MIN_VISIBLE px stays on screen on both axes (header never lost above).
        const minLeft = DRAG_MIN_VISIBLE - drag.width;
        const maxLeft = window.innerWidth - DRAG_MIN_VISIBLE;
        const left = Math.min(maxLeft, Math.max(minLeft, drag.baseLeft + drag.startOffsetX + dx));
        const maxTop = window.innerHeight - DRAG_MIN_VISIBLE;
        const top = Math.min(maxTop, Math.max(0, drag.baseTop + drag.startOffsetY + dy));

        const offsetX = left - drag.baseLeft;
        const offsetY = top - drag.baseTop;
        dragOffsetRef.current = { x: offsetX, y: offsetY };
        content.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    }, []);

    const handleDragPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        dragStateRef.current = null;
        document.body.style.removeProperty('user-select');
        const content = contentRef.current;
        if (content?.hasPointerCapture(event.pointerId)) {
            content.releasePointerCapture(event.pointerId);
        }
    }, []);

    if (!isOpen) return null;

    const overlayClass = overlayClassName ? `${styles.overlay} ${overlayClassName}` : styles.overlay;
    const contentClass = contentClassName ? `${styles.content} ${contentClassName}` : styles.content;

    return createPortal(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss
        <div
            className={overlayClass}
            onMouseDown={handleOverlayMouseDown}
            onClick={handleOverlayClick}
        >
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keydown is the dialog focus-trap, not an actionable handler */}
            <div
                ref={contentRef}
                className={contentClass}
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                tabIndex={-1}
                data-draggable={dragEnabled || undefined}
                onKeyDown={handleContentKeyDown}
                onPointerDown={dragEnabled ? handleDragPointerDown : undefined}
                onPointerMove={dragEnabled ? handleDragPointerMove : undefined}
                onPointerUp={dragEnabled ? handleDragPointerEnd : undefined}
                onPointerCancel={dragEnabled ? handleDragPointerEnd : undefined}
            >
                {/* eslint-disable-next-line react-hooks/refs -- `dismiss` reads the dirty
                    ref when the user CLICKS, never during render; consumers only ever
                    hand it to an onClick/onClose. Keeping the flag out of state is
                    what stops it eating the first keystroke (see sawInputRef above). */}
                {typeof children === 'function' ? children(requestDismiss) : children}
            </div>
        </div>,
        getPortalTarget(),
    );
};

export default Modal;
