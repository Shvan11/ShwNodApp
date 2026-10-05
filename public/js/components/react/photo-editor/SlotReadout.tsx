/**
 * What the selected slot's framing does to its original — beside the top-bar quick
 * actions. While editing: zoom, rotation and flips (a changed value in the accent
 * colour; zoom and rotation reset individually on click), the resolution the save
 * will keep, and a warning when the frame runs past the photo (saved as white). For a
 * saved view not being edited: the same values as it was saved, read-only.
 *
 * Resolution: a saved view keeps the crop's native pixels. Framing against the 2048 px
 * proxy (the default), the loaded media is not the original, so the original's size is
 * read from the server (`sourceSizeQuery`); in Original mode the loaded media is it.
 */
import { useQuery } from '@tanstack/react-query';
import { sourceSizeQuery } from '@/query/queries';
import styles from './SlotReadout.module.css';
import type { FramingArea, SlotState } from './photoEditorTypes';
import { LOW_RES_MEGAPIXELS, frameLeavesPhoto, megapixels, outputSize, signedDegrees } from './framing';

interface Props {
  personId: number;
  slot: SlotState | null;
  /** Framing against the 2048 px proxy (the loaded media is not the original). */
  proxyMode: boolean;
  onResetZoom: () => void;
  onResetRotation: () => void;
}

interface Values {
  zoom: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** The saved / to-be-saved pixel size, when known. */
  size: { width: number; height: number } | null;
  leavesPhoto: boolean;
}

function flipLabel(flipH: boolean, flipV: boolean): string | null {
  if (flipH && flipV) return 'Mirrored + flipped';
  if (flipH) return 'Mirrored';
  if (flipV) return 'Flipped';
  return null;
}

const SlotReadout = ({ personId, slot, proxyMode, onResetZoom, onResetRotation }: Props) => {
  const live = !!slot?.sourceRelPath;
  const sizeQ = useQuery({
    ...sourceSizeQuery(personId, slot?.sourceRelPath ?? '', slot?.sourceVersion ?? null),
    enabled: live && proxyMode,
    retry: false,
  });

  if (!slot) return null;

  let values: Values | null = null;
  if (live) {
    const area: FramingArea | null = slot.croppedArea;
    // The original's own size: the loaded media in Original mode, the server's answer
    // for the proxy.
    const source = proxyMode ? (sizeQ.data ?? null) : slot.mediaSize;
    values = {
      zoom: slot.zoom,
      rotation: slot.rotation,
      flipH: slot.flipH,
      flipV: slot.flipV,
      size: area && source ? outputSize(area, source, slot.rotation) : null,
      leavesPhoto: !!area && !!slot.mediaSize && frameLeavesPhoto(area, slot.mediaSize, slot.rotation),
    };
  } else if (slot.savedImageUrl && slot.savedFraming) {
    const f = slot.savedFraming;
    values = {
      zoom: f.zoom,
      rotation: f.rotation,
      flipH: f.flipH,
      flipV: f.flipV,
      size: slot.savedSize,
      leavesPhoto: frameLeavesPhoto(f.area, f.source, f.rotation),
    };
  } else if (slot.savedImageUrl) {
    // Saved by Dolphin, or before the framing was recorded: only its size is known.
    return (
      <div className={styles.readout} aria-label="Saved photo">
        <span className={styles.savedTag}>Saved</span>
        {slot.savedSize && <Resolution size={slot.savedSize} />}
        <span className={styles.muted} title="This photo was saved before the editor recorded framing, so its zoom and rotation are unknown">
          framing not recorded
        </span>
      </div>
    );
  }
  if (!values) return null;

  const zoomPct = Math.round(values.zoom * 100);
  const deg = signedDegrees(values.rotation);
  const flips = flipLabel(values.flipH, values.flipV);
  const zoomChanged = zoomPct !== 100;
  const rotationChanged = deg !== 0;

  return (
    <div className={`${styles.readout} ${live ? '' : styles.savedReadout}`} aria-label={live ? 'Framing' : 'Saved framing'}>
      {!live && <span className={styles.savedTag}>Saved</span>}
      {live ? (
        <button
          type="button"
          className={`${styles.value} ${zoomChanged ? styles.changed : ''}`}
          disabled={!zoomChanged}
          onClick={onResetZoom}
          title={zoomChanged ? 'Zoom (100% = the photo just fills the frame) — click to reset to 100%' : 'Zoom (100% = the photo just fills the frame)'}
        >
          Zoom {zoomPct}%
        </button>
      ) : (
        <span className={`${styles.value} ${zoomChanged ? styles.changed : ''}`}>Zoom {zoomPct}%</span>
      )}
      {live ? (
        <button
          type="button"
          className={`${styles.value} ${rotationChanged ? styles.changed : ''}`}
          disabled={!rotationChanged}
          onClick={onResetRotation}
          title={rotationChanged ? 'Rotation — click to reset to 0°' : 'Rotation'}
        >
          Rotation {deg}°
        </button>
      ) : (
        <span className={`${styles.value} ${rotationChanged ? styles.changed : ''}`}>Rotation {deg}°</span>
      )}
      {flips && <span className={`${styles.value} ${styles.changed}`}>{flips}</span>}
      {values.size && <Resolution size={values.size} />}
      {values.leavesPhoto && (
        <span
          className={`${styles.value} ${styles.warn}`}
          title="The frame runs past the photo — the uncovered part is saved as white"
        >
          <i className="fas fa-triangle-exclamation" aria-hidden="true" /> White edge
        </span>
      )}
    </div>
  );
};

function Resolution({ size }: { size: { width: number; height: number } }) {
  const mp = megapixels(size);
  const low = mp < LOW_RES_MEGAPIXELS;
  return (
    <span
      className={`${styles.value} ${low ? styles.warn : ''}`}
      title={
        low
          ? `${size.width} × ${size.height} px — under ${LOW_RES_MEGAPIXELS} MP, the saved photo may look soft. Less zoom keeps more of the original's pixels.`
          : `${size.width} × ${size.height} px`
      }
    >
      {low && <i className="fas fa-triangle-exclamation" aria-hidden="true" />}
      {mp.toFixed(1)} MP
    </span>
  );
}

export default SlotReadout;
