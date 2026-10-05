/**
 * Fullscreen viewer for a set's portal photos, with prev/next across the set.
 *
 * Rendered through the shared `<Modal>` (portal, focus trap, scroll lock, the
 * stack-aware Escape, backdrop dismiss). It used to be a hand-rolled fixed
 * overlay inside `PatientSets`: a click handler on a `role="dialog"` div (the
 * tree's last four lint warnings, audit FE-F0-4), no focus trap, and a
 * window-level Escape listener outside the modal stack.
 *
 * The photo zooms with the mouse wheel (toward the cursor), pans by dragging
 * once zoomed, and double-click toggles zoom. The zoom lives inside the photo's
 * frame, so a zoomed photo never covers the caption or the close/prev/next
 * buttons, and it starts over on every photo (`key` remount).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import Modal from '../../components/react/Modal';
import type { AlignerPhoto } from './aligner.types';
import styles from './AlignerPhotoViewer.module.css';

interface AlignerPhotoViewerProps {
    photos: AlignerPhoto[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
    formatDate: (value: string | null | undefined) => string;
}

const AlignerPhotoViewer = ({ photos, index, onIndexChange, onClose, formatDate }: AlignerPhotoViewerProps) => {
    const photo = photos[index];
    const hasPrev = index > 0;
    const hasNext = index < photos.length - 1;
    const titleId = 'aligner-photo-viewer-title';

    // ←/→ step through the set. Escape is Modal's (top of the stack only).
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
            else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [index, hasPrev, hasNext, onIndexChange]);

    if (!photo) return null;

    return (
        <Modal
            isOpen
            onClose={onClose}
            overlayClassName={styles.overlay}
            contentClassName={styles.content}
            ariaLabelledBy={titleId}
            draggable={false}
        >
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close viewer">
                <i className="fas fa-times" aria-hidden="true"></i>
            </button>
            {photos.length > 1 && (
                <button
                    type="button"
                    className={`${styles.nav} ${styles.prev}`}
                    onClick={() => onIndexChange(index - 1)}
                    disabled={!hasPrev}
                    title="Previous photo"
                    aria-label="Previous photo"
                >
                    <i className="fas fa-chevron-left" aria-hidden="true"></i>
                </button>
            )}
            <ZoomableImage key={photo.path} src={photo.view_url} alt={photo.file_name} />
            <div className={styles.details}>
                <div id={titleId} className={styles.filename}>{photo.file_name}</div>
                {photo.uploaded_at && (
                    <div className={styles.meta}>Uploaded: {formatDate(photo.uploaded_at)}</div>
                )}
                {photos.length > 1 && (
                    <div className={styles.counter}>{index + 1} / {photos.length}</div>
                )}
                <div className={styles.hint}>Scroll to zoom · drag to move · double-click to reset</div>
            </div>
            {photos.length > 1 && (
                <button
                    type="button"
                    className={`${styles.nav} ${styles.next}`}
                    onClick={() => onIndexChange(index + 1)}
                    disabled={!hasNext}
                    title="Next photo"
                    aria-label="Next photo"
                >
                    <i className="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
            )}
        </Modal>
    );
};

// ============================================================================
// Wheel zoom
// ============================================================================

const MAX_SCALE = 8;
/** What one double-click on an un-zoomed photo jumps to. */
const DOUBLE_CLICK_SCALE = 2.5;
/**
 * Zoom per pixel of wheel travel. A mouse notch is ~100px in Chromium, so ≈1.2×
 * per notch; a trackpad pinch arrives as small ctrl+wheel deltas and needs more.
 */
const WHEEL_SENSITIVITY = 0.002;
const PINCH_SENSITIVITY = 0.01;

/** `translate(x, y) scale(scale)` about the photo's centre; x/y in screen px. */
interface Zoom {
    scale: number;
    x: number;
    y: number;
}

const UNZOOMED: Zoom = { scale: 1, x: 0, y: 0 };

/**
 * Keep the photo covering its own frame: at scale s it can slide at most
 * (s − 1)·size/2 either way before an edge comes into view. `w`/`h` are the
 * photo's un-zoomed layout size.
 */
