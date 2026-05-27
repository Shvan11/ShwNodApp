/**
 * 3×3 slot grid (logo in the centre). Each view cell is a drop zone for a
 * sidebar thumbnail and hosts the SlotCanvas + per-slot toolbar. Clicking a cell
 * makes it the active (editable) slot.
 */
import { useState, type DragEvent } from 'react';
import styles from './SlotGrid.module.css';
import SlotCanvas from './SlotCanvas';
import SlotToolbar from './SlotToolbar';
import { GRID_CELLS, labelForView, type PhotoViewCode } from './photoEditorTypes';
import type { PhotoEditorState } from './usePhotoEditorState';

interface Props {
  personId: number;
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
  onActivate: (view: PhotoViewCode) => void;
}

const SlotGrid = ({ personId, editor, activeView, onActivate }: Props) => {
  const [dragOver, setDragOver] = useState<PhotoViewCode | null>(null);

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
            className={`${styles.cell} ${isActive ? styles.cellActive : ''} ${dragOver === view ? styles.cellDragOver : ''}`}
            onClick={() => onActivate(view)}
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
            <div className={styles.cellBody}>
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
              flipH={slot.flipH}
              flipV={slot.flipV}
              onRotate={(d) => editor.setRotation(view, slot.rotation + d)}
              onFlipH={() => editor.toggleFlipH(view)}
              onFlipV={() => editor.toggleFlipV(view)}
              onReset={() => editor.reset(view)}
              onRemove={() => editor.clear(view)}
            />
          </div>
        );
      })}
    </div>
  );
};

export default SlotGrid;
