/**
 * Per-slot editing toolbar. Crop + zoom are inherent to the slot's cropper
 * (drag to pan, wheel/pinch to zoom); these buttons cover rotate / flip / mirror
 * / reset / remove.
 */
import styles from './SlotToolbar.module.css';

interface Props {
  hasImage: boolean;
  flipH: boolean;
  flipV: boolean;
  onRotate: (delta: number) => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onReset: () => void;
  onRemove: () => void;
}

const SlotToolbar = ({ hasImage, flipH, flipV, onRotate, onFlipH, onFlipV, onReset, onRemove }: Props) => (
  <div className={styles.toolbar} role="toolbar" aria-label="Photo framing tools">
    <button type="button" className={styles.btn} disabled={!hasImage} title="Rotate left 90°" onClick={() => onRotate(-90)}>
      <i className="fas fa-rotate-left" aria-hidden="true" />
    </button>
    <button type="button" className={styles.btn} disabled={!hasImage} title="Rotate right 90°" onClick={() => onRotate(90)}>
      <i className="fas fa-rotate-right" aria-hidden="true" />
    </button>
    <button
      type="button"
      className={`${styles.btn} ${flipH ? styles.active : ''}`}
      disabled={!hasImage}
      title="Mirror (horizontal)"
      onClick={onFlipH}
    >
      <i className="fas fa-arrows-left-right" aria-hidden="true" />
    </button>
    <button
      type="button"
      className={`${styles.btn} ${flipV ? styles.active : ''}`}
      disabled={!hasImage}
      title="Flip (vertical)"
      onClick={onFlipV}
    >
      <i className="fas fa-arrows-up-down" aria-hidden="true" />
    </button>
    <button type="button" className={styles.btn} disabled={!hasImage} title="Reset framing" onClick={onReset}>
      <i className="fas fa-arrows-rotate" aria-hidden="true" />
    </button>
    <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={!hasImage} title="Remove photo" onClick={onRemove}>
      <i className="fas fa-xmark" aria-hidden="true" />
    </button>
  </div>
);

export default SlotToolbar;
