/**
 * 3×3 slot grid (logo in the centre). Each view cell is a drop zone for a
 * sidebar thumbnail and hosts the SlotCanvas + per-slot toolbar. Clicking a cell
 * makes it the active (editable) slot.
 */
import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brandingQuery } from '@/query/queries';
import { anchorFrom } from '@/hooks/useFloatingMenu';
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
import type { ArmedPhoto } from './SequenceSidebar';

interface Props {
  personId: number;
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
  /** Crop against 2048px server thumbnails instead of the originals. */
  proxyMode: boolean;
  /** A sidebar photo picked by click/keyboard: the next activated slot receives it. */
  armed: ArmedPhoto | null;
  onPlaced: () => void;
  onActivate: (view: PhotoViewCode) => void;
  /** Open the per-view delete confirm (right-click → Remove on a saved slot). */
  onRemoveView: (view: PhotoViewCode) => void;
}

const SlotGrid = ({ personId, editor, activeView, proxyMode, armed, onPlaced, onActivate, onRemoveView }: Props) => {
  const [dragOver, setDragOver] = useState<PhotoViewCode | null>(null);
  // The centre cell is THIS install's logo and name (Settings → General), not this
  // clinic's file from the repository (FE-F14-11).
  const { data: branding } = useQuery(brandingQuery());
  const clinicName = branding?.clinicName?.trim() || '';
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
  // Synced after commit (not during render); the wheel listener fires on user
  // interaction, so it always reads the latest values.
  useEffect(() => {
    latest.current = { activeView, slots: editor.slots, setZoom: editor.setZoom };
  });

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
  // The menu key and Shift+F10 fire `contextmenu` too, with no pointer position —
  // `anchorFrom` places that menu under the cell (FE-F14-13b).
  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>, view: PhotoViewCode): void => {
    const slot = editor.slots[view];
    if (!slot.sourceRelPath && !slot.savedImageUrl) return;
    e.preventDefault();
    const { x, y } = anchorFrom(e);
    setMenu({ view, x, y });
  };

  // Activate a cell; with a photo picked in the sidebar, place it there first.
  const activate = (view: PhotoViewCode): void => {
    if (armed) {
      editor.place(view, armed.relPath, armed.name);
      onPlaced();
    }
    onActivate(view);
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
              {branding?.logo ? (
                <img src={branding.logo} alt={clinicName} className={styles.logoImg} />
              ) : (
                <span className={styles.logoName}>{clinicName}</span>
              )}
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
            role="button"
            tabIndex={0}
            aria-label={armed ? `Place ${armed.name} in ${labelForView(view)}` : labelForView(view)}
            className={`${styles.cell} ${isActive ? styles.cellActive : ''} ${dragOver === view || (armed && !slot.sourceRelPath) ? styles.cellDragOver : ''}`}
            onClick={() => activate(view)}
            onKeyDown={(e) => {
              // Only the cell itself: keys inside the cropper/toolbar are theirs.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(view); }
            }}
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
