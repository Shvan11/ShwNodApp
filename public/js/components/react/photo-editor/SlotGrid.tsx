/**
 * 3×3 slot grid (logo in the centre). Each view cell is a drop zone for a
 * sidebar thumbnail and hosts the SlotCanvas + per-slot toolbar. Clicking a cell
 * makes it the active (editable) slot; double-clicking a saved one continues
 * editing it. Each cell's title bar carries its status — what Save would do.
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
import { slotStatus } from './framing';
import { continueBlockedReason } from './slotLabels';

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
  /** Per view, another session's saved photo to lay faintly over the slot (the Overlay tool). */
  overlayUrls?: Partial<Record<PhotoViewCode, string>>;
  overlayOpacity?: number;
}

const SlotGrid = ({
  personId,
  editor,
  activeView,
  proxyMode,
  armed,
  onPlaced,
  onActivate,
  onRemoveView,
  overlayUrls = {},
  overlayOpacity,
}: Props) => {
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

  // Where the last press inside a cell started (see isPlacementClick).
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  // Did this click mean "put the picked photo here"? Panning the live cropper and
  // using the rotation strip both bubble a `click` to the cell too, and used to
  // place the pick over the photo being framed. A pan is a press that moved; the
  // strip is all of SlotToolbar — its gaps and readout too, so a near-miss on the
  // slider can't swap the photo either.
  const isPlacementClick = (e: ReactMouseEvent<HTMLDivElement>): boolean => {
    const from = pressAt.current;
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return false;
    return !(e.target as HTMLElement).closest('[data-slot-toolbar], button, input');
  };

  // Activate a cell; with a photo picked in the sidebar, place it there first. No
  // event = the keyboard path (Enter/Space on the cell), always a deliberate pick.
  const activate = (view: PhotoViewCode, e?: ReactMouseEvent<HTMLDivElement>): void => {
    if (armed && (!e || isPlacementClick(e))) {
      editor.place(view, armed.relPath, armed.name, armed.modified ?? null);
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
      const data = JSON.parse(raw) as { relPath?: string; name?: string; modified?: string };
      if (data.relPath) {
        editor.place(view, data.relPath, data.name || data.relPath, data.modified ?? null);
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
        const status = slotStatus(slot);
        return (
          <div
            key={view}
            data-slot-cell=""
            data-active={isActive ? 'true' : undefined}
            role="button"
            tabIndex={0}
            aria-label={armed ? `Place ${armed.name} in ${labelForView(view)}` : labelForView(view)}
            className={`${styles.cell} ${isActive ? styles.cellActive : ''} ${dragOver === view || (armed && !slot.sourceRelPath) ? styles.cellDragOver : ''}`}
            onPointerDown={(e) => {
              pressAt.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={(e) => activate(view, e)}
            onDoubleClick={() => {
              // A saved view whose framing was recorded: reopen it where it was left.
              if (!slot.sourceRelPath && slot.canContinue) {
                editor.continueEditing(view);
                onActivate(view);
              }
            }}
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
            <div className={styles.cellHeader}>
              <span>{labelForView(view)}</span>
              {status === 'unsaved' && (
                <span className={`${styles.mark} ${styles.markUnsaved}`} title="Changed since it was saved — Save writes it, Cancel throws it away">
                  Unsaved
                </span>
              )}
              {status === 'saved' && (
                <span className={`${styles.mark} ${styles.markSaved}`} title="Saved — matches the photo on disk">
                  <i className="fas fa-check" aria-hidden="true" /> Saved
                </span>
              )}
            </div>
            <div className={styles.cellBody} style={{ aspectRatio: aspectForView(view) }}>
              <SlotCanvas
                personId={personId}
                slot={slot}
                active={isActive}
                proxyMode={proxyMode}
                onCropChange={(c) => editor.setCrop(view, c)}
                onZoomChange={(z) => editor.setZoom(view, z)}
                onCropComplete={(area, pixels) => editor.setCropped(view, area, pixels)}
                onMediaLoaded={(s) => editor.setMediaSize(view, s)}
                overlayUrl={overlayUrls[view] ?? null}
                overlayOpacity={overlayOpacity}
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
            const version = slot.reEditVersion;
            // Both re-edit routes, always: "Continue" says why when it can't.
            const blocked = continueBlockedReason(slot);
            items.push({
              key: 'continue',
              label: blocked ? `Continue editing — ${blocked}` : 'Continue editing (keep framing)',
              icon: 'fa-pen-to-square',
              disabled: !!blocked,
              onClick: () => {
                editor.continueEditing(menu.view);
                onActivate(menu.view);
              },
            });
            items.push({
              key: 'restore',
              label: 'Start over from original',
              icon: 'fa-clock-rotate-left',
              onClick: () => {
                editor.place(menu.view, relPath, name, version);
                onActivate(menu.view);
              },
            });
          }
          if (slot.sourceRelPath) {
            // With a saved photo underneath, dropping the edit brings it back.
            items.push(
              slot.savedImageUrl
                ? {
                    key: 'discard',
                    label: 'Discard changes (back to the saved photo)',
                    icon: 'fa-xmark',
                    onClick: () => editor.discard(menu.view),
                  }
                : {
                    key: 'remove',
                    label: 'Remove',
                    icon: 'fa-xmark',
                    danger: true,
                    onClick: () => editor.discard(menu.view),
                  }
            );
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
