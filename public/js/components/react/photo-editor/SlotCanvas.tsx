/**
 * One photo slot. EVERY populated slot mounts react-easy-crop against the source
 * (pre-flipped on a canvas when flipH/flipV is set, so the crop rect comes back in
 * the same flipped space the server extracts from) — so the cropper is the single
 * source of truth for framing and a slot looks identical whether or not it's
 * focused. Inactive slots render the same cropper non-interactively; empty slots
 * show a neutral placeholder.
 *
 * A recorded framing ("Continue editing", a reset) is applied by remounting the
 * cropper (`slot.framingKey`) with `initialCroppedAreaPercentages`, which react-easy-crop
 * honours on media load — through `CoverCropper` below, without which it lands on the
 * wrong frame. An optional ghost of the same view from another session lies on top
 * (pointer-events none) as an alignment guide.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, CropperProps, MediaSize, Point } from 'react-easy-crop';
import styles from './SlotCanvas.module.css';
import type { CropArea, FramingArea, PhotoViewCode, SlotState } from './photoEditorTypes';
import { aspectForView, gridLinesForView, labelForView, ZOOM_MIN, ZOOM_MAX, ZOOM_SPEED } from './photoEditorTypes';
import { buildContentUrl } from '../files/fileHelpers';

/**
 * react-easy-crop, with its cover fit settled BEFORE a media load is measured.
 *
 * The library (6.2.3, and 5.5.7 before it) keeps the resolved fit in state but only
 * writes it in componentDidUpdate, so the load of a freshly mounted cropper measures the
 * photo as `contain` — smaller than it is drawn — and applies
 * `initialCroppedAreaPercentages` in that space. One update later it corrects the fit and
 * rescales the pan, but never the zoom, and reports the frame from the pan it had before
 * the correction. On "Continue editing" that reopened a panned view off its saved
 * position, and a rotated one zoomed in as well (7° on a 3:2 photo in a wide slot: 113%
 * for a saved 105%), and marked both Unsaved untouched. A default framing (no pan, zoom
 * 1) is the same in both spaces, which is why placing a new photo never showed it.
 *
 * Reported upstream as ValentinH/react-easy-crop#667 (the fix there is one line in
 * `computeSizes`). Once a release carries it, this class can go — re-measure a Continue
 * of a panned + rotated view first.
 */
class CoverCropper extends Cropper {
  constructor(props: CropperProps) {
    super(props);
    const measure = this.onMediaLoad;
    this.onMediaLoad = () => {
      // With the photo loaded, getObjectFit() can tell which side covers the slot.
      const fit = this.getObjectFit();
      if (fit === this.state.mediaObjectFit) measure();
      else this.setState({ mediaObjectFit: fit }, measure);
    };
  }
}

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
  /** The frame in % of the flipped + rotated photo, and in its natural pixels — reported
   *  whenever it changes, whoever moved it (the user, a restore, a resize of the slot). */
  onFrameChange: (area: FramingArea, pixels: CropArea) => void;
  /** Natural (post-EXIF) dims of the loaded media — the space the crop rect lives in. */
  onMediaLoaded: (size: { width: number; height: number }) => void;
  /** Another session's saved photo of this view, drawn faintly over the slot to line
   *  the framing up with it. Null = no overlay. */
  overlayUrl?: string | null;
  overlayOpacity?: number;
}

/** The faint other-session photo over a slot. The slot box IS the view's frame, and a
 *  saved view is that frame, so stretching it to the box lines the two frames up. */
function Ghost({ url, opacity }: { url: string; opacity: number }): ReactElement {
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={styles.ghost}
      style={{ opacity }}
    />
  );
}

/**
 * The 2048 px proxy or the original, versioned by the listing's mtime: unversioned,
 * a different photo later uploaded under this name was framed from the browser's
 * cached copy of the old one while Save rendered the new one. 2048 must stay in the
 * thumbnail service's ALLOWED_WIDTHS.
 */
