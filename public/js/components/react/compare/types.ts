/**
 * Shared types + constants for the photo comparison feature.
 * Pure data — no React, no DOM.
 */

export interface Timepoint {
    tp_code: number;
    tp_description: string;
    tp_date_time: string;
}

export interface PhotoType {
    id: string;
    label: string;
    /** Short label shown inside a category group (category is implied). */
    short: string;
    /** Dolphin image-type code; also the URL suffix via `.I${code}`. */
    code: string;
    category: 'facial' | 'occlusal' | 'intraoral';
}

export interface CanvasSizeOption {
    value: string;
    label: string;
}

export interface ToolOption {
    value: number;
    label: string;
}

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
    abort: AbortController;
}

export const KEY_FOR_TOOL: Record<number, ImageKey> = { 1: 'img1', 2: 'img2', 3: 'logo' };
export const TOOL_FOR_KEY: Record<ImageKey, number> = { img1: 1, img2: 2, logo: 3 };
export const IMG_INDEX_FOR_KEY: Record<ImageKey, number> = { img1: 0, img2: 1, logo: 2 };

export const PHOTO_TYPES: PhotoType[] = [
    { id: 'profile', label: 'Facial Profile', short: 'Profile', code: '10', category: 'facial' },
    { id: 'rest', label: 'Facial Rest', short: 'Rest', code: '12', category: 'facial' },
    { id: 'smile', label: 'Facial Smile', short: 'Smile', code: '13', category: 'facial' },
    { id: 'upper', label: 'Occlusal Upper', short: 'Upper', code: '23', category: 'occlusal' },
    { id: 'lower', label: 'Occlusal Lower', short: 'Lower', code: '24', category: 'occlusal' },
    { id: 'right', label: 'Intra-oral Right', short: 'Right', code: '20', category: 'intraoral' },
    { id: 'center', label: 'Intra-oral Center', short: 'Center', code: '22', category: 'intraoral' },
    { id: 'left', label: 'Intra-oral Left', short: 'Left', code: '21', category: 'intraoral' },
];

export const PHOTO_CATEGORIES = ['facial', 'occlusal', 'intraoral'] as const;

export const CANVAS_SIZES: CanvasSizeOption[] = [
    { value: 'auto', label: 'Auto (100%)' },
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
