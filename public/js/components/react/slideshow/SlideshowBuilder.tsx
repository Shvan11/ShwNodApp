/**
 * SlideshowBuilder — pick photos across timepoints and arrange the play order.
 *
 * Left/main: collapsible timepoint sections, each lazy-loading its gallery of
 * palette photos. Bottom: the sticky **timeline** tray — the sole source of truth
 * for sequence and what's included (the same photo may appear more than once).
 *
 * Interactions (all pointer-based, touch-first):
 *  - Tap a gallery photo → append a copy to the timeline.
 *  - Long-press (touch) / click-drag (mouse) a gallery photo → drop into the
 *    timeline at a position, or onto a chip to pair them side-by-side.
 *  - Grip-drag a timeline chip → reorder, or drop onto another chip to pair.
 *  - ✕ removes that instance; the link-slash splits a pair back into two.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import cn from 'classnames';
import { useToast } from '../../../contexts/ToastContext';
import { httpErrorMessage } from '../../../core/http';
import { photoId } from './photoTypes';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import styles from './SlideshowBuilder.module.css';

interface Props {
  timepoints: Timepoint[];
  loadingTimepoints: boolean;
  galleries: Record<string, SlidePhoto[]>;
  loadGallery: (tp: Timepoint) => Promise<SlidePhoto[]>;
  selected: SlideItem[];
  onAdd: (photo: SlidePhoto) => void;
  onInsertAt: (photo: SlidePhoto, index: number) => void;
  onPairPhotoOnto: (targetIndex: number, photo: SlidePhoto) => void;
  onReorder: (from: number, to: number) => void;
  onPairSlides: (fromIndex: number, toIndex: number) => void;
  onRemove: (uid: string) => void;
  onUnpair: (index: number) => void;
  onClear: () => void;
  onPlay: () => void;
}

/** What's being dragged: a palette photo, or an existing timeline slide. */
type DragSource =
  | { kind: 'gallery'; photo: SlidePhoto }
  | { kind: 'chip'; fromIndex: number; isPair: boolean };

/** Where it would land: a gap (insert at index) or onto a chip (pair). */
type DropZone = { type: 'insert'; index: number } | { type: 'pair'; index: number };

/** Render-facing drag state (drives the floating ghost + drop indicators). */
interface DragView {
  kind: 'gallery' | 'chip';
  fromIndex: number | null; // chip source index, so we can dim it
  url: string; // ghost image
  x: number;
  y: number;
  drop: DropZone | null;
}

const PLACEHOLDER = '/images/placeholder.svg';
const LONG_PRESS_MS = 220; // touch hold before a gallery photo becomes draggable
const MOVE_THRESHOLD = 10; // px of travel that distinguishes a drag/scroll from a tap

const formatTpDate = (dateTime: string): string =>
  dateTime ? dateTime.substring(0, 10).split('-').reverse().join('-') : '';

