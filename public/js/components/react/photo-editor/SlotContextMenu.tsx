/**
 * Right-click context menu for a photo slot (Dolphin-style). Generic: the caller
 * (SlotGrid) builds the items per slot mode — Restore original / Remove. Focus,
 * arrow keys, Escape, outside-click and viewport clamping come from the shared
 * `useFloatingMenu`, as for the calendar menus (FE-F14-13b); the menu is
 * position:fixed at the cursor so it escapes the grid's scroll/clip.
 */
import { useRef } from 'react';
import { useFloatingMenu } from '@/hooks/useFloatingMenu';
import styles from './SlotContextMenu.module.css';

export interface SlotMenuItem {
  key: string;
  label: string;
  /** Font Awesome icon class, e.g. 'fa-rotate-left'. */
  icon: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: SlotMenuItem[];
  onClose: () => void;
}

const SlotContextMenu = ({ x, y, items, onClose }: Props) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { position, onKeyDown } = useFloatingMenu(menuRef, { x, y }, onClose);

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      role="menu"
      // Not "empty space": PhotoEditor clears the selected slot on a click outside a
      // cell, and this menu is drawn outside one — "Continue editing" selected its
      // slot and lost it again in the same click.
      data-slot-menu=""
      tabIndex={-1}
      aria-label="Photo slot actions"
      onKeyDown={onKeyDown}
    >
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
    </div>
  );
};

export default SlotContextMenu;
