/**
 * One photo slot. EVERY populated slot mounts react-easy-crop against the source
 * (pre-flipped on a canvas when flipH/flipV is set, so the crop rect comes back in
 * the same flipped space the server extracts from) — so the cropper is the single
 * source of truth for framing and a slot looks identical whether or not it's
 * focused. Inactive slots render the same cropper non-interactively; empty slots
 * show the practice logo placeholder.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, MediaSize, Point } from 'react-easy-crop';
import styles from './SlotCanvas.module.css';
import type { CropArea, PhotoViewCode, SlotState } from './photoEditorTypes';
import { aspectForView, gridLinesForView, labelForView, ZOOM_MIN, ZOOM_MAX, ZOOM_SPEED } from './photoEditorTypes';

/** Inert crop handler for inactive slots (react-easy-crop requires onCropChange). */
const noop = (): void => {};

/**
 * Per-view framing guides, absolutely positioned over the slot content. The crop
 * area / saved image fills the aspect-locked cell, so these fractions map 1:1 onto
 * the rendered output. pointer-events:none so the lines never intercept pan/zoom.
 */
function GridLines({ view }: { view: PhotoViewCode }): ReactElement | null {
  const lines = gridLinesForView(view);
  if (!lines.horizontal.length && !lines.vertical.length) return null;
  return (
    <div className={styles.gridOverlay} aria-hidden="true">
      {lines.horizontal.map((f, i) => (
        <div key={`h${i}`} className={styles.hLine} style={{ top: `${f * 100}%` }} />
      ))}
      {lines.vertical.map((f, i) => (
        <div key={`v${i}`} className={styles.vLine} style={{ left: `${f * 100}%` }} />
      ))}
    </div>
  );
}

interface Props {
  personId: number;
  slot: SlotState;
  active: boolean;
  /** Crop against the 2048px cached server thumbnail instead of the original. */
  proxyMode: boolean;
  onCropChange: (crop: Point) => void;
  onZoomChange: (zoom: number) => void;
  onCropComplete: (area: CropArea) => void;
  /** Natural (post-EXIF) dims of the loaded media — the space the crop rect lives in. */
  onMediaLoaded: (size: { width: number; height: number }) => void;
}

function contentUrl(personId: number, relPath: string, proxy: boolean): string {
  const base = `/api/patients/${personId}/files/content?path=${encodeURIComponent(relPath)}`;
  // 2048 must stay in the thumbnail service's ALLOWED_WIDTHS.
  return proxy ? `${base}&thumb=2048` : base;
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
  // Release the full-resolution backing store now that the blob is encoded.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

const SlotCanvas = ({ personId, slot, active, proxyMode, onCropChange, onZoomChange, onCropComplete, onMediaLoaded }: Props) => {
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
    const base = contentUrl(personId, slot.sourceRelPath, proxyMode);
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
        if (!cancelled) {
          // Release any stale flipped blob before falling back, otherwise it
          // leaks (the success path revokes, but this error path skipped it).
          revoke();
          urlRef.current = base;
          setMediaUrl(base); // fall back to unflipped preview
        }
      });
    return () => {
      cancelled = true;
    };
  }, [personId, slot.sourceRelPath, slot.flipH, slot.flipV, proxyMode]);

  // Revoke any outstanding blob on unmount.
  useEffect(() => () => revoke(), []);

  if (!slot.sourceRelPath) {
    // A saved (already-cropped) view with no live edit → show the baked image
    // read-only. The slot's right-click menu offers Restore original / Remove.
    if (slot.savedImageUrl) {
      return (
        <div className={styles.saved}>
          <img
            src={slot.savedImageUrl}
            alt={labelForView(slot.view)}
            className={styles.savedImg}
            loading="lazy"
          />
          <GridLines view={slot.view} />
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        <img src="/images/logo.png" alt="" className={styles.emptyLogo} />
        <span className={styles.emptyLabel}>{labelForView(slot.view)}</span>
      </div>
    );
  }

  // Active and inactive slots render the SAME controlled cropper, so framing is
  // pixel-identical whether or not the slot is focused — no reset on blur. Only the
  // focused slot is interactive for USER input (onCropChange/onZoomChange gated on
  // `active`; inactive slots set pointer-events:none so a click falls through to
  // the cell and a stray wheel/drag can't nudge an unfocused slot). But
  // onCropComplete + onMediaLoaded are wired on EVERY populated slot: the cropper
  // re-emits the crop rect programmatically on each media load (proxy/original
  // toggle, flip reload) BEFORE onMediaLoaded fires, and recording both keeps the
  // stored (croppedAreaPixels, mediaSize) pair in the same pixel space — gating
  // them on `active` would strand inactive slots' rects in the previous media
  // space. Because the cropper container is absolutely positioned, slot content
  // never participates in layout — the cell stays locked to its view's aspect box
  // and can't reflow when framing changes.
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
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          zoomSpeed={ZOOM_SPEED}
          // Scroll-zoom is owned by SlotGrid's grid-level wheel handler so the
          // SELECTED slot zooms reliably anywhere over its cell (the cropper's own
          // listener only fires over the crop area, leaving dead zones that let the
          // page scroll instead). Disable the built-in one to avoid double-zoom.
          zoomWithScroll={false}
          showGrid={false}
          objectFit="cover"
          onCropChange={active ? onCropChange : noop}
          onZoomChange={active ? onZoomChange : undefined}
          onCropComplete={(_area: Area, areaPixels: Area) => onCropComplete(areaPixels as CropArea)}
          onMediaLoaded={(ms: MediaSize) => onMediaLoaded({ width: ms.naturalWidth, height: ms.naturalHeight })}
          style={{
            // The cell's own border frames the crop; hide the cropper's internal
            // outline. Inactive slots are non-interactive (clicks reach the cell).
            cropAreaStyle: { border: 0, boxShadow: 'none' },
            ...(active ? {} : { containerStyle: { pointerEvents: 'none' } }),
          }}
        />
      )}
      {mediaUrl && <GridLines view={slot.view} />}
    </div>
  );
};

export default SlotCanvas;
