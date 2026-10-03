/**
 * SlideshowPlayer — immersive, manually-driven presentation overlay.
 *
 * Renders fullscreen (with a fixed-overlay fallback if fullscreen is denied).
 * The operator advances by swipe, tap zones (left third = prev, right third =
 * next, center = toggle chrome), arrow keys, or a presenter remote (PageDown /
 * PageUp). Transitions are clean crossfade or slide. Chrome auto-hides; a screen
 * Wake Lock keeps the display awake.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import cn from 'classnames';
import { useFullscreen } from './useFullscreen';
import { useWakeLock } from './useWakeLock';
import { slidePhotos } from './photoTypes';
import AnnotationCanvas from './AnnotationCanvas';
import type { Framing, SlideItem, SlidePhoto, TransitionStyle } from './types';
import styles from './SlideshowPlayer.module.css';

interface Props {
  slides: SlideItem[];
  onExit: () => void;
}

interface Outgoing {
  item: SlideItem;
  dir: 1 | -1;
  key: number;
}

const SWIPE_THRESHOLD = 50; // px before a horizontal drag counts as a swipe
const TAP_THRESHOLD = 10; // px of movement still treated as a tap
const CHROME_HIDE_MS = 2800;
const TRANSITION_MS = 420; // must exceed the CSS animation duration (--transition-slow)
const PLACEHOLDER = '/images/placeholder.svg';

const SlideshowPlayer = ({ slides, onExit }: Props) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  // The player is already a full-viewport overlay: no fixed-overlay fallback needed.
  const { isFullscreen, enter, exit } = useFullscreen(stageRef, { fallback: false });
  useWakeLock(true);

  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const indexRef = useRef(0);
  const [index, setIndexState] = useState(0);
  const setIndex = (n: number) => {
    indexRef.current = n;
    setIndexState(n);
  };

  const [animKey, setAnimKey] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const keyCounter = useRef(0);
  const clearTimerRef = useRef<number | undefined>(undefined);

  const [transition, setTransition] = useState<TransitionStyle>('crossfade');
  const [framing, setFraming] = useState<Framing>('fit');
  const [showCaption, setShowCaption] = useState(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimerRef = useRef<number | undefined>(undefined);

  // Annotate mode: a freehand-draw overlay that captures pointers (so swipe/tap
  // nav is suspended) and keeps the chrome up so its toggle stays reachable. The
  // ref mirrors the state for the stale-closure'd keyboard handler + revealChrome.
  const [annotate, setAnnotate] = useState(false);
  const annotateRef = useRef(false);

  const safeIndex = Math.min(index, slides.length - 1);
  const current = slides[safeIndex];

  // Enter fullscreen on mount; release timers on unmount.
  useEffect(() => {
    void enter();
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [enter]);

  // Focus moves into the player on open and back to whatever opened it (Play) on
  // close — it used to sit on <body> (FE-F15-9e).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stageRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // The displayed photo(s) of the current slide, as one rectangle: the union of each
  // image's object-fit: contain box. Annotations are anchored to it (FE-F15-6).
  const getPhotoRect = (): DOMRect | null => {
    const imgs = frameRef.current?.querySelectorAll<HTMLImageElement>('[data-current-slide] img');
    if (!imgs || imgs.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    imgs.forEach((img) => {
      const r = img.getBoundingClientRect();
      const nw = img.naturalWidth || r.width;
      const nh = img.naturalHeight || r.height;
      if (!r.width || !r.height || !nw || !nh) return;
      const scale = Math.min(r.width / nw, r.height / nh);
      const w = nw * scale;
      const h = nh * scale;
      const x = r.left + (r.width - w) / 2;
      const y = r.top + (r.height - h) / 2;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + w);
      bottom = Math.max(bottom, y + h);
    });
    return Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : null;
  };

  // If the user leaves OS fullscreen (Esc / gesture) after we entered it, close.
  const wasFullscreenRef = useRef(false);
  useEffect(() => {
    if (isFullscreen) wasFullscreenRef.current = true;
    else if (wasFullscreenRef.current) {
      wasFullscreenRef.current = false;
      onExit();
    }
  }, [isFullscreen, onExit]);

  const revealChrome = () => {
    setChromeVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    // While annotating, keep the chrome up so the user can toggle annotate off.
    if (!annotateRef.current) hideTimerRef.current = window.setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  };

  const hideChrome = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setChromeVisible(false);
  };

  const setAnnotateMode = (on: boolean) => {
    annotateRef.current = on;
    setAnnotate(on);
    if (on) {
      setChromeVisible(true);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    } else {
      revealChrome(); // re-arm the auto-hide
    }
  };

  // Chrome starts visible (initial state); on mount, arm the auto-hide timer so it
  // fades on its own. We arm the timer directly rather than calling revealChrome()
  // to avoid a redundant synchronous setChromeVisible(true) in the effect body.
  useEffect(() => {
    hideTimerRef.current = window.setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);

  const go = (delta: 1 | -1) => {
    const cur = indexRef.current;
    const next = cur + delta;
    if (next < 0 || next >= slides.length) return;
    keyCounter.current += 1;
    if (!reduceMotion) {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      setOutgoing({ item: slides[cur], dir: delta, key: keyCounter.current });
      clearTimerRef.current = window.setTimeout(() => setOutgoing(null), TRANSITION_MS);
    }
    setDirection(delta);
    setAnimKey(keyCounter.current);
    setIndex(next);
  };

  const handleExit = () => {
    if (document.fullscreenElement) {
      void exit(); // fullscreenchange handler will fire onExit
    } else {
      onExit();
    }
  };

  // Keyboard navigation (mouse/keyboard fallback).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // PageDown/PageUp are what presenter remotes send (FE-F15-9a).
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault(); // Space: suppress page scroll / focused-button activation
        go(1);
        revealChrome();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || e.key === 'PageUp') {
        e.preventDefault(); // Backspace: suppress legacy history-back
        go(-1);
        revealChrome();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleExit();
      } else {
        // Any other key (Tab included) brings the hidden controls back, so they can
        // be reached — hidden, they are not focusable (FE-F15-1).
        revealChrome();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Preload immediate neighbours (every photo on each) for instant transitions.
  useEffect(() => {
    [safeIndex + 1, safeIndex - 1].forEach((i) => {
      if (i >= 0 && i < slides.length) {
        slidePhotos(slides[i]).forEach((p) => {
          const img = new Image();
          img.src = p.url;
        });
      }
    });
  }, [safeIndex, slides]);

  // --- Gesture handling on a dedicated layer (siblings of chrome buttons) ---
  const downRef = useRef<{ x: number; y: number; id: number; wasVisible: boolean } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (annotate) return; // the annotation canvas owns pointers in annotate mode
    // Only the primary button navigates: a right-click advanced and opened the
    // context menu (FE-F15-9b).
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, wasVisible: chromeVisible };
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (annotate) return;
    const down = downRef.current;
    downRef.current = null;
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX > SWIPE_THRESHOLD && absX > absY) {
      go(dx < 0 ? 1 : -1); // swipe left → next
      revealChrome();
      return;
    }
    if (absX < TAP_THRESHOLD && absY < TAP_THRESHOLD) {
      const rect = stageRef.current?.getBoundingClientRect();
      const rel = rect ? (e.clientX - rect.left) / rect.width : 0.5;
      if (rel < 0.33) {
        go(-1);
        revealChrome();
      } else if (rel > 0.67) {
        go(1);
        revealChrome();
      } else if (down.wasVisible) {
        hideChrome();
      } else {
        revealChrome();
      }
    }
  };

  const handleImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.src.endsWith(PLACEHOLDER)) return;
    e.currentTarget.src = PLACEHOLDER;
  };

  const enterClass = !reduceMotion
    ? transition === 'crossfade'
      ? styles.enterFade
      : direction > 0
        ? styles.enterRight
        : styles.enterLeft
    : undefined;

  const leaveClass = (dir: 1 | -1) =>
    transition === 'crossfade' ? styles.leaveFade : dir > 0 ? styles.leaveLeft : styles.leaveRight;

  // Per-photo label for a paired (side-by-side) slide.
  const photoLabel = (photo: SlidePhoto) => (
    <span className={styles.pairLabel}>
      <span className={styles.pairLabelMain}>{photo.tpDescription || 'Photo'}</span>
      <span className={styles.pairLabelSub}>
        {photo.label}
        {photo.tpDate ? ` · ${photo.tpDate}` : ''}
      </span>
    </span>
  );

  // A slide renders one photo, or several side-by-side when `extras` are set.
  const renderSlide = (item: SlideItem) => {
    const photos = slidePhotos(item);
    if (photos.length === 1) {
      return <img src={item.url} alt={item.label} draggable={false} onError={handleImgError} />;
    }
    return (
      <div className={styles.pair}>
        {photos.map((photo, i) => (
          <div key={`${photo.tp}:${photo.name}-${i}`} className={styles.pairItem}>
            <img src={photo.url} alt={photo.label} draggable={false} onError={handleImgError} />
            {showCaption && photoLabel(photo)}
          </div>
        ))}
      </div>
    );
  };

  if (!current) return null;

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
      tabIndex={-1}
    >
      {/* Slide changes are announced (the visible counter hides with the chrome). */}
      <div className={styles.srOnly} aria-live="polite">
        {`Slide ${safeIndex + 1} of ${slides.length}: ${slidePhotos(current)
          .map((p) => [p.label, p.tpDescription, p.tpDate].filter(Boolean).join(', '))
          .join(' and ')}`}
      </div>
      <div
        ref={(el) => {
          frameRef.current = el;
          if (el !== frameEl) setFrameEl(el);
        }}
        className={cn(styles.frame, framing === 'reel' && styles.frameReel)}
      >
        {outgoing && (
          <div key={`out-${outgoing.key}`} className={cn(styles.layer, leaveClass(outgoing.dir))}>
            {renderSlide(outgoing.item)}
          </div>
        )}
        <div key={`in-${animKey}`} className={cn(styles.layer, enterClass)} data-current-slide="">
          {renderSlide(current)}
        </div>

        {showCaption && !current.extras?.length && (
          <div className={styles.caption}>
            <span className={styles.captionMain}>{current.tpDescription || 'Photo'}</span>
            <span className={styles.captionSub}>
              {current.label}
              {current.tpDate ? ` · ${current.tpDate}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Gesture layer: catches taps/swipes everywhere except on chrome buttons. */}
      <div className={styles.gestureLayer} onPointerDown={onPointerDown} onPointerUp={onPointerUp} />

      {/* Annotation overlay sits above the gesture layer so it captures draws.
          Keyed by slide so each navigation remounts it with a clean canvas. */}
      {annotate && <AnnotationCanvas key={safeIndex} getPhotoRect={getPhotoRect} observe={frameEl} />}

      <div className={cn(styles.chrome, !chromeVisible && styles.chromeHidden)}>
        <div className={styles.topBar}>
          <span className={styles.counter}>
            {safeIndex + 1} / {slides.length}
          </span>
          <div className={styles.controls}>
            <button
              type="button"
              className={cn(styles.iconBtn, framing === 'reel' && styles.iconBtnActive)}
              title={framing === 'reel' ? 'Reel 9:16 framing' : 'Fit to screen'}
              aria-label="Toggle framing"
              onClick={() => setFraming((f) => (f === 'fit' ? 'reel' : 'fit'))}
            >
              <i className={cn('fas', framing === 'reel' ? 'fa-mobile-screen-button' : 'fa-expand')} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title={transition === 'crossfade' ? 'Crossfade (tap for Slide)' : 'Slide (tap for Crossfade)'}
              aria-label="Toggle transition"
              onClick={() => setTransition((t) => (t === 'crossfade' ? 'slide' : 'crossfade'))}
            >
              <i className={cn('fas', transition === 'crossfade' ? 'fa-circle-half-stroke' : 'fa-arrows-left-right')} />
            </button>
            <button
              type="button"
              className={cn(styles.iconBtn, showCaption && styles.iconBtnActive)}
              title="Toggle caption"
              aria-label="Toggle caption"
              onClick={() => setShowCaption((c) => !c)}
            >
              <i className="fas fa-closed-captioning" />
            </button>
            <button
              type="button"
              className={cn(styles.iconBtn, annotate && styles.iconBtnActive)}
              title={annotate ? 'Stop annotating' : 'Annotate'}
              aria-label="Toggle annotation"
              aria-pressed={annotate}
              onClick={() => setAnnotateMode(!annotate)}
            >
              <i className="fas fa-pen" />
            </button>
            <button
              type="button"
              className={cn(styles.iconBtn, styles.exitBtn)}
              title="Close (Esc)"
              aria-label="Close presentation"
              onClick={handleExit}
            >
              <i className="fas fa-times" />
            </button>
          </div>
        </div>

        {slides.length > 1 && slides.length <= 15 && (
          <div className={styles.dots}>
            {slides.map((s, i) => (
              <span key={s.uid} className={cn(styles.dot, i === safeIndex && styles.dotActive)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SlideshowPlayer;
