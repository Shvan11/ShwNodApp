/**
 * SlideshowBuilder — pick photos across timepoints and arrange the play order.
 *
 * Left/main: collapsible timepoint sections, each lazy-loading its gallery.
 * Tapping a photo appends it to the sequence (tap order = initial order); tapping
 * again removes it. Bottom: a sticky sequence tray with pointer-drag reorder
 * (via a grip handle, so the tray itself can still scroll on touch).
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import cn from 'classnames';
import { useToast } from '../../../contexts/ToastContext';
import type { SlideItem, Timepoint } from './types';
import styles from './SlideshowBuilder.module.css';

interface Props {
  timepoints: Timepoint[];
  loadingTimepoints: boolean;
  galleries: Record<string, SlideItem[]>;
  loadGallery: (tp: Timepoint) => Promise<SlideItem[]>;
  selected: SlideItem[];
  onToggle: (item: SlideItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onReorder: (from: number, to: number) => void;
  onPlay: () => void;
}

interface TrayDrag {
  pointerId: number;
  fromIndex: number;
  startX: number;
  centers: number[];
  currentTarget: number;
  abort: AbortController;
}

const PLACEHOLDER = '/images/placeholder.svg';

const formatTpDate = (dateTime: string): string =>
  dateTime ? dateTime.substring(0, 10).split('-').reverse().join('-') : '';

const SlideshowBuilder = ({
  timepoints,
  loadingTimepoints,
  galleries,
  loadGallery,
  selected,
  onToggle,
  onRemove,
  onClear,
  onReorder,
  onPlay,
}: Props) => {
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tpLoading, setTpLoading] = useState<Record<string, boolean>>({});
  const [tpError, setTpError] = useState<Record<string, boolean>>({});

  const trayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TrayDrag | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const orderOf = (id: string): number => selected.findIndex((s) => s.id === id);
  const selectedCountFor = (tp: string): number => selected.filter((s) => s.tp === tp).length;

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
      } catch {
        setTpError((p) => ({ ...p, [tp.tpCode]: true }));
        toast.error('Failed to load photos for this session');
      } finally {
        setTpLoading((p) => ({ ...p, [tp.tpCode]: false }));
      }
    }
  };

  // --- Sequence tray reorder (pointer-drag from the grip handle) ---
  const startTrayDrag = (e: ReactPointerEvent, fromIndex: number) => {
    if (selected.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const tray = trayRef.current;
    if (!tray) return;
    const chips = Array.from(tray.querySelectorAll<HTMLElement>('[data-chip]'));
    const centers = chips.map((c) => {
      const r = c.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    const ctrl = new AbortController();
    dragRef.current = {
      pointerId: e.pointerId,
      fromIndex,
      startX: e.clientX,
      centers,
      currentTarget: fromIndex,
      abort: ctrl,
    };
    setDraggingId(selected[fromIndex].id);
    setDragDx(0);
    setDropIndex(fromIndex);

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      setDragDx(ev.clientX - d.startX);
      let nearest = 0;
      let best = Infinity;
      d.centers.forEach((c, i) => {
        const dist = Math.abs(ev.clientX - c);
        if (dist < best) {
          best = dist;
          nearest = i;
        }
      });
      d.currentTarget = nearest;
      setDropIndex(nearest);
    };
    const onUp = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.abort.abort();
      if (d.currentTarget !== d.fromIndex) onReorder(d.fromIndex, d.currentTarget);
      dragRef.current = null;
      setDraggingId(null);
      setDragDx(0);
      setDropIndex(null);
    };
    window.addEventListener('pointermove', onMove, { signal: ctrl.signal });
    window.addEventListener('pointerup', onUp, { signal: ctrl.signal });
    window.addEventListener('pointercancel', onUp, { signal: ctrl.signal });
  };

  const handleImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.src.endsWith(PLACEHOLDER)) return;
    e.currentTarget.src = PLACEHOLDER;
  };

  return (
    <div className={styles.builder}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Presentation Builder</h2>
          <p className={styles.hint}>
            Tap photos across sessions to add them, drag to reorder, then play.
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
            const count = selectedCountFor(tp.tpCode);
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
                  {count > 0 && <span className={styles.sessionBadge}>{count} selected</span>}
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
                      items.map((item) => {
                        const order = orderOf(item.id);
                        const sel = order >= 0;
                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={cn(styles.thumb, sel && styles.thumbSelected)}
                            onClick={() => onToggle(item)}
                            title={sel ? 'Remove from sequence' : 'Add to sequence'}
                          >
                            <img
                              src={item.url}
                              alt={item.label}
                              loading="lazy"
                              draggable={false}
                              onError={handleImgError}
                            />
                            <span className={styles.thumbLabel}>{item.label}</span>
                            {sel && <span className={styles.orderBadge}>{order + 1}</span>}
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
        <div className={styles.trayScroll} ref={trayRef}>
          {selected.length === 0 ? (
            <span className={styles.trayEmpty}>No photos selected yet.</span>
          ) : (
            selected.map((item, index) => (
              <div
                key={item.id}
                data-chip
                className={cn(
                  styles.chip,
                  draggingId === item.id && styles.chipDragging,
                  dropIndex === index && draggingId !== item.id && styles.chipDropTarget,
                )}
                style={draggingId === item.id ? { transform: `translateX(${dragDx}px)` } : undefined}
              >
                <span
                  className={styles.chipGrip}
                  title="Drag to reorder"
                  onPointerDown={(e) => startTrayDrag(e, index)}
                >
                  <i className="fas fa-grip-vertical" />
                </span>
                <img src={item.url} alt={item.label} draggable={false} onError={handleImgError} />
                <span className={styles.chipOrder}>{index + 1}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  title="Remove"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => onRemove(item.id)}
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            ))
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
    </div>
  );
};

export default SlideshowBuilder;
