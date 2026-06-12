/**
 * SVG manipulation overlay — selection outlines, scale/rotate handles and
 * pointer-drag interactions, drawn over the comparison canvas in canvas
 * coordinates (the viewBox maps 1:1 to canvas pixels).
 *
 * All geometry derives from the engine snapshot, so it stays glued to the
 * drawn pixels: every engine mutation commits a new snapshot → re-render.
 */

import React, { useRef, CSSProperties } from 'react';
import type { ComparisonEngine, EngineSnapshot } from './ComparisonEngine';
import { applyTransform, getContainerRect, getDrawSize, getImageCorners } from './geometry';
import type { DragState, ImageKey, ImageRect, Point } from './types';
import { IMG_INDEX_FOR_KEY, KEY_FOR_TOOL, TOOL_FOR_KEY } from './types';
import styles from './CompareOverlay.module.css';

interface Props {
    engine: ComparisonEngine;
    snap: EngineSnapshot;
    canvasEl: HTMLCanvasElement | null;
    /** CSS-displayed canvas width, for DPI-scaling the handle sizes. */
    displayWidth: number;
}

const STROKE = 'rgba(0, 123, 255, 0.95)';
const CLOSE_STROKE = 'rgba(220, 53, 69, 0.95)';
const ALL_KEYS: ImageKey[] = ['img1', 'img2', 'logo'];

