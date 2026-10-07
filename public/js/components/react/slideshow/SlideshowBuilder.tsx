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
 *  - Grip-drag a timeline chip → reorder, or drop onto another chip to pair. The grip
 *    is also a button: ←/→ move the slide (FE-F15-9c).
 *  - ✕ removes that instance; the link-slash splits a pair back into two.
 *
 * Tiles, chips and the drag ghost show THUMBNAILS (`thumbUrl`); only the player loads
 * the full photos. Opening four sessions used to download ~70 MB of full renders
 * before anything played (FE-F15-10).
 */
import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import cn from 'classnames';
import { useFloatingMenu } from '@/hooks/useFloatingMenu';
import { formatSessionDate } from './configResolver';
import { photoId, slidePhotos, slidePhotoCount, MAX_PHOTOS_PER_SLIDE } from './photoTypes';
import SaveConfigModal from './SaveConfigModal';
import ManageConfigsModal from './ManageConfigsModal';
import FolderPickerModal from './FolderPickerModal';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import type { ConfigPayload, ConfigRow } from '@shared/contracts/slideshow.contract';
import styles from './SlideshowBuilder.module.css';

/** A session's gallery read, as the page reports it. */
export type GalleryStatus = 'loading' | 'error' | 'ready';

interface Props {
  personId: number;
  timepoints: Timepoint[];
  loadingTimepoints: boolean;
  /** Palette photos per OPENED session. */
  galleries: Record<string, SlidePhoto[]>;
  galleryStatus: Record<string, GalleryStatus>;
  /** A session was opened: the page reads its gallery. */
  onOpenSession: (tp: string) => void;
  selected: SlideItem[];
  configs: ConfigRow[];
  onAdd: (photo: SlidePhoto) => void;
  onInsertAt: (photo: SlidePhoto, index: number) => void;
  onPairPhotoOnto: (targetIndex: number, photo: SlidePhoto) => void;
  onReorder: (from: number, to: number) => void;
  onPairSlides: (fromIndex: number, toIndex: number) => void;
  onRemove: (uid: string) => void;
  onUnpair: (index: number) => void;
  onClear: () => void;
  onPlay: () => void;
  onApplyConfig: (row: ConfigRow) => void;
  onSaveConfig: (name: string, config: ConfigPayload) => Promise<void>;
  onRenameConfig: (id: number, name: string) => Promise<void>;
  onDeleteConfig: (id: number) => Promise<void>;
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

/** The small image for a tile, chip or ghost. */
const thumbOf = (p: SlidePhoto): string => (p.missing ? PLACEHOLDER : (p.thumbUrl ?? p.url));

interface ApplyMenuProps {
  anchor: { x: number; y: number };
  patientConfigs: ConfigRow[];
  templates: ConfigRow[];
  onPick: (row: ConfigRow) => void;
  onClose: () => void;
}

/**
 * The *Apply* menu: focus moves in on open, ↑/↓ move, Escape closes and returns focus
 * to the button — the shared `useFloatingMenu` (FE-F15-9d; it had none of these).
 */
const ApplyMenu = ({ anchor, patientConfigs, templates, onPick, onClose }: ApplyMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { position, onKeyDown } = useFloatingMenu(ref, anchor, onClose);
  return (
    <div
      ref={ref}
      className={styles.applyMenu}
      role="menu"
      tabIndex={-1}
      aria-label="Apply a saved presentation"
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
    >
      {patientConfigs.length > 0 && (
        <div className={styles.applyGroup} role="group" aria-label="This patient">
          <div className={styles.applyGroupLabel}>This patient</div>
          {patientConfigs.map((c) => (
            <button key={c.id} type="button" role="menuitem" className={styles.applyItem} onClick={() => onPick(c)}>
              <i className="fas fa-clock-rotate-left" aria-hidden="true" />
              <span className={styles.applyItemName}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
      {templates.length > 0 && (
        <div className={styles.applyGroup} role="group" aria-label="Generic templates">
          <div className={styles.applyGroupLabel}>Generic templates</div>
          {templates.map((c) => (
            <button key={c.id} type="button" role="menuitem" className={styles.applyItem} onClick={() => onPick(c)}>
              <i className="fas fa-wand-magic-sparkles" aria-hidden="true" />
              <span className={styles.applyItemName}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SlideshowBuilder = ({
  personId,
  timepoints,
  loadingTimepoints,
  galleries,
  galleryStatus,
  onOpenSession,
  selected,
  configs,
  onAdd,
  onInsertAt,
  onPairPhotoOnto,
  onReorder,
  onPairSlides,
  onRemove,
  onUnpair,
  onClear,
  onPlay,
  onApplyConfig,
  onSaveConfig,
  onRenameConfig,
  onDeleteConfig,
}: Props) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // --- Config bar (saved presentations + folder photos) ---
  const [applyAnchor, setApplyAnchor] = useState<{ x: number; y: number } | null>(null);
  const applyOpen = applyAnchor !== null;
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const patientConfigs = configs.filter((c) => c.kind === 'literal' && c.person_id === personId);
  const templates = configs.filter((c) => c.kind === 'template');

  const applyAndClose = (row: ConfigRow): void => {
    setApplyAnchor(null);
    onApplyConfig(row);
  };

  const trayScrollRef = useRef<HTMLDivElement>(null);
  // Authoritative live drag data for the window pointer handlers.
  const dragRef = useRef<{ pointerId: number; source: DragSource; drop: DropZone | null; abort: AbortController } | null>(
    null,
  );
  const [drag, setDrag] = useState<DragView | null>(null);
  // True after a gallery drag/scroll begins, so the trailing click doesn't add.
  const suppressClickRef = useRef(false);

  // How many times this photo appears in the timeline (across every slide's photos).
  const usedCount = (photo: SlidePhoto): number => {
    const pid = photoId(photo);
    return selected.reduce((n, s) => n + slidePhotos(s).filter((p) => photoId(p) === pid).length, 0);
  };
  const usesFromTp = (tp: string): number =>
    selected.reduce((n, s) => n + slidePhotos(s).filter((p) => p.tp === tp).length, 0);

  const toggleExpand = (tp: Timepoint) => {
    const willExpand = !expanded.has(tp.tp_code);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(tp.tp_code);
      else next.delete(tp.tp_code);
      return next;
    });
    if (willExpand) onOpenSession(tp.tp_code);
  };

  // ←/→ on a focused grip move its slide — the keyboard twin of grip-dragging.
  const onGripKeyDown = (e: ReactKeyboardEvent, index: number) => {
    const to = e.key === 'ArrowLeft' ? index - 1 : e.key === 'ArrowRight' ? index + 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to >= 0 && to < selected.length) onReorder(index, to);
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
      if (!target || slidePhotoCount(target) >= MAX_PHOTOS_PER_SLIDE) return false; // target must have room
      if (source.kind === 'chip') {
        if (source.fromIndex === i) return false; // not onto itself
        if (source.isPair) return false; // a multi-photo slide can't be a right-hand photo
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
    beginDrag(
      { kind: 'chip', fromIndex: index, isPair: slidePhotoCount(item) > 1 },
      e.clientX,
      e.clientY,
      thumbOf(item),
      e.pointerId,
    );
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
      beginDrag({ kind: 'gallery', photo }, x, y, thumbOf(photo), pointerId);
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
        <div className={styles.headerMain}>
          <h2 className={styles.title}>Presentation Builder</h2>
          <p className={styles.hint}>
            Tap a photo to add it, drag it onto the timeline to place it, or drop one photo over another to pair them.
          </p>
        </div>
        <div className={styles.configBar}>
          <div className={styles.applyWrap}>
            <button
              type="button"
              className={styles.configBtn}
              disabled={configs.length === 0}
              aria-haspopup="menu"
              aria-expanded={applyOpen}
              onClick={(e) => {
                if (applyOpen) {
                  setApplyAnchor(null);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                setApplyAnchor({ x: r.left, y: r.bottom + 4 });
              }}
            >
              <i className="fas fa-folder-open" aria-hidden="true" /> Apply{' '}
              <i className={cn('fas fa-caret-down', styles.caret)} aria-hidden="true" />
            </button>
            {applyAnchor && (
              <ApplyMenu
                anchor={applyAnchor}
                patientConfigs={patientConfigs}
                templates={templates}
                onPick={applyAndClose}
                onClose={() => setApplyAnchor(null)}
              />
            )}
          </div>
          <button type="button" className={styles.configBtn} disabled={selected.length === 0} onClick={() => setSaveOpen(true)}>
            <i className="fas fa-floppy-disk" aria-hidden="true" /> Save
          </button>
          <button type="button" className={styles.configBtn} disabled={configs.length === 0} onClick={() => setManageOpen(true)}>
            <i className="fas fa-sliders" aria-hidden="true" /> Manage
          </button>
          <button type="button" className={styles.configBtn} onClick={() => setFolderOpen(true)}>
            <i className="fas fa-images" aria-hidden="true" /> Add from folder
          </button>
        </div>
      </header>

      <div className={styles.sessions}>
        {loadingTimepoints ? (
          <div className={styles.state}>
            <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Loading photo sessions…
          </div>
        ) : timepoints.length === 0 ? (
          <div className={styles.state}>
            <i className="fas fa-info-circle" aria-hidden="true" /> No photo sessions yet.
          </div>
        ) : (
          timepoints.map((tp) => {
            const isOpen = expanded.has(tp.tp_code);
            const items = galleries[tp.tp_code] ?? [];
            const status = galleryStatus[tp.tp_code] ?? 'loading';
            const count = usesFromTp(tp.tp_code);
            return (
              <section key={tp.tp_code} className={styles.session}>
                <button
                  type="button"
                  className={styles.sessionHeader}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(tp)}
                >
                  <i className={cn('fas', isOpen ? 'fa-chevron-down' : 'fa-chevron-right', styles.chevron)} aria-hidden="true" />
                  <span className={styles.sessionName}>{tp.tp_description || `Timepoint ${tp.tp_code}`}</span>
                  <span className={styles.sessionDate}>{formatSessionDate(tp.tp_date_time)}</span>
                  {count > 0 && <span className={styles.sessionBadge}>{count} added</span>}
                </button>

                {isOpen && (
                  <div className={styles.grid}>
                    {status === 'loading' ? (
                      <div className={styles.state}>
                        <i className="fas fa-spinner fa-spin" aria-hidden="true" /> Loading…
                      </div>
                    ) : status === 'error' ? (
                      <div className={styles.state}>
                        <i className="fas fa-exclamation-triangle" aria-hidden="true" /> Couldn’t load photos.
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
                              src={thumbOf(photo)}
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
              const photos = slidePhotos(item);
              const paired = photos.length > 1;
              const isSource = drag?.kind === 'chip' && drag.fromIndex === index;
              const insertBefore = drag?.drop?.type === 'insert' && drag.drop.index === index;
              const insertAfter =
                drag?.drop?.type === 'insert' &&
                drag.drop.index === selected.length &&
                index === selected.length - 1;
              const pairTarget = drag?.drop?.type === 'pair' && drag.drop.index === index;
              const missing = photos.some((p) => p.missing);
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
                    missing && styles.chipMissing,
                  )}
                  title={missing ? 'A photo on this slide no longer exists — it will be skipped' : undefined}
                >
                  <button
                    type="button"
                    className={styles.chipGrip}
                    title="Drag to reorder, or onto another photo to pair · ←/→ to move"
                    aria-label={`Slide ${index + 1}: ${photos.map((p) => p.label).join(' + ')}. Use left and right arrows to move it`}
                    onPointerDown={(e) => onGripPointerDown(e, index)}
                    onKeyDown={(e) => onGripKeyDown(e, index)}
                  >
                    <i className="fas fa-grip-vertical" aria-hidden="true" />
                  </button>
                  {photos.map((photo, i) => (
                    <img
                      key={`${photoId(photo)}-${i}`}
                      src={thumbOf(photo)}
                      alt={photo.label}
                      draggable={false}
                      onError={handleImgError}
                    />
                  ))}
                  <span className={styles.chipOrder}>{index + 1}</span>
                  {paired && (
                    <button
                      type="button"
                      className={styles.chipUnlink}
                      title="Split into separate slides"
                      aria-label="Split combined photos"
                      onClick={() => onUnpair(index)}
                    >
                      <i className="fas fa-link-slash" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    title="Remove"
                    aria-label={`Remove ${item.label}`}
                    onClick={() => onRemove(item.uid)}
                  >
                    <i className="fas fa-times" aria-hidden="true" />
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
            <i className="fas fa-play" aria-hidden="true" /> Play{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>

      {drag && (
        <div className={styles.ghost} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <img src={drag.url} alt="" draggable={false} onError={handleImgError} />
        </div>
      )}

      {saveOpen && (
        <SaveConfigModal
          selected={selected}
          sessions={timepoints}
          onSave={onSaveConfig}
          onClose={() => setSaveOpen(false)}
        />
      )}
      {manageOpen && (
        <ManageConfigsModal
          personId={personId}
          configs={configs}
          onRename={onRenameConfig}
          onDelete={onDeleteConfig}
          onClose={() => setManageOpen(false)}
        />
      )}
      {folderOpen && <FolderPickerModal personId={personId} onAdd={onAdd} onClose={() => setFolderOpen(false)} />}
    </div>
  );
};

export default SlideshowBuilder;
