import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';

/** Where a floating menu opens, in viewport pixels (its top-left corner). */
export interface MenuAnchor {
    x: number;
    y: number;
}

/**
 * Anchor for a menu opened from an element: at the pointer for a mouse event,
 * under the element for a keyboard one. A keyboard-opened `contextmenu` or an
 * Enter/Space press has no pointer, so `clientX`/`clientY` are 0 or undefined;
 * the calendar used to position its menu from them and it opened at the top-left
 * of the window (audit FE-F10-15a).
 */
export function anchorFrom(
    event: { clientX?: number; clientY?: number; currentTarget: Element }
): MenuAnchor {
    const { clientX, clientY } = event;
    if (typeof clientX === 'number' && typeof clientY === 'number' && (clientX !== 0 || clientY !== 0)) {
        return { x: clientX, y: clientY };
    }
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
}

const EDGE_PX = 8;

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

/**
 * Focus goes INTO a menu when it opens (its first enabled `role="menuitem"`) and
 * back to whatever had it when the menu closes, so a keyboard user can open it,
 * act and carry on from the same control.
 *
 * `isOpen` is for a menu rendered inline by its owner (`{open && <div role="menu">}`);
 * a menu that is its own component, mounted only while open, leaves it out.
 *
 * Without this a menu portaled to `<body>` is unreachable: focus stays on the
 * trigger and the items sit at the end of the tab order, behind the whole page
 * (the account menu's Log out was 19 Tab presses away — audit FE-F25-3).
 */
export function useMenuFocus(menuRef: RefObject<HTMLElement | null>, isOpen = true): void {
    useEffect(() => {
        if (!isOpen) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        menuRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
        return () => {
            if (opener?.isConnected) opener.focus();
        };
    }, [menuRef, isOpen]);
}

/**
 * A `role="menu"`'s keys: arrows, Home and End move between its enabled items,
 * and Tab leaves the menu, which closes it (a menu is one tab stop).
 */
export function handleMenuKeyDown(
    e: KeyboardEvent<HTMLElement>,
    menu: HTMLElement | null,
    onClose: () => void
): void {
    const items = Array.from(menu?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') {
        onClose();
        return;
    }
    if (next !== null) {
        e.preventDefault();
        items[next].focus();
    }
}

/**
 * Shared behaviour for the calendar's two context menus (audit FE-F10-15):
 *
 * - **Clamped to the viewport** after it has been measured (a layout effect, so
 *   the first paint is already in place). Only the day menu used to clamp.
 * - **Focus moves into the menu** and back out on close (`useMenuFocus`), and the
 *   arrow keys, Home and End move between items (`handleMenuKeyDown`). A menu that
 *   owns its own positioning and dismissal uses those two directly.
 * - **Dismissed** by Escape or a mousedown outside. The outside listener is armed
 *   on the next frame so the click or right-click that opened the menu cannot
 *   close it again.
 *
 * Returns the position to render at and the menu's `onKeyDown`.
 */
export function useFloatingMenu(
    menuRef: RefObject<HTMLElement | null>,
    anchor: MenuAnchor,
    onClose: () => void
): { position: MenuAnchor; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void } {
    const [position, setPosition] = useState<MenuAnchor>(anchor);

    // Keyed on the coordinates, not the object: a caller may pass an inline `{ x, y }`.
    const { x: ax, y: ay } = anchor;
    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - EDGE_PX;
        const maxY = window.innerHeight - rect.height - EDGE_PX;
        const x = Math.max(EDGE_PX, Math.min(ax, maxX));
        const y = Math.max(EDGE_PX, Math.min(ay, maxY));
        setPosition((p) => (p.x === x && p.y === y ? p : { x, y }));
    }, [menuRef, ax, ay]);

    useMenuFocus(menuRef);

    useEffect(() => {
        const handleMouseDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const frameId = requestAnimationFrame(() => {
            document.addEventListener('mousedown', handleMouseDown);
        });
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            cancelAnimationFrame(frameId);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuRef, onClose]);

    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => handleMenuKeyDown(e, menuRef.current, onClose);

    return { position, onKeyDown };
}
