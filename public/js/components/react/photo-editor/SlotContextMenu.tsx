/**
 * Right-click context menu for a photo slot (Dolphin-style). Generic: the caller
 * (SlotGrid) builds the items per slot mode — Restore original / Remove. Open/close
 * behaviour mirrors CalendarContextMenu (outside-mousedown + Escape close); the menu
 * is position:fixed at the cursor so it escapes the grid's scroll/clip.
 */
import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    const handleOutside = (event: globalThis.MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleEsc = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // Defer the outside-click listener a frame so the opening right-click doesn't close it.
    const raf = requestAnimationFrame(() => document.addEventListener('mousedown', handleOutside));
    document.addEventListener('keydown', handleEsc);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className={styles.menu} style={{ left: `${x}px`, top: `${y}px` }} role="menu">
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
