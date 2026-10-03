/**
 * Per-slot fine-rotation slider (leveling). The quick actions — 90° rotate, flip,
 * mirror, reset framing, remove — moved to the topbar SlotActions to save vertical
 * space; only the slider stays under each slot because fine rotation has no mouse
 * equivalent. Crop + zoom are inherent to the cropper (drag to pan, wheel/pinch).
 *
 * The row is a group, NOT a <label>: a label's click goes to its first labelable
 * descendant, which here was the −1° button — so a click on the icon, the degree
 * readout or any gap between the controls (37% of the strip) turned the photo 1°.
 * `data-slot-toolbar` tells SlotGrid that clicks here never place a picked photo.
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
  // Nudge buttons step ±1°; the reducer re-normalises so wrap-around is safe.
  return (
    <div className={styles.toolbar} data-slot-toolbar="">
      <div className={styles.rotateRow} role="group" aria-label="Fine rotation">
        <i className="fas fa-rotate" aria-hidden="true" title="Fine rotation" />
        <button
          type="button"
          className={styles.nudge}
          disabled={!hasImage}
          onClick={() => onSetRotation(deg - 1)}
          title="Rotate 1° counter-clockwise"
          aria-label="Rotate 1 degree counter-clockwise"
        >
          −1°
        </button>
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
        <button
          type="button"
          className={styles.nudge}
          disabled={!hasImage}
          onClick={() => onSetRotation(deg + 1)}
          title="Rotate 1° clockwise"
          aria-label="Rotate 1 degree clockwise"
        >
          +1°
        </button>
        <span className={styles.deg}>{signedDeg}°</span>
      </div>
    </div>
  );
};

export default SlotToolbar;