const CompareOverlay = ({ engine, snap, canvasEl, displayWidth }: Props) => {
    const dragRef = useRef<DragState | null>(null);

    if (snap.imageCount < 2) return null;

    const clientToCanvas = (clientX: number, clientY: number): Point => {
        if (!canvasEl) return { x: 0, y: 0 };
        const rect = canvasEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
        return {
            x: ((clientX - rect.left) * snap.canvasWidth) / rect.width,
            y: ((clientY - rect.top) * snap.canvasHeight) / rect.height,
        };
    };

    const getRectForKey = (key: ImageKey): ImageRect | null => {
        const info = snap.imageInfo[IMG_INDEX_FOR_KEY[key]];
        if (!info) return null;
        return getContainerRect(
            key,
            snap.orientation,
            snap.autoMode,
            snap.autoImageSize,
            snap.canvasWidth,
            snap.canvasHeight,
            info.width,
            info.height,
        );
    };

    const startDrag = (e: React.PointerEvent, mode: DragState['mode'], key: ImageKey) => {
        const rect = getRectForKey(key);
        if (!rect) return;
        e.preventDefault();
        e.stopPropagation();
        const start = clientToCanvas(e.clientX, e.clientY);
        const ctrl = new AbortController();
        const drag: DragState = {
            mode,
            key,
            pointerId: e.pointerId,
            startCanvasX: start.x,
            startCanvasY: start.y,
            rectCx: rect.x + rect.w / 2,
            rectCy: rect.y + rect.h / 2,
            startTransform: engine.getTransform(key),
            abort: ctrl,
        };
        dragRef.current = drag;

        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== drag.pointerId) return;
            const cur = clientToCanvas(ev.clientX, ev.clientY);
            const next = { ...drag.startTransform };
            if (drag.mode === 'translate') {
                next.x = drag.startTransform.x + (cur.x - drag.startCanvasX);
                next.y = drag.startTransform.y + (cur.y - drag.startCanvasY);
            } else if (drag.mode === 'scale') {
                const cxAbs = drag.rectCx + drag.startTransform.x;
                const cyAbs = drag.rectCy + drag.startTransform.y;
                const startDist = Math.hypot(drag.startCanvasX - cxAbs, drag.startCanvasY - cyAbs);
                if (startDist < 1) return;
                const curDist = Math.hypot(cur.x - cxAbs, cur.y - cyAbs);
                next.scale = Math.max(0.1, Math.min(5, drag.startTransform.scale * (curDist / startDist)));
            } else {
                const cxAbs = drag.rectCx + drag.startTransform.x;
                const cyAbs = drag.rectCy + drag.startTransform.y;
                const startAngle = Math.atan2(drag.startCanvasY - cyAbs, drag.startCanvasX - cxAbs);
                const curAngle = Math.atan2(cur.y - cyAbs, cur.x - cxAbs);
                next.rotation = drag.startTransform.rotation + ((curAngle - startAngle) * 180) / Math.PI;
            }
            engine.setTransform(drag.key, next);
        };
        const onUp = (ev: PointerEvent) => {
            if (ev.pointerId !== drag.pointerId) return;
            ctrl.abort();
            dragRef.current = null;
        };

        window.addEventListener('pointermove', onMove, { signal: ctrl.signal });
        window.addEventListener('pointerup', onUp, { signal: ctrl.signal });
        window.addEventListener('pointercancel', onUp, { signal: ctrl.signal });
    };

    const dpi = snap.canvasWidth / Math.max(1, displayWidth);
    const handlePx = 10 * dpi;
    const rotPx = 30 * dpi;
    const strokeW = 1.5 * dpi;
    const dashOn = 5 * dpi;
    const dashOff = 4 * dpi;

    const selectedKey: ImageKey | null = KEY_FOR_TOOL[snap.selectedImage] ?? null;

    type Geom = { rect: ImageRect; drawSize: ReturnType<typeof getDrawSize>; corners: Point[]; transform: DragState['startTransform'] };
    const geom = new Map<ImageKey, Geom>();
    for (const key of ALL_KEYS) {
        if (key === 'logo' && !snap.showLogo) continue;
        const info = snap.imageInfo[IMG_INDEX_FOR_KEY[key]];
        if (!info) continue;
        const rect = getContainerRect(
            key,
            snap.orientation,
            snap.autoMode,
            snap.autoImageSize,
            snap.canvasWidth,
            snap.canvasHeight,
            info.width,
            info.height,
        );
        if (!rect) continue;
        const drawSize = getDrawSize(info.width, info.height, rect.w, rect.h);
        const transform = snap.transform[key];
        const corners = getImageCorners(rect, drawSize, transform);
        geom.set(key, { rect, drawSize, corners, transform });
    }

    const ordered: ImageKey[] = selectedKey
        ? [...ALL_KEYS.filter(k => k !== selectedKey), selectedKey]
        : ALL_KEYS;

    // Dynamic dash pattern scales with DPI; static cursor + hover rules live in the module.
    const rotateDashStyle = { '--rotate-dash': `${dashOn * 0.5} ${dashOff * 0.5}` } as CSSProperties;

    return (
        <svg
            className={styles.svgOverlay}
            viewBox={`0 0 ${snap.canvasWidth} ${snap.canvasHeight}`}
            preserveAspectRatio="none"
        >
            {ordered.map(key => {
                const g = geom.get(key);
                if (!g) return null;
                const points = g.corners.map(c => `${c.x},${c.y}`).join(' ');
                const isSelected = key === selectedKey;

                if (!isSelected) {
                    return (
                        <polygon
                            key={key}
                            points={points}
                            fill="transparent"
                            stroke="none"
                            pointerEvents="all"
                            style={{ cursor: 'pointer' }}
                            onPointerDown={(e) => {
                                engine.setSelectedImage(TOOL_FOR_KEY[key]);
                                startDrag(e, 'translate', key);
                            }}
                        />
                    );
                }

                const cx = g.rect.x + g.rect.w / 2;
                const cy = g.rect.y + g.rect.h / 2;
                const halfW = g.drawSize.dw / 2;
                const halfH = g.drawSize.dh / 2;
                const closeBtnPos = applyTransform(halfW + rotPx * 0.7, -halfH - rotPx * 0.7, cx, cy, g.transform);
                const closeR = handlePx;
                // Edge midpoints in image-local coords, then transformed to canvas space.
                const edges = [
                    applyTransform(0, -halfH, cx, cy, g.transform),   // top
                    applyTransform(halfW, 0, cx, cy, g.transform),    // right
                    applyTransform(0, halfH, cx, cy, g.transform),    // bottom
                    applyTransform(-halfW, 0, cx, cy, g.transform),   // left
                ];
                const edgeCursors = ['ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'];
                // Toggle approach: scale handle inside the square, rotate just outside it.
                // Ring is invisible at rest; CSS :hover reveals a faint outline.
                const rotateRingR = handlePx * 1.6;

                return (
                    <g key={key}>
                        <polygon
                            points={points}
                            fill="transparent"
                            stroke="none"
                            pointerEvents="all"
                            style={{ cursor: 'move' }}
                            onPointerDown={(e) => startDrag(e, 'translate', key)}
                        />
                        <polygon
                            points={points}
                            fill="none"
                            stroke={STROKE}
                            strokeWidth={strokeW}
                            strokeDasharray={`${dashOn} ${dashOff}`}
                            pointerEvents="none"
                        />
                        {g.corners.map((c, i) => (
                            <circle
                                key={`rot-${i}`}
                                className={styles.rotateZone}
                                style={rotateDashStyle}
                                cx={c.x}
                                cy={c.y}
                                r={rotateRingR}
                                fill="transparent"
                                stroke="transparent"
                                strokeWidth={strokeW * 0.6}
                                pointerEvents="all"
                                onPointerDown={(e) => startDrag(e, 'rotate', key)}
                            />
                        ))}
                        {g.corners.map((c, i) => (
                            <rect
                                key={`corner-${i}`}
                                x={c.x - handlePx / 2}
                                y={c.y - handlePx / 2}
                                width={handlePx}
                                height={handlePx}
                                fill="white"
                                stroke={STROKE}
                                strokeWidth={strokeW}
                                pointerEvents="all"
                                style={{ cursor: i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize' }}
                                onPointerDown={(e) => startDrag(e, 'scale', key)}
                            />
                        ))}
                        {edges.map((p, i) => (
                            <rect
                                key={`edge-${i}`}
                                x={p.x - handlePx / 2}
                                y={p.y - handlePx / 2}
                                width={handlePx}
                                height={handlePx}
                                fill="white"
                                stroke={STROKE}
                                strokeWidth={strokeW}
                                pointerEvents="all"
                                style={{ cursor: edgeCursors[i] }}
                                onPointerDown={(e) => startDrag(e, 'scale', key)}
                            />
                        ))}
                        <circle
                            cx={closeBtnPos.x}
                            cy={closeBtnPos.y}
                            r={closeR}
                            fill="white"
                            stroke={CLOSE_STROKE}
                            strokeWidth={strokeW}
                            pointerEvents="all"
                            style={{ cursor: 'pointer' }}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                engine.setSelectedImage(0);
                            }}
                        >
                            <title>Deselect (Esc)</title>
                        </circle>
                        <line
                            x1={closeBtnPos.x - closeR * 0.45}
                            y1={closeBtnPos.y - closeR * 0.45}
                            x2={closeBtnPos.x + closeR * 0.45}
                            y2={closeBtnPos.y + closeR * 0.45}
                            stroke={CLOSE_STROKE}
                            strokeWidth={strokeW * 1.5}
                            pointerEvents="none"
                        />
                        <line
                            x1={closeBtnPos.x + closeR * 0.45}
                            y1={closeBtnPos.y - closeR * 0.45}
                            x2={closeBtnPos.x - closeR * 0.45}
                            y2={closeBtnPos.y + closeR * 0.45}
                            stroke={CLOSE_STROKE}
                            strokeWidth={strokeW * 1.5}
                            pointerEvents="none"
                        />
                    </g>
                );
            })}
        </svg>
    );
};

export default CompareOverlay;
