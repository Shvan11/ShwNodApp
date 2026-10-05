import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { relativeAge } from '../../utils/formatters';
import { useNowMinute } from '../../hooks/useClock';
import styles from './HeaderPopover.module.css';

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Viewport-fixed coordinates that hang a `width`-wide card under the bell, kept on screen. */
function placeBelow(bell: HTMLElement | null, width: number): { top: number; left: number } | null {
    const r = bell?.getBoundingClientRect();
    if (!r) return null;
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    return { top: r.bottom + 8, left: Math.max(8, left) };
}

interface HeaderPopoverProps {
    /** Controlled open state; the shell only ever asks to change it. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The bell's accessible name (may carry a count, e.g. "Tasks (3)"). */
    bellLabel: string;
    /** The bell's tooltip and the popover's accessible name. */
    title: string;
    /** Font Awesome class of the bell glyph, e.g. `fa-bell`. */
    icon: string;
    /** The count badge, already styled by the bell (null when there is nothing to count). */
    badge?: ReactNode;
    /** Popover width in px; clamped to the viewport by the stylesheet. */
    width: number;
    /** Extra class for the popover card (the bell's own surface styles). */
    popoverClassName?: string;
    children: ReactNode;
}

/**
 * The shell every header bell shares: the icon button, its badge slot, and a
 * popover portaled to `<body>` (the fixed, overflow:hidden header would clip an
 * in-flow dropdown) and positioned with viewport-fixed coordinates off the bell.
 *
 * Keyboard (audit FE-F5-12): opening moves focus into the popover, Tab cycles
 * inside it, and Escape closes it and returns focus to the bell. Escape is a
 * React handler on the popover, not a document listener, so with a confirm
 * dialog stacked on top (focus is in the dialog) one Escape closes only the
 * dialog. A click inside `#modal-root` is not an outside click for the same
 * reason. The four bells used to carry a copy of this shell each (FE-F5-13).
 */
const HeaderPopover = ({
    open,
    onOpenChange,
    bellLabel,
    title,
    icon,
    badge,
    width,
    popoverClassName,
    children,
}: HeaderPopoverProps) => {
    const popoverId = useId();
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);
    const wasOpenRef = useRef(false);

    const toggle = () => {
        if (!open) setCoords(placeBelow(bellRef.current, width));
        onOpenChange(!open);
    };

    // Outside click closes; keep the card anchored on resize.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (!target) return;
            if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return;
            // A dialog stacked over the popover (an Approve-all confirm) is not "outside".
            if (target.closest?.('#modal-root')) return;
            onOpenChange(false);
        };
        const onResize = () => setCoords(placeBelow(bellRef.current, width));
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onResize);
        };
    }, [open, onOpenChange, width]);

    // Focus in on open; back to the bell on close when focus was left nowhere
    // (the popover, and the button that had focus, are gone).
    useEffect(() => {
        if (open) {
            wasOpenRef.current = true;
            popRef.current?.focus();
            return;
        }
        if (wasOpenRef.current) {
            wasOpenRef.current = false;
            if (!document.activeElement || document.activeElement === document.body) {
                bellRef.current?.focus();
            }
        }
    }, [open]);

    // A row action that removes the focused button (Approve, Done) drops focus to
    // <body>; put it back on the card so the keyboard user keeps their place.
    useEffect(() => {
        if (open && document.activeElement === document.body) popRef.current?.focus();
    });

    const onPopoverKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onOpenChange(false);
            bellRef.current?.focus();
            return;
        }
        if (e.key !== 'Tab' || !popRef.current) return;
        const items = Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
            e.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === popRef.current)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    };

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                ref={bellRef}
                className={styles.bellBtn}
                onClick={toggle}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && open) {
                        e.stopPropagation();
                        onOpenChange(false);
                    }
                }}
                aria-label={bellLabel}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? popoverId : undefined}
                title={title}
            >
                <i className={`fas ${icon}`} aria-hidden="true" />
                {badge}
            </button>

            {open && coords && createPortal(
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keydown is the popover's Escape + Tab cycle, not an actionable handler
                <div
                    id={popoverId}
                    className={`${styles.popover} ${popoverClassName ?? ''}`}
                    role="dialog"
                    aria-label={title}
                    tabIndex={-1}
                    ref={popRef}
                    onKeyDown={onPopoverKeyDown}
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width }}
                >
                    {children}
                </div>,
                document.body
            )}
        </div>
    );
};

/** "5m" / "3h" / "2d" since `iso`, in the active language (Western digits). */
export const RelativeAge = ({ iso, className }: { iso: string | null; className?: string }) => {
    const { t } = useTranslation('common');
    // `now` from the clock store: compiled, `relativeAge(iso)` would be cached
    // on `iso` alone and "5m" would stay "5m" (FE-F26-2).
    const now = useNowMinute();
    const age = relativeAge(iso, now);
    if (!age) return null;
    return <span className={className}>{t(`age.${age.unit}`, { n: age.n })}</span>;
};

export default HeaderPopover;
