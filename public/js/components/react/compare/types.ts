/**
 * Shared types + constants for the photo comparison feature.
 * Pure data — no React, no DOM.
 */
import type { PhotoViewCode } from '@shared/photo-views';

export interface PhotoType {
    id: string;
    label: string;
    /** Short label shown inside a category group (category is implied). */
    short: string;
    /** The gallery's view key (`shared/photo-views.ts`): the photo's name and version
     *  come from `galleryQuery(...)[view]`, never from a name rebuilt here (FE-F13-1/-5/-8). */
    view: PhotoViewCode;
    category: 'facial' | 'occlusal' | 'intraoral';
}

interface CanvasSizeOption {
    value: string;
    label: string;
}

interface ToolOption {
    value: number;
    label: string;
}

/** The watermark's colour: a white or black silhouette of the logo, or its own colours. */
export type LogoTone = 'white' | 'black' | 'original';

export interface Transform {
    x: number;
    y: number;
    scale: number;
    rotation: number;
}

export interface TransformState {
    img1: Transform;
    img2: Transform;
    logo: Transform;
}

/**
 * Per-side crop insets, each a fraction (0..1) of the image's container box.
 * Cutting trims the image along straight, canvas-axis-aligned lines (so the
 * cut stays straight even when the image is rotated). The trimmed strip shows
 * the canvas background — the image keeps its proportions and position.
 * Fraction-based so it survives canvas size-mode changes.
 */
export interface CropInset {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface CropState {
    img1: CropInset;
    img2: CropInset;
    logo: CropInset;
}

export type CropSide = 'top' | 'right' | 'bottom' | 'left';

export interface CanvasDimensions {
    width: number;
    height: number;
}

export interface AutoImageSize {
    width: number;
    height: number;
}

export type ImageKey = 'img1' | 'img2' | 'logo';

export interface ImageRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface DrawSize {
    dw: number;
    dh: number;
}

export interface Point {
    x: number;
    y: number;
}

/** Live pointer-drag bookkeeping for the SVG overlay. */
export interface DragState {
    mode: 'translate' | 'scale' | 'rotate';
    key: ImageKey;
    pointerId: number;
    startCanvasX: number;
    startCanvasY: number;
    rectCx: number;
    rectCy: number;
    startTransform: Transform;
}

export const KEY_FOR_TOOL: Record<number, ImageKey> = { 1: 'img1', 2: 'img2', 3: 'logo' };
export const TOOL_FOR_KEY: Record<ImageKey, number> = { img1: 1, img2: 2, logo: 3 };
export const IMG_INDEX_FOR_KEY: Record<ImageKey, number> = { img1: 0, img2: 1, logo: 2 };

export const PHOTO_TYPES: PhotoType[] = [
    { id: 'profile', label: 'Facial Profile', short: 'Profile', view: 'i10', category: 'facial' },
    { id: 'rest', label: 'Facial Rest', short: 'Rest', view: 'i12', category: 'facial' },
    { id: 'smile', label: 'Facial Smile', short: 'Smile', view: 'i13', category: 'facial' },
    { id: 'upper', label: 'Occlusal Upper', short: 'Upper', view: 'i23', category: 'occlusal' },
    { id: 'lower', label: 'Occlusal Lower', short: 'Lower', view: 'i24', category: 'occlusal' },
    { id: 'right', label: 'Intra-oral Right', short: 'Right', view: 'i20', category: 'intraoral' },
    { id: 'center', label: 'Intra-oral Center', short: 'Center', view: 'i22', category: 'intraoral' },
    { id: 'left', label: 'Intra-oral Left', short: 'Left', view: 'i21', category: 'intraoral' },
];

export const PHOTO_CATEGORIES = ['facial', 'occlusal', 'intraoral'] as const;

export const CANVAS_SIZES: CanvasSizeOption[] = [
    { value: 'auto', label: 'Auto (up to 4096 px)' },
    { value: 'auto-full', label: 'Full resolution' },
    { value: 'auto-50', label: '50% of source' },
    { value: 'auto-25', label: '25% of source' },
    { value: '{"width":1080,"height":1350}', label: 'Post (1080 × 1350)' },
    { value: '{"width":1080,"height":1920}', label: 'Story (1080 × 1920)' },
    { value: '{"width":2060,"height":2700}', label: '2060 × 2700' },
];

// 0 = no selection — bounding box hidden, manipulation buttons disabled.
export const TOOLS: ToolOption[] = [
    { value: 0, label: 'None' },
    { value: 1, label: 'Image 1' },
    { value: 2, label: 'Image 2' },
    { value: 3, label: 'Logo' },
];