function clampPan(zoom: Zoom, w: number, h: number): Zoom {
    const maxX = ((zoom.scale - 1) * w) / 2;
    const maxY = ((zoom.scale - 1) * h) / 2;
    return {
        scale: zoom.scale,
        x: Math.min(maxX, Math.max(-maxX, zoom.x)),
        y: Math.min(maxY, Math.max(-maxY, zoom.y)),
    };
}

/**
 * Rescale so the photo point under the cursor stays under it. `px`/`py` is the
 * cursor relative to the frame's centre (= the un-zoomed photo's centre): that
 * point sits at u = (p − t)/s in the photo, so the new offset is p − s′·u.
 */
function zoomAt(zoom: Zoom, nextScale: number, px: number, py: number, w: number, h: number): Zoom {
    const scale = Math.min(MAX_SCALE, Math.max(1, nextScale));
    // Snap home rather than leave a 1.0003× residue after zooming back out.
    if (scale < 1.01) return UNZOOMED;
    const ratio = scale / zoom.scale;
    return clampPan({ scale, x: px - ratio * (px - zoom.x), y: py - ratio * (py - zoom.y) }, w, h);
}

interface ZoomableImageProps {
    src: string;
    alt: string;
}

function ZoomableImage({ src, alt }: ZoomableImageProps) {
    const stageRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; fromX: number; fromY: number } | null>(null);
    const [zoom, setZoom] = useState<Zoom>(UNZOOMED);
    const [dragging, setDragging] = useState(false);
    const zoomed = zoom.scale > 1;

    // The wheel listener is native and non-passive: React attaches `onWheel`
    // passively, and without preventDefault the wheel would also scroll whatever
    // sits under the modal's scroll lock.
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const handleWheel = (e: WheelEvent) => {
            const image = imageRef.current;
            if (!image) return;
            e.preventDefault();
            const rect = stage.getBoundingClientRect();
            const px = e.clientX - (rect.left + rect.width / 2);
            const py = e.clientY - (rect.top + rect.height / 2);
            const pixels =
                e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16
                    : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * rect.height
                        : e.deltaY;
            const factor = Math.exp(-pixels * (e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY));
            const { offsetWidth: w, offsetHeight: h } = image;
            setZoom((z) => zoomAt(z, z.scale * factor, px, py, w, h));
        };
        stage.addEventListener('wheel', handleWheel, { passive: false });
        return () => stage.removeEventListener('wheel', handleWheel);
    }, []);

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!zoomed || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, fromX: zoom.x, fromY: zoom.y };
        setDragging(true);
    };

    const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const image = imageRef.current;
        if (!drag || drag.pointerId !== e.pointerId || !image) return;
        const x = drag.fromX + e.clientX - drag.startX;
        const y = drag.fromY + e.clientY - drag.startY;
        setZoom((z) => clampPan({ scale: z.scale, x, y }, image.offsetWidth, image.offsetHeight));
    };

    const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== e.pointerId) return;
        dragRef.current = null;
        setDragging(false);
    };

    const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
        const image = imageRef.current;
        if (!image) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - (rect.left + rect.width / 2);
        const py = e.clientY - (rect.top + rect.height / 2);
        const { offsetWidth: w, offsetHeight: h } = image;
        setZoom((z) => (z.scale > 1 ? UNZOOMED : zoomAt(z, DOUBLE_CLICK_SCALE, px, py, w, h)));
    };

    const stageClass = [styles.stage, zoomed && styles.zoomed, dragging && styles.dragging].filter(Boolean).join(' ');

    return (
        <div className={styles.frame}>
            <div
                ref={stageRef}
                className={stageClass}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={handleDoubleClick}
            >
                <img
                    ref={imageRef}
                    src={src}
                    alt={alt}
                    className={styles.image}
                    draggable={false}
                    style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
                />
            </div>
            {zoomed && (
                <div className={styles.zoomBar}>
                    <span>{Math.round(zoom.scale * 100)}%</span>
                    <button type="button" className={styles.zoomReset} onClick={() => setZoom(UNZOOMED)}>
                        <i className="fas fa-compress" aria-hidden="true"></i> Reset
                    </button>
                </div>
            )}
        </div>
    );
}

export default AlignerPhotoViewer;
