/**
 * 3×3 slot grid (logo in the centre). Each view cell is a drop zone for a
 * sidebar thumbnail and hosts the SlotCanvas + per-slot toolbar. Clicking a cell
 * makes it the active (editable) slot.
 */
import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import styles from './SlotGrid.module.css';
import SlotCanvas from './SlotCanvas';
import SlotToolbar from './SlotToolbar';
import SlotContextMenu, { type SlotMenuItem } from './SlotContextMenu';
import {
  GRID_CELLS,
  aspectForView,
  labelForView,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_SPEED,
  type PhotoViewCode,
} from './photoEditorTypes';
import type { PhotoEditorState } from './usePhotoEditorState';

interface Props {
  personId: number;
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
  /** Crop against 2048px server thumbnails instead of the originals. */
  proxyMode: boolean;
  onActivate: (view: PhotoViewCode) => void;
  /** Open the per-view delete confirm (right-click → Remove on a saved slot). */
  onRemoveView: (view: PhotoViewCode) => void;
}

const SlotGrid = ({ personId, editor, activeView, proxyMode, onActivate, onRemoveView }: Props) => {
  const [dragOver, setDragOver] = useState<PhotoViewCode | null>(null);
  const [menu, setMenu] = useState<{ view: PhotoViewCode; x: number; y: number } | null>(null);

  // Scroll-zoom for the SELECTED slot. react-easy-crop's own wheel listener only
  // fires over the crop area (and not at all on inactive slots, which are
  // pointer-events:none), so the cell header/toolbar/margins were dead zones where
  // the wheel scrolled the page instead of zooming — the inconsistency users hit.
  // Instead, one non-passive listener on the grid: a wheel anywhere over the active
  // cell always zooms its slot and never scrolls the page; wheel elsewhere is left
  // alone. A ref carries the latest editor state so the once-attached listener never
  // goes stale.
  const gridRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ activeView, slots: editor.slots, setZoom: editor.setZoom });
  latest.current = { activeView, slots: editor.slots, setZoom: editor.setZoom };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const { activeView: view, slots, setZoom } = latest.current;
      if (!view) return;
      const cell = (e.target as HTMLElement | null)?.closest('[data-slot-cell]') as HTMLElement | null;
      if (!cell || cell.dataset.active !== 'true') return; // only over the selected slot
      const slot = slots[view];
      if (!slot.sourceRelPath) return; // only a populated (live cropper) slot can zoom
      e.preventDefault();
      // Normalize wheel delta to pixels (mouse=0, lines=1, pages=2), then mirror
      // react-easy-crop's zoom step so the feel matches a cursor over the crop area.
      let pixelY = e.deltaY;
      if (e.deltaMode === 1) pixelY *= 16;
      else if (e.deltaMode === 2) pixelY *= cell.clientHeight || 800;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, slot.zoom - (pixelY * ZOOM_SPEED) / 200));
      if (next !== slot.zoom) setZoom(view, next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Right-click a populated slot (saved or live) → context menu. Empty slots keep
  // the browser's default menu.
  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>, view: PhotoViewCode): void => {
    const slot = editor.slots[view];
    if (!slot.sourceRelPath && !slot.savedImageUrl) return;
    e.preventDefault();
    setMenu({ view, x: e.clientX, y: e.clientY });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, view: PhotoViewCode): void => {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { relPath?: string; name?: string };
      if (data.relPath) {
        editor.place(view, data.relPath, data.name || data.relPath);
        onActivate(view);
      }
    } catch {
      /* ignore malformed drag payload */
    }
  };

  return (
    <>
      <div className={styles.grid} ref={gridRef}>
      {GRID_CELLS.map((cell) => {
        if (cell === 'logo') {
          return (
            <div key="logo" className={styles.logoCell}>
              <img src="/images/logo.png" alt="Shwan Orthodontics" className={styles.logoImg} />
            </div>
          );
        }
        const view = cell;
        const slot = editor.slots[view];
        const isActive = activeView === view;
        return (
          <div
            key={view}
            data-slot-cell=""
            data-active={isActive ? 'true' : undefined}
            className={`${styles.cell} ${isActive ? styles.cellActive : ''} ${dragOver === view ? styles.cellDragOver : ''}`}
            onClick={() => onActivate(view)}
            onContextMenu={(e) => handleContextMenu(e, view)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOver !== view) setDragOver(view);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOver(null);
            }}
            onDrop={(e) => handleDrop(e, view)}
          >
            <div className={styles.cellHeader}>{labelForView(view)}</div>
            <div className={styles.cellBody} style={{ aspectRatio: aspectForView(view) }}>
              <SlotCanvas
                personId={personId}
                slot={slot}
                active={isActive}
                proxyMode={proxyMode}
                onCropChange={(c) => editor.setCrop(view, c)}
                onZoomChange={(z) => editor.setZoom(view, z)}
                onCropComplete={(a) => editor.setCropped(view, a)}
                onMediaLoaded={(s) => editor.setMediaSize(view, s)}
              />
            </div>
            <SlotToolbar
              hasImage={!!slot.sourceRelPath}
              rotation={slot.rotation}
              onSetRotation={(deg) => editor.setRotation(view, deg)}
            />
          </div>
        );
      })}
      </div>
      {menu &&
        (() => {
          const slot = editor.slots[menu.view];
          const items: SlotMenuItem[] = [];
          if (!slot.sourceRelPath && slot.canReEdit && slot.reEditRelPath) {
            const relPath = slot.reEditRelPath;
            const name = slot.reEditName ?? relPath;
            items.push({
              key: 'restore',
              label: 'Restore original to re-edit',
              icon: 'fa-rotate-left',
              onClick: () => {
                editor.place(menu.view, relPath, name);
                onActivate(menu.view);
              },
            });
          }
          if (slot.sourceRelPath) {
            items.push({
              key: 'remove',
              label: 'Remove',
              icon: 'fa-xmark',
              danger: true,
              onClick: () => editor.clear(menu.view),
            });
          } else if (slot.savedImageUrl) {
            items.push({
              key: 'remove',
              label: 'Remove',
              icon: 'fa-trash',
              danger: true,
              onClick: () => onRemoveView(menu.view),
            });
            if (!slot.canReEdit) {
              items.push({
                key: 'hint',
                label: 'Original missing — drag one to redo',
                icon: 'fa-circle-info',
                disabled: true,
                onClick: () => undefined,
              });
            }
          }
          if (!items.length) return null;
          return <SlotContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />;
        })()}
    </>
  );
};

export default SlotGrid;
