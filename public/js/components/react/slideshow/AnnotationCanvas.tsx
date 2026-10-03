/**
 * AnnotationCanvas — ephemeral freehand drawing overlay for the slideshow player.
 *
 * A DPR-aware <canvas> sized to its parent stage via ResizeObserver. Pointer
 * Events unify mouse / touch / stylus (pen pressure scales stroke width);
 * `touch-action: none` + pointer capture make touch DRAW instead of scroll.
 * Strokes live only in a ref (no persistence). The player remounts this via a
 * per-slide `key`, so navigating to another slide (or toggling annotate off)
 * naturally discards everything — no reset effect needed.
 *
 * Points are stored as FRACTIONS OF THE DISPLAYED PHOTO (`getPhotoRect`), not as
 * screen pixels: the photo is `object-fit: contain`, so a framing toggle (Reel 9:16)
 * or turning a tablet moves and scales it, and ink stored in pixels stayed where it
 * was while the circled point moved away (FE-F15-6). Each pointer draws its own
 * stroke — two fingers, or a palm beside a stylus, used to zigzag into one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import styles from './AnnotationCanvas.module.css';

/** A point as fractions (0..1) of the photo rectangle. */
interface Point {
  u: number;
  v: number;
}
interface Stroke {
  color: string;
  width: number;
  points: Point[];
}

interface Props {
  /** The displayed photo's rectangle (viewport coordinates), or null. */
  getPhotoRect: () => DOMRect | null;
  /** An element whose resizes move the photo (the player's frame). */
  observe: HTMLElement | null;
}

const COLORS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#ff3b30', name: 'Red' },
  { value: '#ffd60a', name: 'Yellow' },
  { value: '#34c759', name: 'Green' },
  { value: '#0a84ff', name: 'Blue' },
  { value: '#ffffff', name: 'White' },
];
const WIDTHS = [3, 6, 12];

const AnnotationCanvas = ({ getPhotoRect, observe }: Props) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef(new Map<number, Stroke>());
  const getRectRef = useRef(getPhotoRect);
  useEffect(() => {
    getRectRef.current = getPhotoRect;
  });

  const [color, setColor] = useState(COLORS[0].value);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [count, setCount] = useState(0); // stroke count → undo/clear enabled state

  /** The photo's rectangle in canvas coordinates (falls back to the whole canvas). */
  const photoBox = useCallback((): { x: number; y: number; w: number; h: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    const r = getRectRef.current();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0, w: c.width, h: c.height };
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }, []);

  // Repaint every stored stroke against the photo's CURRENT rectangle.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const box = photoBox();
    if (!canvas || !ctx || !box) return;
    const at = (p: Point) => ({ x: box.x + p.u * box.w, y: box.y + p.v * box.h });
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokesRef.current) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      if (s.points.length === 1) {
        const p = at(s.points[0]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      const p0 = at(s.points[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < s.points.length; i++) {
        const p = at(s.points[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }, [photoBox]);

  // Size the canvas backing store to the wrapper (DPR-aware); redraw on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const { width: w, height: h } = wrap.getBoundingClientRect();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      draw();
    });
    ro.observe(wrap);
    // The frame resizes on a framing toggle while the stage does not: repaint then too.
    if (observe) ro.observe(observe);
    return () => ro.disconnect();
  }, [draw, observe]);

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = photoBox();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!box || !rect || box.w === 0 || box.h === 0) return { u: 0, v: 0 };
    return {
      u: (e.clientX - rect.left - box.x) / box.w,
      v: (e.clientY - rect.top - box.y) / box.h,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const penScale = e.pointerType === 'pen' && e.pressure > 0 ? 0.5 + e.pressure : 1;
    const stroke: Stroke = { color, width: width * penScale, points: [pointFromEvent(e)] };
    activeRef.current.set(e.pointerId, stroke);
    strokesRef.current.push(stroke);
    draw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stroke = activeRef.current.get(e.pointerId);
    if (!stroke) return;
    stroke.points.push(pointFromEvent(e));
    draw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!activeRef.current.has(e.pointerId)) return;
    activeRef.current.delete(e.pointerId);
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) canvasRef.current.releasePointerCapture(e.pointerId);
    setCount(strokesRef.current.length);
  };

  const undo = (): void => {
    strokesRef.current.pop();
    setCount(strokesRef.current.length);
    draw();
  };
  const clear = (): void => {
    strokesRef.current = [];
    setCount(0);
    draw();
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className={styles.toolbar} role="toolbar" aria-label="Annotation tools">
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`${styles.swatch} ${color === c.value ? styles.swatchActive : ''}`}
            style={{ background: c.value }}
            aria-label={`${c.name} ink`}
            title={c.name}
            aria-pressed={color === c.value}
            onClick={() => setColor(c.value)}
          />
        ))}
        <span className={styles.divider} />
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            className={`${styles.widthBtn} ${width === w ? styles.widthActive : ''}`}
            aria-label={`Width ${w}`}
            aria-pressed={width === w}
            onClick={() => setWidth(w)}
          >
            <span className={styles.widthDot} style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <span className={styles.divider} />
        <button type="button" className={styles.toolBtn} onClick={undo} disabled={count === 0} aria-label="Undo" title="Undo">
          <i className="fas fa-rotate-left" />
        </button>
        <button type="button" className={styles.toolBtn} onClick={clear} disabled={count === 0} aria-label="Clear" title="Clear">
          <i className="fas fa-trash" />
        </button>
      </div>
    </div>
  );
};

export default AnnotationCanvas;
