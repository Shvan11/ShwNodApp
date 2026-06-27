/**
 * LookupContextMenu — a generic, cursor-anchored right-click menu used by the
 * lookup-editing infrastructure (`useLookupManager`). The caller supplies the
 * menu items; this component owns positioning + dismissal only.
 *
 * Design notes:
 *  - Rendered through a portal to <body> and `position: fixed` at the click point
 *    so it escapes any scroll/clip ancestor (e.g. a modal body) and floats above
 *    modals via `--z-index-popover`.
 *  - Position is clamped to the viewport during render from an item-count estimate
 *    (no post-mount measure → no setState-in-effect, no reposition flicker).
 *  - Dismissal: outside-mousedown (deferred one frame so the opening right-click
 *    doesn't immediately close it) + Escape. Escape is captured and
 *    `stopImmediatePropagation`'d so a menu opened over a shared <Modal> doesn't
 *    also trip that modal's document-level Escape-to-close handler.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './LookupContextMenu.module.css';

export interface LookupMenuItem {
  key: string;
  label: string;
  /** Font Awesome icon class, e.g. 'fa-pen'. */
  icon: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface LookupContextMenuProps {
  /** Viewport x of the click (clientX). */
  x: number;
  /** Viewport y of the click (clientY). */
  y: number;
  items: LookupMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 40;
const VIEWPORT_PAD = 8;

/** Keep the menu fully on-screen, biasing toward the click point. Pure. */
const clampToViewport = (x: number, y: number, itemCount: number): { left: number; top: number } => {
  const estHeight = itemCount * ITEM_HEIGHT + VIEWPORT_PAD * 2;
  const left = Math.max(VIEWPORT_PAD, Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD));
  const top = Math.max(VIEWPORT_PAD, Math.min(y, window.innerHeight - estHeight - VIEWPORT_PAD));
  return { left, top };
};

const LookupContextMenu = ({ x, y, items, onClose }: LookupContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { left, top } = clampToViewport(x, y, items.length);

  useEffect(() => {
    const handleOutside = (event: globalThis.MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Capture phase + stopImmediate so an underlying <Modal> doesn't also close.
        event.stopImmediatePropagation();
        event.preventDefault();
        onClose();
      }
    };
    // Defer the outside-click listener a frame so the opening right-click doesn't close it.
    const raf = requestAnimationFrame(() => document.addEventListener('mousedown', handleOutside));
    document.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={menuRef} className={styles.menu} style={{ left: `${left}px`, top: `${top}px` }} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <i className={`fas ${item.icon}`} aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
};

export default LookupContextMenu;