const SlideshowBuilder = ({
  timepoints,
  loadingTimepoints,
  galleries,
  loadGallery,
  selected,
  onAdd,
  onInsertAt,
  onPairPhotoOnto,
  onReorder,
  onPairSlides,
  onRemove,
  onUnpair,
  onClear,
  onPlay,
}: Props) => {
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tpLoading, setTpLoading] = useState<Record<string, boolean>>({});
  const [tpError, setTpError] = useState<Record<string, boolean>>({});

  const trayScrollRef = useRef<HTMLDivElement>(null);
  // Authoritative live drag data for the window pointer handlers.
  const dragRef = useRef<{ pointerId: number; source: DragSource; drop: DropZone | null; abort: AbortController } | null>(
    null,
  );
  const [drag, setDrag] = useState<DragView | null>(null);
  // True after a gallery drag/scroll begins, so the trailing click doesn't add.
  const suppressClickRef = useRef(false);

  // How many times this photo appears in the timeline (as primary or paired second).
  const usedCount = (photo: SlidePhoto): number => {
    const pid = photoId(photo);
    return selected.reduce(
      (n, s) => n + (photoId(s) === pid ? 1 : 0) + (s.second && photoId(s.second) === pid ? 1 : 0),
      0,
    );
  };
  const usesFromTp = (tp: string): number =>
    selected.reduce((n, s) => n + (s.tp === tp ? 1 : 0) + (s.second?.tp === tp ? 1 : 0), 0);

  const toggleExpand = async (tp: Timepoint) => {
    const willExpand = !expanded.has(tp.tpCode);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(tp.tpCode);
      else next.delete(tp.tpCode);
      return next;
    });
    if (willExpand && !galleries[tp.tpCode] && !tpLoading[tp.tpCode]) {
      setTpLoading((p) => ({ ...p, [tp.tpCode]: true }));
      try {
        await loadGallery(tp);
        setTpError((p) => ({ ...p, [tp.tpCode]: false }));
      } catch (err) {
        setTpError((p) => ({ ...p, [tp.tpCode]: true }));
        toast.error(httpErrorMessage(err, 'Failed to load photos for this session'));
      } finally {
        setTpLoading((p) => ({ ...p, [tp.tpCode]: false }));
      }
    }
  };

  // --- Drop-zone hit testing (live, against the current chip layout) ---
  const computeDrop = (clientX: number, clientY: number, source: DragSource, snapshot: SlideItem[]): DropZone | null => {
    const scroll = trayScrollRef.current;
    if (!scroll) return null;
    const rect = scroll.getBoundingClientRect();
    const NEAR = 80; // vertical slack so you don't have to land dead-center on the strip
    if (clientY < rect.top - NEAR || clientY > rect.bottom + NEAR) return null;

    const chips = Array.from(scroll.querySelectorAll<HTMLElement>('[data-chip]'));
    if (chips.length === 0) return { type: 'insert', index: 0 };

    const canPair = (i: number): boolean => {
      const target = snapshot[i];
      if (!target || target.second) return false; // target slide must be single
      if (source.kind === 'chip') {
        if (source.fromIndex === i) return false; // not onto itself
        if (source.isPair) return false; // a pair can't be a right-hand photo
      }
      return true;
    };

    // Pointer within a chip → middle band pairs, edges insert before/after.
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        const rel = (clientX - r.left) / r.width;
        if (canPair(i) && rel > 0.28 && rel < 0.72) return { type: 'pair', index: i };
        return { type: 'insert', index: rel < 0.5 ? i : i + 1 };
      }
    }
    // In a gap / past the ends → nearest insertion slot by chip centers.
    let index = chips.length;
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    return { type: 'insert', index };
  };

  // --- Unified pointer-drag controller (gallery photo OR timeline chip) ---
  const beginDrag = (source: DragSource, x: number, y: number, url: string, pointerId: number) => {
    const snapshot = selected; // constant for the life of one drag
    const abort = new AbortController();
    dragRef.current = { pointerId, source, drop: null, abort };
    setDrag({ kind: source.kind, fromIndex: source.kind === 'chip' ? source.fromIndex : null, url, x, y, drop: null });

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const drop = computeDrop(ev.clientX, ev.clientY, source, snapshot);
      d.drop = drop;
      setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY, drop } : prev));
    };
    const finish = (commit: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      const { source: src, drop } = d;
      d.abort.abort();
      dragRef.current = null;
      setDrag(null);
      if (commit) dispatchDrop(src, drop);
    };
    const onUp = (ev: PointerEvent) => {
      if (dragRef.current && ev.pointerId === dragRef.current.pointerId) finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (dragRef.current && ev.pointerId === dragRef.current.pointerId) finish(false);
    };
    // Stop the page/tray from scrolling under the finger while a drag is live.
    const preventTouch = (ev: TouchEvent) => ev.preventDefault();

    window.addEventListener('pointermove', onMove, { signal: abort.signal });
    window.addEventListener('pointerup', onUp, { signal: abort.signal });
    window.addEventListener('pointercancel', onCancel, { signal: abort.signal });
    document.addEventListener('touchmove', preventTouch, { passive: false, signal: abort.signal });
  };

  const dispatchDrop = (source: DragSource, drop: DropZone | null) => {
    if (!drop) return;
    if (source.kind === 'gallery') {
      if (drop.type === 'pair') onPairPhotoOnto(drop.index, source.photo);
      else onInsertAt(source.photo, drop.index);
      return;
    }
    const from = source.fromIndex;
    if (drop.type === 'pair') {
      onPairSlides(from, drop.index);
    } else {
      // Removing the dragged slide shifts later indices left by one.
      const to = drop.index > from ? drop.index - 1 : drop.index;
      onReorder(from, to);
    }
  };

  // Chip grip: start a drag immediately (the grip owns the gesture, touch-action: none).
  const onGripPointerDown = (e: ReactPointerEvent, index: number) => {
    if (dragRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const item = selected[index];
    beginDrag({ kind: 'chip', fromIndex: index, isPair: !!item.second }, e.clientX, e.clientY, item.url, e.pointerId);
  };

  // Gallery thumb: tap → add (via onClick); long-press / mouse-move → drag.
  const onThumbPointerDown = (e: ReactPointerEvent, photo: SlidePhoto) => {
    if (dragRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClickRef.current = false; // fresh interaction
    const pointerId = e.pointerId;
    const pointerType = e.pointerType;
    const start = { x: e.clientX, y: e.clientY };
    const abort = new AbortController();
    let started = false;

    const launch = (x: number, y: number) => {
      started = true;
      suppressClickRef.current = true; // a drag began → don't let the click add
      abort.abort(); // hand off to beginDrag's own listeners
      beginDrag({ kind: 'gallery', photo }, x, y, photo.url, pointerId);
    };
    const timer = window.setTimeout(() => {
      if (!started) launch(start.x, start.y);
    }, LONG_PRESS_MS);

    const onMove = (ev: PointerEvent) => {
      if (started || ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= MOVE_THRESHOLD) return;
      window.clearTimeout(timer);
      if (pointerType === 'mouse') {
        launch(ev.clientX, ev.clientY); // mouse move = intent to drag
      } else {
        // touch/pen moved before the hold → it's a scroll; bail and let it scroll.
        suppressClickRef.current = true;
        abort.abort();
      }
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.clearTimeout(timer);
      abort.abort();
    };
    window.addEventListener('pointermove', onMove, { signal: abort.signal });
    window.addEventListener('pointerup', onEnd, { signal: abort.signal });
    window.addEventListener('pointercancel', onEnd, { signal: abort.signal });
  };

  const onThumbClick = (photo: SlidePhoto) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onAdd(photo);
  };

  const handleImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.src.endsWith(PLACEHOLDER)) return;
    e.currentTarget.src = PLACEHOLDER;
  };

  return (
    <div className={cn(styles.builder, drag && styles.dragging)}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Presentation Builder</h2>
          <p className={styles.hint}>
            Tap a photo to add it, drag it onto the timeline to place it, or drop one photo over another to pair them.
          </p>
        </div>
      </header>

      <div className={styles.sessions}>
        {loadingTimepoints ? (
          <div className={styles.state}>
            <i className="fas fa-spinner fa-spin" /> Loading photo sessions…
          </div>
        ) : timepoints.length === 0 ? (
          <div className={styles.state}>
            <i className="fas fa-info-circle" /> No photo sessions yet.
          </div>
        ) : (
          timepoints.map((tp) => {
            const isOpen = expanded.has(tp.tpCode);
            const items = galleries[tp.tpCode] ?? [];
            const count = usesFromTp(tp.tpCode);
            return (
              <section key={tp.tpCode} className={styles.session}>
                <button
                  type="button"
                  className={styles.sessionHeader}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(tp)}
                >
                  <i className={cn('fas', isOpen ? 'fa-chevron-down' : 'fa-chevron-right', styles.chevron)} />
                  <span className={styles.sessionName}>{tp.tpDescription || `Timepoint ${tp.tpCode}`}</span>
                  <span className={styles.sessionDate}>{formatTpDate(tp.tpDateTime)}</span>
                  {count > 0 && <span className={styles.sessionBadge}>{count} added</span>}
                </button>

                {isOpen && (
                  <div className={styles.grid}>
                    {tpLoading[tp.tpCode] ? (
                      <div className={styles.state}>
                        <i className="fas fa-spinner fa-spin" /> Loading…
                      </div>
                    ) : tpError[tp.tpCode] ? (
                      <div className={styles.state}>
                        <i className="fas fa-exclamation-triangle" /> Couldn’t load photos.
                      </div>
                    ) : items.length === 0 ? (
                      <div className={styles.state}>No photos in this session.</div>
                    ) : (
                      items.map((photo) => {
                        const used = usedCount(photo);
                        return (
                          <button
                            type="button"
                            key={photoId(photo)}
                            className={cn(styles.thumb, used > 0 && styles.thumbUsed)}
                            onClick={() => onThumbClick(photo)}
                            onPointerDown={(e) => onThumbPointerDown(e, photo)}
                            title={used > 0 ? `In the timeline ${used}×` : 'Tap to add · drag to place'}
                          >
                            <img
                              src={photo.url}
                              alt={photo.label}
                              loading="lazy"
                              draggable={false}
                              onError={handleImgError}
                            />
                            <span className={styles.thumbLabel}>{photo.label}</span>
                            {used > 0 && <span className={styles.countBadge}>×{used}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      <div className={styles.tray}>
        <div className={cn(styles.trayScroll, drag?.drop && styles.trayDropping)} ref={trayScrollRef}>
          {selected.length === 0 ? (
            <span className={styles.trayEmpty}>
              {drag ? 'Drop here to add the first photo.' : 'No photos in the timeline yet.'}
            </span>
          ) : (
            selected.map((item, index) => {
              const paired = !!item.second;
              const isSource = drag?.kind === 'chip' && drag.fromIndex === index;
              const insertBefore = drag?.drop?.type === 'insert' && drag.drop.index === index;
              const insertAfter =
                drag?.drop?.type === 'insert' &&
                drag.drop.index === selected.length &&
                index === selected.length - 1;
              const pairTarget = drag?.drop?.type === 'pair' && drag.drop.index === index;
              return (
                <div
                  key={item.uid}
                  data-chip
                  className={cn(
                    styles.chip,
                    paired && styles.chipPaired,
                    isSource && styles.chipSource,
                    insertBefore && styles.insertBefore,
                    insertAfter && styles.insertAfter,
                    pairTarget && styles.chipPairTarget,
                  )}
                >
                  <span
                    className={styles.chipGrip}
                    title="Drag to reorder, or onto another photo to pair"
                    onPointerDown={(e) => onGripPointerDown(e, index)}
                  >
                    <i className="fas fa-grip-vertical" />
                  </span>
                  <img src={item.url} alt={item.label} draggable={false} onError={handleImgError} />
                  {item.second && (
                    <img
                      src={item.second.url}
                      alt={item.second.label}
                      draggable={false}
                      onError={handleImgError}
                    />
                  )}
                  <span className={styles.chipOrder}>{index + 1}</span>
                  {paired && (
                    <button
                      type="button"
                      className={styles.chipUnlink}
                      title="Split into two slides"
                      aria-label="Split paired photos"
                      onClick={() => onUnpair(index)}
                    >
                      <i className="fas fa-link-slash" />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    title="Remove"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => onRemove(item.uid)}
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.trayActions}>
          {selected.length > 0 && (
            <button type="button" className={styles.clearBtn} onClick={onClear}>
              Clear
            </button>
          )}
          <button
            type="button"
            className={styles.playBtn}
            disabled={selected.length === 0}
            onClick={onPlay}
          >
            <i className="fas fa-play" /> Play{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>

      {drag && (
        <div className={styles.ghost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <img src={drag.url} alt="" draggable={false} onError={handleImgError} />
        </div>
      )}
    </div>
  );
};

export default SlideshowBuilder;