function contentUrl(personId: number, relPath: string, proxy: boolean, version: string | null): string {
  return buildContentUrl(personId, relPath, { thumb: proxy ? 2048 : undefined, v: version ?? undefined });
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

const SlotCanvas = ({
  personId,
  slot,
  active,
  proxyMode,
  onCropChange,
  onZoomChange,
  onFrameChange,
  onMediaLoaded,
  overlayUrl = null,
  overlayOpacity = 0.35,
}: Props) => {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const revoke = (): void => {
    if (urlRef.current?.startsWith('blob:')) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  // Every populated slot (active OR inactive) drives a cropper, so load the image —
  // flipped onto a blob when flipH/flipV is set — regardless of focus. Toggling
  // `active` no longer reloads the media, so focusing a slot can't flash its image.
  //
  // Resolve the media to one URL — null (no source), the plain content URL (no
  // flip), or a flipped blob URL (async) — through a single promise chain so every
  // setState lives in the `.then` callback rather than synchronously in the effect
  // body (react-hooks/set-state-in-effect), and blob revocation stays centralised.
  useEffect(() => {
    let cancelled = false;
    const base = slot.sourceRelPath ? contentUrl(personId, slot.sourceRelPath, proxyMode, slot.sourceVersion) : null;
    const load: Promise<string | null> =
      !base ? Promise.resolve(null)
      : (!slot.flipH && !slot.flipV) ? Promise.resolve(base)
      // Fall back to the unflipped preview if flipping fails (releases nothing —
      // makeFlippedUrl revokes its own partial blob on reject).
      : makeFlippedUrl(base, slot.flipH, slot.flipV).catch(() => base);

    load.then((url) => {
      if (cancelled) {
        // Discarded before commit — release the freshly-made blob (a plain base
        // URL or null is not a blob and needs no revoke).
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      revoke(); // release the previously-shown blob, if any
      urlRef.current = url;
      setMediaUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [personId, slot.sourceRelPath, slot.sourceVersion, slot.flipH, slot.flipV, proxyMode]);

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
          {overlayUrl && <Ghost url={overlayUrl} opacity={overlayOpacity} />}
          <GridLines view={slot.view} />
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        {/* A neutral mark: every empty slot used to show this clinic's logo (FE-F14-11). */}
        <i className={`fas fa-camera ${styles.emptyIcon}`} aria-hidden="true" />
        <span className={styles.emptyLabel}>{labelForView(slot.view)}</span>
      </div>
    );
  }

  // Active and inactive slots render the SAME controlled cropper, so framing is
  // pixel-identical whether or not the slot is focused — no reset on blur. Only the
  // focused slot takes USER input: an inactive one is closed to the pointer
  // (pointer-events:none, so a click falls through to the cell and a stray drag can't
  // nudge it) and to the keyboard (its crop area leaves the tab order, so the arrow
  // keys can't either). Every callback, though, is wired on EVERY populated slot,
  // because the cropper also moves things itself: it applies a recorded framing on
  // load, and it rescales the pan — held in CSS pixels — whenever the slot is resized
  // (window, sidebar divider, editor zoom). Those used to be dropped for an unselected
  // slot, whose photo then slid under its frame on every resize. Likewise the frame is
  // taken from onCropAreaChange, not onCropComplete: the library's own corrections
  // report "complete" from the pan they are about to replace, and only announce the
  // result as an area change. Recording frame + media size on each load keeps the stored
  // (croppedAreaPixels, mediaSize) pair in the same pixel space (proxy/original toggle,
  // flip reload). Because the cropper container is absolutely positioned, slot content
  // never participates in layout — the cell stays locked to its view's aspect box and
  // can't reflow when framing changes.
  return (
    <div className={styles.cropWrap}>
      {mediaUrl && (
        <CoverCropper
          key={slot.framingKey}
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
          initialCroppedAreaPercentages={slot.pendingFraming?.area}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onCropAreaChange={(area: Area, areaPixels: Area) => onFrameChange(area, areaPixels)}
          cropperProps={active ? undefined : { tabIndex: -1 }}
          onMediaLoaded={(ms: MediaSize) => onMediaLoaded({ width: ms.naturalWidth, height: ms.naturalHeight })}
          style={{
            // The cell's own border frames the crop; hide the cropper's internal
            // outline. Inactive slots are non-interactive (clicks reach the cell).
            cropAreaStyle: { border: 0, boxShadow: 'none' },
            ...(active ? {} : { containerStyle: { pointerEvents: 'none' } }),
          }}
        />
      )}
      {mediaUrl && overlayUrl && <Ghost url={overlayUrl} opacity={overlayOpacity} />}
      {mediaUrl && <GridLines view={slot.view} />}
    </div>
  );
};

export default SlotCanvas;
