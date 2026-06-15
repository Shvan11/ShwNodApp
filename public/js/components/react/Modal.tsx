import { useEffect, useRef, useCallback, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
    closeOnBackdropClick?: boolean;
    closeOnEscape?: boolean;
    ariaLabelledBy?: string;
    ariaDescribedBy?: string;
    initialFocusRef?: RefObject<HTMLElement | null>;
    contentClassName?: string;
    overlayClassName?: string;
    /** Allow dragging the modal by its non-interactive content (header) area. Default true; auto-disabled for drawers + mobile. */
    draggable?: boolean;
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
}: ModalProps) => {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const mouseDownOnBackdropRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const dragStateRef = useRef<DragState | null>(null);
    const fallbackTitleId = useId();
    const labelledBy = ariaLabelledBy ?? fallbackTitleId;

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

    useEffect(() => {
        if (!isOpen || !closeOnEscape) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeOnEscape, onClose]);

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
                onClose();
            }
            mouseDownOnBackdropRef.current = false;
        },
        [closeOnBackdropClick, onClose],
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
                aria-labelledby={labelledBy}
                aria-describedby={ariaDescribedBy}
                tabIndex={-1}
                data-draggable={dragEnabled || undefined}
                onKeyDown={handleContentKeyDown}
                onPointerDown={dragEnabled ? handleDragPointerDown : undefined}
                onPointerMove={dragEnabled ? handleDragPointerMove : undefined}
                onPointerUp={dragEnabled ? handleDragPointerEnd : undefined}
                onPointerCancel={dragEnabled ? handleDragPointerEnd : undefined}
            >
                {children}
            </div>
        </div>,
        getPortalTarget(),
    );
};

export default Modal;
