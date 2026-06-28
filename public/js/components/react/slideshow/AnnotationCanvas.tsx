/**
 * AnnotationCanvas — ephemeral freehand drawing overlay for the slideshow player.
 *
 * A DPR-aware <canvas> sized to its parent stage via ResizeObserver. Pointer
 * Events unify mouse / touch / stylus (pen pressure scales stroke width);
 * `touch-action: none` + pointer capture make touch DRAW instead of scroll.
 * Strokes live only in a ref (no persistence). The player remounts this via a
 * per-slide `key`, so navigating to another slide (or toggling annotate off)
 * naturally discards everything — no reset effect needed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import styles from './AnnotationCanvas.module.css';

interface Point {
  x: number;
  y: number;
}
interface Stroke {
  color: string;
  width: number;
  points: Point[];
}

const COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff'];
const WIDTHS = [3, 6, 12];

const AnnotationCanvas = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Stroke | null>(null);

  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [count, setCount] = useState(0); // stroke count → undo/clear enabled state

  // Repaint every stored stroke. Reads only refs + window, so it's stable.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
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
        const p = s.points[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
  }, []);

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
    return () => ro.disconnect();
  }, [draw]);

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const penScale = e.pointerType === 'pen' && e.pressure > 0 ? 0.5 + e.pressure : 1;
    const stroke: Stroke = { color, width: width * penScale, points: [pointFromEvent(e)] };
    activeRef.current = stroke;
    strokesRef.current.push(stroke);
    draw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stroke = activeRef.current;
    if (!stroke) return;
    stroke.points.push(pointFromEvent(e));
    draw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!activeRef.current) return;
    activeRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
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
            key={c}
            type="button"
            className={`${styles.swatch} ${color === c ? styles.swatchActive : ''}`}
            style={{ background: c }}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
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
