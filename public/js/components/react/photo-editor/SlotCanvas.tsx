/**
 * One photo slot. EVERY populated slot mounts react-easy-crop against the source
 * (pre-flipped on a canvas when flipH/flipV is set, so the crop rect comes back in
 * the same flipped space the server extracts from) — so the cropper is the single
 * source of truth for framing and a slot looks identical whether or not it's
 * focused. Inactive slots render the same cropper non-interactively; empty slots
 * show the practice logo placeholder.
 */
import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import styles from './SlotCanvas.module.css';
import type { CropArea, SlotState } from './photoEditorTypes';
import { aspectForView, labelForView } from './photoEditorTypes';

/** Inert crop handler for inactive slots (react-easy-crop requires onCropChange). */
const noop = (): void => {};

interface Props {
  personId: number;
  slot: SlotState;
  active: boolean;
  onCropChange: (crop: Point) => void;
  onZoomChange: (zoom: number) => void;
  onCropComplete: (area: CropArea) => void;
}

function contentUrl(personId: number, relPath: string): string {
  return `/api/patients/${personId}/files/content?path=${encodeURIComponent(relPath)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/** Draw the source to a canvas with the requested flips and return a blob URL. */
async function makeFlippedUrl(srcUrl: string, flipH: boolean, flipV: boolean): Promise<string> {
  const img = await loadImage(srcUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

const SlotCanvas = ({ personId, slot, active, onCropChange, onZoomChange, onCropComplete }: Props) => {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const revoke = (): void => {
    if (urlRef.current?.startsWith('blob:')) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  // Every populated slot (active OR inactive) drives a cropper, so load the image —
  // flipped onto a blob when flipH/flipV is set — regardless of focus. Toggling
  // `active` no longer reloads the media, so focusing a slot can't flash its image.
  useEffect(() => {
    let cancelled = false;
    if (!slot.sourceRelPath) {
      revoke();
      setMediaUrl(null);
      return;
    }
    const base = contentUrl(personId, slot.sourceRelPath);
    if (!slot.flipH && !slot.flipV) {
      revoke();
      urlRef.current = base;
      setMediaUrl(base);
      return;
    }
    makeFlippedUrl(base, slot.flipH, slot.flipV)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke();
        urlRef.current = url;
        setMediaUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMediaUrl(base); // fall back to unflipped preview
      });
    return () => {
      cancelled = true;
    };
  }, [personId, slot.sourceRelPath, slot.flipH, slot.flipV]);

  // Revoke any outstanding blob on unmount.
  useEffect(() => () => revoke(), []);

  if (!slot.sourceRelPath) {
    return (
      <div className={styles.empty}>
        <img src="/images/logo.png" alt="" className={styles.emptyLogo} />
        <span className={styles.emptyLabel}>{labelForView(slot.view)}</span>
      </div>
    );
  }

  // Active and inactive slots render the SAME controlled cropper, so framing is
  // pixel-identical whether or not the slot is focused — no reset on blur. Only the
  // focused slot is interactive and writes state; inactive slots set
  // pointer-events:none so a click falls through to the cell (activating it) and a
  // stray wheel/drag can't nudge an unfocused slot. Because the cropper container is
  // absolutely positioned, slot content never participates in layout — the cell
  // stays locked to its view's aspect box and can't reflow when framing changes.
  return (
    <div className={styles.cropWrap}>
      {mediaUrl && (
        <Cropper
          image={mediaUrl}
          crop={slot.crop}
          zoom={slot.zoom}
          rotation={slot.rotation}
          aspect={aspectForView(slot.view)}
          // Free framing: pan past the edges and zoom out below "cover". The
          // server fills any uncovered slot region with white, so the render
          // matches this preview (margins and all). minZoom < 1 enables zoom-out.
          restrictPosition={false}
          minZoom={0.2}
          maxZoom={3}
          zoomSpeed={0.25}
          showGrid={false}
          objectFit="cover"
          onCropChange={active ? onCropChange : noop}
          onZoomChange={active ? onZoomChange : undefined}
          onCropComplete={active ? (_area: Area, areaPixels: Area) => onCropComplete(areaPixels as CropArea) : undefined}
          style={{
            // The cell's own border frames the crop; hide the cropper's internal
            // outline. Inactive slots are non-interactive (clicks reach the cell).
            cropAreaStyle: { border: 0, boxShadow: 'none' },
            ...(active ? {} : { containerStyle: { pointerEvents: 'none' } }),
          }}
        />
      )}
    </div>
  );
};

export default SlotCanvas;
