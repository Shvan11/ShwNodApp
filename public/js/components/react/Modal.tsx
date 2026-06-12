import { useEffect, useRef, useCallback, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
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
}

const FOCUSABLE_SELECTOR =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

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
}: ModalProps) => {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const mouseDownOnBackdropRef = useRef(false);
    const fallbackTitleId = useId();
    const labelledBy = ariaLabelledBy ?? fallbackTitleId;

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
            const prev = previouslyFocusedRef.current;
            if (prev && document.contains(prev)) {
                prev.focus({ preventScroll: true });
            }
            previouslyFocusedRef.current = null;
        };
    }, [isOpen, initialFocusRef]);

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
                onKeyDown={handleContentKeyDown}
            >
                {children}
            </div>
        </div>,
        getPortalTarget(),
    );
};

export default Modal;
