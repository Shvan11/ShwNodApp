/**
 * 3×3 slot grid (logo in the centre). Each view cell is a drop zone for a
 * sidebar thumbnail and hosts the SlotCanvas + per-slot toolbar. Clicking a cell
 * makes it the active (editable) slot.
 */
import { useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import styles from './SlotGrid.module.css';
import SlotCanvas from './SlotCanvas';
import SlotToolbar from './SlotToolbar';
import SlotContextMenu, { type SlotMenuItem } from './SlotContextMenu';
import { GRID_CELLS, aspectForView, labelForView, type PhotoViewCode } from './photoEditorTypes';
import type { PhotoEditorState } from './usePhotoEditorState';

interface Props {
  personId: number;
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
  onActivate: (view: PhotoViewCode) => void;
  /** Open the per-view delete confirm (right-click → Remove on a saved slot). */
  onRemoveView: (view: PhotoViewCode) => void;
}

const SlotGrid = ({ personId, editor, activeView, onActivate, onRemoveView }: Props) => {
  const [dragOver, setDragOver] = useState<PhotoViewCode | null>(null);
  const [menu, setMenu] = useState<{ view: PhotoViewCode; x: number; y: number } | null>(null);

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
      <div className={styles.grid}>
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
                onCropChange={(c) => editor.setCrop(view, c)}
                onZoomChange={(z) => editor.setZoom(view, z)}
                onCropComplete={(a) => editor.setCropped(view, a)}
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
