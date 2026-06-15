/**
 * Pure geometry helpers shared by the canvas engine (drawing) and the SVG
 * overlay (hit-testing / handle placement). Keeping them in one module is what
 * guarantees the overlay outlines stay glued to the drawn pixels.
 */

import type { AutoImageSize, CropInset, DrawSize, ImageKey, ImageRect, Point, Transform } from './types';

// Mirrors renderVertical / renderHorizontal / drawLogo branches in ComparisonEngine.
export function getContainerRect(
    key: ImageKey,
    orientation: 'vertical' | 'horizontal',
    autoMode: boolean,
    autoImageSize: AutoImageSize | null,
    canvasWidth: number,
    canvasHeight: number,
    imgWidth: number,
    imgHeight: number,
): ImageRect | null {
    if (key === 'logo') {
        const logoWidth = autoMode ? canvasWidth * 0.15 : imgWidth / 6;
        const logoHeight = (imgHeight * logoWidth) / imgWidth;
        return {
            x: canvasWidth / 2 - logoWidth / 2,
            y: canvasHeight / 2 - logoHeight / 1.3,
            w: logoWidth,
            h: logoHeight,
        };
    }
    if (orientation === 'vertical') {
        if (autoMode && autoImageSize) {
            const w = autoImageSize.width;
            const h = autoImageSize.height;
            return key === 'img1' ? { x: 0, y: 0, w, h } : { x: 0, y: h, w, h };
        }
        const halfH = canvasHeight / 2;
        return key === 'img1'
            ? { x: 0, y: 0, w: canvasWidth, h: halfH }
            : { x: 0, y: halfH, w: canvasWidth, h: halfH };
    }
    if (autoMode && autoImageSize) {
        const w = autoImageSize.width;
        const h = autoImageSize.height;
        return key === 'img1' ? { x: 0, y: 0, w, h } : { x: w, y: 0, w, h };
    }
    const halfW = canvasWidth / 2;
    return key === 'img1'
        ? { x: 0, y: 0, w: halfW, h: canvasHeight }
        : { x: halfW, y: 0, w: halfW, h: canvasHeight };
}

// Mirrors aspect-fit math in ComparisonEngine.drawImage's transform path.
export function getDrawSize(imgWidth: number, imgHeight: number, containerW: number, containerH: number): DrawSize {
    const aspectRatio = imgWidth / imgHeight;
    const containerRatio = containerW / containerH;
    if (aspectRatio > containerRatio) {
        return { dw: containerW, dh: containerW / aspectRatio };
    }
    return { dw: containerH * aspectRatio, dh: containerH };
}

// Apply M = translate(cx + tx, cy + ty) · rotate(rot) · scale(s) to a local point.
export function applyTransform(lx: number, ly: number, cx: number, cy: number, t: Transform): Point {
    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sx = lx * t.scale;
    const sy = ly * t.scale;
    return {
        x: cx + t.x + sx * cos - sy * sin,
        y: cy + t.y + sx * sin + sy * cos,
    };
}

// Per-side crop fractions → the axis-aligned "kept" sub-rectangle of a
// container box. Mirrors the clip rect in ComparisonEngine.drawImage, so the
// overlay's crop outline/handles stay glued to the actually-drawn pixels.
export function getCropRect(rect: ImageRect, crop: CropInset): ImageRect {
    const left = crop.left * rect.w;
    const right = crop.right * rect.w;
    const top = crop.top * rect.h;
    const bottom = crop.bottom * rect.h;
    return {
        x: rect.x + left,
        y: rect.y + top,
        w: Math.max(0, rect.w - left - right),
        h: Math.max(0, rect.h - top - bottom),
    };
}

export function getImageCorners(rect: ImageRect, drawSize: DrawSize, t: Transform): Point[] {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const halfW = drawSize.dw / 2;
    const halfH = drawSize.dh / 2;
    return [
        applyTransform(-halfW, -halfH, cx, cy, t),
        applyTransform(halfW, -halfH, cx, cy, t),
        applyTransform(halfW, halfH, cx, cy, t),
        applyTransform(-halfW, halfH, cx, cy, t),
    ];
}
