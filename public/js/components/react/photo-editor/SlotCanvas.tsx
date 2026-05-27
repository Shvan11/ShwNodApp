/**
 * One photo slot. The ACTIVE slot mounts react-easy-crop against the source
 * (pre-flipped on a canvas when flipH/flipV is set, so the crop rect comes back
 * in the same flipped space the server extracts from). INACTIVE slots render a
 * cheap CSS-transform preview; empty slots show the practice logo placeholder.
 */
import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import styles from './SlotCanvas.module.css';
import type { CropArea, SlotState } from './photoEditorTypes';
import { aspectForView, labelForView } from './photoEditorTypes';

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

  // The active slot drives the cropper's image (flipped blob when needed). Inactive
  // slots don't generate a blob — they use the source thumbnail + a CSS transform.
  useEffect(() => {
    let cancelled = false;
    if (!active || !slot.sourceRelPath) {
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
  }, [active, personId, slot.sourceRelPath, slot.flipH, slot.flipV]);

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

  if (active) {
    return (
      <div className={styles.cropWrap}>
        {mediaUrl && (
          <Cropper
            image={mediaUrl}
            crop={slot.crop}
            zoom={slot.zoom}
            rotation={slot.rotation}
            aspect={aspectForView(slot.view)}
            restrictPosition
            showGrid={false}
            objectFit="cover"
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={(_area: Area, areaPixels: Area) => onCropComplete(areaPixels as CropArea)}
          />
        )}
      </div>
    );
  }

  // Inactive preview: source thumbnail with the flip + rotation applied via CSS.
  const previewUrl = `${contentUrl(personId, slot.sourceRelPath)}&thumb=480`;
  const transform = `rotate(${slot.rotation}deg) scaleX(${slot.flipH ? -1 : 1}) scaleY(${slot.flipV ? -1 : 1})`;
  return (
    <div className={styles.preview}>
      <img src={previewUrl} alt={labelForView(slot.view)} className={styles.previewImg} style={{ transform }} loading="lazy" />
    </div>
  );
};

export default SlotCanvas;
