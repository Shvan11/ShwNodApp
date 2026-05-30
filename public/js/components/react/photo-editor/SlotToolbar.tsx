/**
 * Per-slot fine-rotation slider (leveling). The quick actions — 90° rotate, flip,
 * mirror, reset framing, remove — moved to the topbar SlotActions to save vertical
 * space; only the slider stays under each slot because fine rotation has no mouse
 * equivalent. Crop + zoom are inherent to the cropper (drag to pan, wheel/pinch).
 */
import styles from './SlotToolbar.module.css';

interface Props {
  hasImage: boolean;
  rotation: number;
  onSetRotation: (deg: number) => void;
}

const SlotToolbar = ({ hasImage, rotation, onSetRotation }: Props) => {
  // The slider is centred on 0° (upright): dragging right rotates clockwise, left
  // counter-clockwise. Rotation is stored 0–359, so present it as a signed offset
  // in [-180, 180] (the reducer re-normalises negatives on input).
  const deg = Math.round(rotation);
  const signedDeg = deg > 180 ? deg - 360 : deg;
  return (
    <div className={styles.toolbar}>
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
