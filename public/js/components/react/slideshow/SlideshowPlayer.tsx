/**
 * SlideshowPlayer — immersive, manually-driven presentation overlay.
 *
 * Renders fullscreen (with a fixed-overlay fallback if fullscreen is denied).
 * The operator advances by swipe, tap zones (left third = prev, right third =
 * next, center = toggle chrome), or arrow keys. Transitions are clean crossfade
 * or slide. Chrome auto-hides; a screen Wake Lock keeps the display awake.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import cn from 'classnames';
import { useFullscreen } from './useFullscreen';
import { useWakeLock } from './useWakeLock';
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
  const { isFullscreen, enter, exit } = useFullscreen(stageRef);
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
    hideTimerRef.current = window.setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  };

  const hideChrome = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setChromeVisible(false);
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
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault(); // Space: suppress page scroll / focused-button activation
        go(1);
        revealChrome();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault(); // Backspace: suppress legacy history-back
        go(-1);
        revealChrome();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Preload immediate neighbours for instant transitions.
  useEffect(() => {
    [safeIndex + 1, safeIndex - 1].forEach((i) => {
      if (i >= 0 && i < slides.length) {
        const img = new Image();
        img.src = slides[i].url;
        const sec = slides[i].second;
        if (sec) {
          const img2 = new Image();
          img2.src = sec.url;
        }
      }
    });
  }, [safeIndex, slides]);

  // --- Gesture handling on a dedicated layer (siblings of chrome buttons) ---
  const downRef = useRef<{ x: number; y: number; id: number; wasVisible: boolean } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, wasVisible: chromeVisible };
  };

  const onPointerUp = (e: ReactPointerEvent) => {
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

  // A slide renders one photo, or two side-by-side when `second` is set.
  const renderSlide = (item: SlideItem) => {
    if (!item.second) {
      return <img src={item.url} alt={item.label} draggable={false} onError={handleImgError} />;
    }
    return (
      <div className={styles.pair}>
        <div className={styles.pairItem}>
          <img src={item.url} alt={item.label} draggable={false} onError={handleImgError} />
          {showCaption && photoLabel(item)}
        </div>
        <div className={styles.pairItem}>
          <img src={item.second.url} alt={item.second.label} draggable={false} onError={handleImgError} />
          {showCaption && photoLabel(item.second)}
        </div>
      </div>
    );
  };

  if (!current) return null;

  return (
    <div ref={stageRef} className={styles.stage} role="dialog" aria-modal="true" aria-label="Presentation">
      <div className={cn(styles.frame, framing === 'reel' && styles.frameReel)}>
        {outgoing && (
          <div key={`out-${outgoing.key}`} className={cn(styles.layer, leaveClass(outgoing.dir))}>
            {renderSlide(outgoing.item)}
          </div>
        )}
        <div key={`in-${animKey}`} className={cn(styles.layer, enterClass)}>
          {renderSlide(current)}
        </div>

        {showCaption && !current.second && (
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
