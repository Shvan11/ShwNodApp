/**
 * Per-slot editing toolbar. Crop + zoom are inherent to the slot's cropper
 * (drag to pan, wheel/pinch to zoom); the buttons cover quick 90° rotate / flip /
 * mirror / reset / remove, and the slider does fine free rotation (leveling).
 */
import styles from './SlotToolbar.module.css';

interface Props {
  hasImage: boolean;
  flipH: boolean;
  flipV: boolean;
  rotation: number;
  onRotate: (delta: number) => void;
  onSetRotation: (deg: number) => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onReset: () => void;
  onRemove: () => void;
}

const SlotToolbar = ({
  hasImage,
  flipH,
  flipV,
  rotation,
  onRotate,
  onSetRotation,
  onFlipH,
  onFlipV,
  onReset,
  onRemove,
}: Props) => {
  // The fine-rotation slider is centred on 0° (upright): dragging right rotates
  // clockwise, left counter-clockwise. Rotation is stored 0–359, so present it as
  // a signed offset in [-180, 180] (the reducer re-normalises negatives on input).
  const deg = Math.round(rotation);
  const signedDeg = deg > 180 ? deg - 360 : deg;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Photo framing tools">
      <div className={styles.buttons}>
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
      <label className={styles.rotateRow}>
        <i className="fas fa-rotate" aria-hidden="true" title="Fine rotation" />
        <input
          type="range"
          className={styles.slider}
          min={-180}
          max={180}
          step={1}
          value={signedDeg}
          disabled={!hasImage}
          onChange={(e) => onSetRotation(Number(e.target.value))}
          aria-label="Fine rotation (degrees, 0 = upright)"
        />
        <span className={styles.deg}>{signedDeg}°</span>
      </label>
    </div>
  );
};

export default SlotToolbar;
