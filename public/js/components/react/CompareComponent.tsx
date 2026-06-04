/**
 * CompareComponent - Advanced image comparison tool for patient portal
 *
 * Provides sophisticated image comparison with canvas manipulation tools
 * Memoized to prevent unnecessary re-renders when props haven't changed
 */

import React, { useState, useEffect, useMemo, useCallback, useRef, ChangeEvent, FormEvent, CSSProperties } from 'react';
import { formatISODate } from '../../core/utils';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import Modal from './Modal';
import styles from './CompareComponent.module.css';

// Empirical: 4249×9798 (~42 MP) fails inside whatsapp-web.js; 2060×2700 (~5.6 MP) preset is offered.
const MAX_WHATSAPP_PIXELS = 6_000_000;

interface Props {
    personId?: number | null;
    phone?: string;
}

interface Timepoint {
    tp_code: number;
    tp_description: string;
    tp_date_time: string;
}

interface PhotoType {
    id: string;
    label: string;
    code: string;
    category: string;
}

interface CanvasSize {
    value: string;
    label: string;
}

interface Tool {
    value: number;
    label: string;
}

interface Transform {
    x: number;
    y: number;
    scale: number;
    rotation: number;
}

interface TransformState {
    img1: Transform;
    img2: Transform;
    logo: Transform;
}

interface CanvasDimensions {
    width: number;
    height: number;
}

interface AutoImageSize {
    width: number;
    height: number;
}

interface ComparisonHandler {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    images: HTMLImageElement[];
    transform: TransformState;
    orientation: 'vertical' | 'horizontal';
    showBisect: boolean;
    selectedImage: number;
    showLogo: boolean;
    updateDimensions: React.Dispatch<React.SetStateAction<CanvasDimensions>>;
    originalDimensions: CanvasDimensions;
    autoMode: boolean;
    autoScale: number;
    autoImageSize?: AutoImageSize;
    loadImages: (urls: string[]) => Promise<void>;
    resizeCanvasToFitImages: () => void;
    render: () => void;
    renderVertical: () => void;
    renderHorizontal: () => void;
    drawImage: (img: HTMLImageElement, x: number, y: number, width: number, height: number, key: string) => void;
    drawLogo: (img: HTMLImageElement) => void;
    drawBisectLine: () => void;
    moveImage: (direction: string, amount?: number) => void;
    zoomImage: (direction: string) => void;
    rotateImage: (direction: string) => void;
    toggleOrientation: () => void;
    toggleBisect: () => void;
    toggleLogo: () => void;
    reset: () => void;
    toDataURL: () => string;
}

interface ImageState {
    img1: string | null;
    img2: string | null;
    logo: string | null;
}

type ImageKey = 'img1' | 'img2' | 'logo';

interface ImageRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface DrawSize {
    dw: number;
    dh: number;
}

interface Point {
    x: number;
    y: number;
}

interface DragState {
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

const KEY_FOR_TOOL: Record<number, ImageKey> = { 1: 'img1', 2: 'img2', 3: 'logo' };
const TOOL_FOR_KEY: Record<ImageKey, number> = { img1: 1, img2: 2, logo: 3 };
const IMG_INDEX_FOR_KEY: Record<ImageKey, number> = { img1: 0, img2: 1, logo: 2 };

// Mirrors renderVertical / renderHorizontal / drawLogo branches.
function getContainerRect(
    key: ImageKey,
    orientation: 'vertical' | 'horizontal',
    autoMode: boolean,
    autoImageSize: AutoImageSize | undefined,
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

// Mirrors aspect-fit math in drawImage transform path.
function getDrawSize(imgWidth: number, imgHeight: number, containerW: number, containerH: number): DrawSize {
    const aspectRatio = imgWidth / imgHeight;
    const containerRatio = containerW / containerH;
    if (aspectRatio > containerRatio) {
        return { dw: containerW, dh: containerW / aspectRatio };
    }
    return { dw: containerH * aspectRatio, dh: containerH };
}

// Apply M = translate(cx + tx, cy + ty) · rotate(rot) · scale(s) to a local point.
function applyTransform(lx: number, ly: number, cx: number, cy: number, t: Transform): Point {
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

function getImageCorners(rect: ImageRect, drawSize: DrawSize, t: Transform): Point[] {
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

const PHOTO_TYPES: PhotoType[] = [
    { id: 'profile', label: 'Facial Profile', code: '10', category: 'facial' },
    { id: 'rest', label: 'Facial Rest', code: '12', category: 'facial' },
    { id: 'smile', label: 'Facial Smile', code: '13', category: 'facial' },
    { id: 'upper', label: 'Occlusal Upper', code: '23', category: 'occlusal' },
    { id: 'lower', label: 'Occlusal Lower', code: '24', category: 'occlusal' },
    { id: 'right', label: 'Intra-oral Right', code: '20', category: 'intraoral' },
    { id: 'center', label: 'Intra-oral Center', code: '22', category: 'intraoral' },
    { id: 'left', label: 'Intra-oral Left', code: '21', category: 'intraoral' },
];

const CANVAS_SIZES: CanvasSize[] = [
    { value: 'auto', label: 'Auto (100%)' },
    { value: 'auto-50', label: '50% of source' },
    { value: 'auto-25', label: '25% of source' },
    { value: '{"width":1080,"height":1350}', label: 'Post (1080 × 1350)' },
    { value: '{"width":1080,"height":1920}', label: 'Story (1080 × 1920)' },
    { value: '{"width":2060,"height":2700}', label: '2060 × 2700' },
];

// 0 = no selection — bounding box hidden, manipulation buttons disabled.
const TOOLS: Tool[] = [
    { value: 0, label: '— None (Deselect) —' },
    { value: 1, label: 'Image 1' },
    { value: 2, label: 'Image 2' },
    { value: 3, label: 'Logo' },
];

const CompareComponent = ({ personId, phone }: Props) => {
    const toast = useToast();
    const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
    const [selectedTimepoints, setSelectedTimepoints] = useState<number[]>([]);
    const [selectedPhotoType, setSelectedPhotoType] = useState('');
    const [timepointImages, setTimepointImages] = useState<Record<number, string[]>>({});
    const [, setImages] = useState<ImageState>({ img1: null, img2: null, logo: null });
    const [loading, setLoading] = useState(true);
    const [canvasSize, setCanvasSize] = useState('auto');
    const [selectedTool, setSelectedTool] = useState(0);
    const [comparison, setComparison] = useState<ComparisonHandler | null>(null);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState(phone || '');
    const [sendingMessage, setSendingMessage] = useState(false);
    const [showLogo, setShowLogo] = useState(true);
    const [canvasDimensions, setCanvasDimensions] = useState<CanvasDimensions>({ width: 800, height: 600 });
    const [slideshowActive, setSlideshowActive] = useState(false);
    const [slideshowIndex, setSlideshowIndex] = useState(0);

    // Canvas ref for comparison
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const fullscreenRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const isSharingRef = useRef(false);
    const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;
    const [displaySize, setDisplaySize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [, setBoxVersion] = useState(0);
    const bumpBox = useCallback(() => setBoxVersion(v => v + 1), []);

    const deselect = useCallback(() => {
        setSelectedTool(0);
        if (comparison) comparison.selectedImage = 0;
    }, [comparison]);

    const selectTool = useCallback((toolValue: number) => {
        setSelectedTool(toolValue);
        if (comparison) comparison.selectedImage = toolValue;
    }, [comparison]);

    const toggleFullscreen = async () => {
        if (!fullscreenRef.current) return;
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await fullscreenRef.current.requestFullscreen();
            }
        } catch (err) {
            toast.error('Fullscreen not supported: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const buildExportFileName = (): string => {
        const ts = formatISODate();
        return personId ? `comparison_${personId}_${ts}.png` : `comparison_${ts}.png`;
    };

    // Sync conversion from data URI to Blob — preserves the user gesture chain
    // through navigator.share(). Mirrors the share approach used in GridComponent.
    const dataURItoBlob = (dataURI: string): Blob => {
        const [header, data] = dataURI.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
        const binary = atob(data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        return new Blob([array], { type: mime });
    };

    const handleSave = () => {
        if (!comparison) return;
        try {
            const dataURI = comparison.toDataURL();
            const a = document.createElement('a');
            a.href = dataURI;
            a.download = buildExportFileName();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast.success('Comparison saved');
        } catch (err) {
            toast.error('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    // IMPORTANT: Must be synchronous until navigator.share() to preserve user gesture.
    // Pattern lifted from GridComponent.handleNativeShare which is the working reference.
    const handleShare = () => {
        if (isSharingRef.current) return;
        if (!comparison) return;
        if (!canNativeShare) {
            toast.warning('Sharing is not supported on this device');
            return;
        }
        isSharingRef.current = true;
        try {
            const dataURI = comparison.toDataURL();
            const blob = dataURItoBlob(dataURI);
            const file = new File([blob], buildExportFileName(), { type: 'image/png' });
            if (!navigator.canShare({ files: [file] })) {
                toast.warning('Cannot share this file type');
                isSharingRef.current = false;
                return;
            }
            navigator.share({ files: [file] })
                .catch((err: Error) => {
                    if (err.name !== 'AbortError') {
                        toast.error('Failed to share comparison');
                    }
                })
                .finally(() => {
                    isSharingRef.current = false;
                });
        } catch (err) {
            toast.error('Failed to share: ' + (err instanceof Error ? err.message : 'Unknown error'));
            isSharingRef.current = false;
        }
    };

    // A pair is selectable only when the image exists in EVERY selected timepoint.
    // A pending fetch (no entry in timepointImages yet) correctly disables the pair
    // until the fetch resolves — see fetchTimepointImages which returns [] on failure.
    const isPhotoTypeAvailable = useCallback((photoCode: string): boolean => {
        if (selectedTimepoints.length === 0) return true;
        return selectedTimepoints.every(tpCode => {
            const images = timepointImages[tpCode];
            return Array.isArray(images) && images.includes(photoCode);
        });
    }, [selectedTimepoints, timepointImages]);

    const availablePhotoTypes = useMemo(
        () => PHOTO_TYPES.filter(p => {
            if (selectedTimepoints.length === 0) return false;
            return selectedTimepoints.every(tpCode => {
                const images = timepointImages[tpCode];
                return Array.isArray(images) && images.includes(p.code);
            });
        }),
        [selectedTimepoints, timepointImages]
    );

    const startSlideshow = useCallback(async () => {
        if (availablePhotoTypes.length === 0) return;
        setSlideshowIndex(0);
        setSelectedPhotoType(availablePhotoTypes[0].id);
        if (comparison) comparison.reset();
        setSlideshowActive(true);
        if (fullscreenRef.current && !document.fullscreenElement) {
            try { await fullscreenRef.current.requestFullscreen(); } catch { /* fall through */ }
        }
    }, [availablePhotoTypes, comparison]);

    const stepSlideshow = useCallback((delta: 1 | -1) => {
        const next = slideshowIndex + delta;
        if (next < 0 || next >= availablePhotoTypes.length) return;
        setSlideshowIndex(next);
        if (comparison) comparison.reset();
        setSelectedPhotoType(availablePhotoTypes[next].id);
    }, [slideshowIndex, availablePhotoTypes, comparison]);

    const stopSlideshow = useCallback(async () => {
        setSlideshowActive(false);
        if (document.fullscreenElement) {
            try { await document.exitFullscreen(); } catch { /* ignore */ }
        }
    }, []);

    // Returns the list of image codes ('10','12',...) available for the given timepoint.
    // Empty array on failure — callers use it to disable photo types whose image is missing.
    const fetchTimepointImages = useCallback(async (tpCode: number): Promise<string[]> => {
        try {
            const response = await fetch(`/api/patients/${personId}/timepoints/${tpCode}/images`);
            if (!response.ok) return [];
            return await response.json() as string[];
        } catch {
            return [];
        }
    }, [personId]);

    const loadTimepoints = useCallback(async () => {
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/patients/${personId}/timepoints`);
            if (!response.ok) throw new Error('Failed to load timepoints');

            const data: Timepoint[] = await response.json();
            setTimepoints(data);

            // Auto-select first and last timepoints (skip tp_code 0)
            let autoSelected: number[] = [];
            if (data.length >= 2) {
                const validTimepoints = data.filter(tp => tp.tp_code > 0);

                if (validTimepoints.length >= 2) {
                    autoSelected = [validTimepoints[0].tp_code, validTimepoints[validTimepoints.length - 1].tp_code];
                } else if (validTimepoints.length === 1 && data.length >= 2) {
                    autoSelected = [data[0].tp_code, data[1].tp_code];
                }
            }

            if (autoSelected.length > 0) {
                setSelectedTimepoints(autoSelected);
                // Pre-fetch image lists so isPhotoTypeAvailable can correctly disable
                // photo types missing in either timepoint on initial render.
                const results = await Promise.all(autoSelected.map(tp => fetchTimepointImages(tp)));
                setTimepointImages(prev => {
                    const next = { ...prev };
                    autoSelected.forEach((tp, i) => { next[tp] = results[i]; });
                    return next;
                });
            }
        } catch (err) {
            console.error('Error loading timepoints:', err);
            toast.error('Failed to load timepoints: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }, [personId, fetchTimepointImages, toast]);

    const initializeComparison = useCallback(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        // Create comparison handler (keeping original complex logic)
        const comparisonHandler: ComparisonHandler = {
            canvas: canvas,
            context: context,
            images: [],
            transform: {
                img1: { x: 0, y: 0, scale: 1, rotation: 0 },
                img2: { x: 0, y: 0, scale: 1, rotation: 0 },
                logo: { x: 0, y: 0, scale: 1, rotation: 0 }
            },
            orientation: 'vertical',
            showBisect: false,
            selectedImage: 0,
            showLogo: showLogo,
            updateDimensions: setCanvasDimensions,
            originalDimensions: {
                width: canvas.width,
                height: canvas.height
            },
            autoMode: true,
            autoScale: 1,

            loadImages: async function(urls: string[]) {
                this.images = [];
                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    const img = new Image();

                    try {
                        await new Promise<void>((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                reject(new Error(`Timeout loading image: ${url}`));
                            }, 10000);

                            img.onload = () => {
                                clearTimeout(timeout);
                                resolve();
                            };

                            img.onerror = () => {
                                clearTimeout(timeout);
                                console.error(`Image ${i} failed to load:`, url);
                                reject(new Error(`Failed to load image: ${url}`));
                            };

                            img.src = url;
                        });

                        this.images.push(img);
                    } catch (error) {
                        console.error(`Error loading image ${url}:`, error);
                        return;
                    }
                }

                // Auto-resize canvas if in auto mode
                if (this.autoMode) {
                    this.resizeCanvasToFitImages();
                }

                this.render();
            },

            resizeCanvasToFitImages: function() {
                if (this.images.length < 2) return;

                const img1 = this.images[0];
                const img2 = this.images[1];

                if (!img1.complete || !img2.complete) return;

                // Simple approach: use the larger dimensions to ensure both fit without distortion
                const containerWidth = Math.max(img1.width, img2.width);
                const containerHeight = Math.max(img1.height, img2.height);

                let canvasWidth: number, canvasHeight: number;

                if (this.orientation === 'vertical') {
                    canvasWidth = containerWidth;
                    canvasHeight = containerHeight * 2;
                } else {
                    canvasWidth = containerWidth * 2;
                    canvasHeight = containerHeight;
                }

                const scale = this.autoScale ?? 1;
                if (scale !== 1) {
                    canvasWidth = Math.round(canvasWidth * scale);
                    canvasHeight = Math.round(canvasHeight * scale);
                }

                // Store the common container size for rendering (scaled to match canvas)
                this.autoImageSize = {
                    width: Math.round(containerWidth * scale),
                    height: Math.round(containerHeight * scale)
                };

                // Apply the new dimensions
                this.canvas.width = canvasWidth;
                this.canvas.height = canvasHeight;

                // Update React state
                if (this.updateDimensions) {
                    this.updateDimensions({ width: canvasWidth, height: canvasHeight });
                }
            },

            render: function() {
                if (this.images.length < 2) return;

                const canvas = this.canvas;
                const ctx = this.context;

                if (!canvas || !ctx) return;

                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (this.orientation === 'vertical') {
                    this.renderVertical();
                } else {
                    this.renderHorizontal();
                }

                if (this.showBisect) {
                    this.drawBisectLine();
                }
            },

            renderVertical: function() {
                const canvas = this.canvas;

                if (this.autoMode && this.images.length >= 2 && this.autoImageSize) {
                    // In auto mode, use common smallest dimensions for both images
                    const commonWidth = this.autoImageSize.width;
                    const commonHeight = this.autoImageSize.height;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, commonWidth, commonHeight, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], 0, commonHeight, commonWidth, commonHeight, 'img2');
                    }
                } else {
                    // Fixed mode - use split layout
                    const halfHeight = canvas.height / 2;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, canvas.width, halfHeight, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], 0, halfHeight, canvas.width, halfHeight, 'img2');
                    }
                }

                if (this.images[2] && this.showLogo) {
                    this.drawLogo(this.images[2]);
                }
            },

            renderHorizontal: function() {
                const canvas = this.canvas;

                if (this.autoMode && this.images.length >= 2 && this.autoImageSize) {
                    // In auto mode, give each image a container but let them maintain aspect ratio
                    const containerWidth = this.autoImageSize.width;
                    const containerHeight = this.autoImageSize.height;

                    if (this.images[0]) {
                        // First image gets left container
                        this.drawImage(this.images[0], 0, 0, containerWidth, containerHeight, 'img1');
                    }
                    if (this.images[1]) {
                        // Second image gets right container
                        this.drawImage(this.images[1], containerWidth, 0, containerWidth, containerHeight, 'img2');
                    }
                } else {
                    // Fixed mode - use split layout
                    const halfWidth = canvas.width / 2;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, halfWidth, canvas.height, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], halfWidth, 0, halfWidth, canvas.height, 'img2');
                    }
                }

                if (this.images[2] && this.showLogo) {
                    this.drawLogo(this.images[2]);
                }
            },

            drawImage: function(img: HTMLImageElement, x: number, y: number, width: number, height: number, key: string) {
                const ctx = this.context;
                const transform = this.transform[key as keyof TransformState];

                if (!img.complete || img.naturalWidth === 0) return;

                // In auto mode, prioritize aspect ratio preservation over transforms
                if (this.autoMode && (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0)) {
                    // Pure aspect ratio preservation without transforms
                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;

                    let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
                    if (aspectRatio > containerRatio) {
                        // Image is wider - fit to width, center vertically
                        drawWidth = width;
                        drawHeight = width / aspectRatio;
                        drawX = x;
                        drawY = y + (height - drawHeight) / 2;
                    } else {
                        // Image is taller - fit to height, center horizontally
                        drawHeight = height;
                        drawWidth = height * aspectRatio;
                        drawX = x + (width - drawWidth) / 2;
                        drawY = y;
                    }

                    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
                } else {
                    // Standard mode with transforms - clip to container so the
                    // image cannot bleed into the other half of the canvas.
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x, y, width, height);
                    ctx.clip();

                    ctx.translate(x + width / 2 + transform.x, y + height / 2 + transform.y);
                    ctx.rotate(transform.rotation * Math.PI / 180);
                    ctx.scale(transform.scale, transform.scale);

                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;

                    let drawWidth: number, drawHeight: number;
                    if (aspectRatio > containerRatio) {
                        drawWidth = width;
                        drawHeight = width / aspectRatio;
                    } else {
                        drawHeight = height;
                        drawWidth = height * aspectRatio;
                    }

                    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
                    ctx.restore();
                }
            },

            drawLogo: function(img: HTMLImageElement) {
                const ctx = this.context;
                const canvas = this.canvas;
                const transform = this.transform.logo;

                // In auto mode, use a reasonable fixed size relative to canvas
                let logoWidth: number, logoHeight: number;
                if (this.autoMode) {
                    // Use a percentage of canvas width for reasonable logo size
                    logoWidth = canvas.width * 0.15; // 15% of canvas width
                    logoHeight = (img.height * logoWidth) / img.width;
                } else {
                    // Original logic for fixed modes
                    logoWidth = img.width / 6;
                    logoHeight = (img.height * logoWidth) / img.width;
                }

                const logoX = canvas.width / 2 - logoWidth / 2 + transform.x;
                const logoY = canvas.height / 2 - logoHeight / 1.3 + transform.y;

                ctx.save();
                ctx.translate(logoX + logoWidth / 2, logoY + logoHeight / 2);
                ctx.rotate(transform.rotation * Math.PI / 180);
                ctx.scale(transform.scale, transform.scale);
                ctx.drawImage(img, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight);
                ctx.restore();
            },

            drawBisectLine: function() {
                const ctx = this.context;
                const canvas = this.canvas;

                // Scale stroke and dash to canvas size so the line is visible
                // when the canvas is much larger than its CSS-displayed size.
                const refDim = Math.max(canvas.width, canvas.height);
                const lineWidth = Math.max(2, Math.round(refDim / 400));
                const dashOn = Math.max(10, Math.round(refDim / 80));
                const dashOff = Math.max(5, Math.round(refDim / 160));
                const crossArm = Math.max(12, Math.round(refDim / 30));

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
                ctx.lineWidth = lineWidth;

                // Dashed bisecting line splitting the two halves
                ctx.setLineDash([dashOn, dashOff]);
                ctx.beginPath();
                if (this.orientation === 'vertical') {
                    ctx.moveTo(0, canvas.height / 2);
                    ctx.lineTo(canvas.width, canvas.height / 2);
                } else {
                    ctx.moveTo(canvas.width / 2, 0);
                    ctx.lineTo(canvas.width / 2, canvas.height);
                }
                ctx.stroke();

                // Solid centered cross in each half — alignment reference markers
                ctx.setLineDash([]);
                const drawCross = (cx: number, cy: number) => {
                    ctx.beginPath();
                    ctx.moveTo(cx - crossArm, cy);
                    ctx.lineTo(cx + crossArm, cy);
                    ctx.moveTo(cx, cy - crossArm);
                    ctx.lineTo(cx, cy + crossArm);
                    ctx.stroke();
                };
                if (this.orientation === 'vertical') {
                    drawCross(canvas.width / 2, canvas.height / 4);
                    drawCross(canvas.width / 2, (canvas.height * 3) / 4);
                } else {
                    drawCross(canvas.width / 4, canvas.height / 2);
                    drawCross((canvas.width * 3) / 4, canvas.height / 2);
                }

                ctx.restore();
            },

            // Control methods
            moveImage: function(direction: string, amount: number = 10) {
                const key = KEY_FOR_TOOL[this.selectedImage];
                if (!key) return;
                const transform = this.transform[key];

                switch (direction) {
                    case 'left': transform.x -= amount; break;
                    case 'right': transform.x += amount; break;
                    case 'up': transform.y -= amount; break;
                    case 'down': transform.y += amount; break;
                }
                this.render();
            },

            zoomImage: function(direction: string) {
                const key = KEY_FOR_TOOL[this.selectedImage];
                if (!key) return;
                const transform = this.transform[key];
                const factor = direction === 'in' ? 1.1 : 0.9;

                transform.scale *= factor;
                transform.scale = Math.max(0.1, Math.min(5, transform.scale));
                this.render();
            },

            rotateImage: function(direction: string) {
                const key = KEY_FOR_TOOL[this.selectedImage];
                if (!key) return;
                const transform = this.transform[key];
                const amount = direction === 'clockwise' ? 1 : -1;

                transform.rotation += amount;
                this.render();
            },

            toggleOrientation: function() {
                this.orientation = this.orientation === 'vertical' ? 'horizontal' : 'vertical';

                // Auto-resize canvas if in auto mode
                if (this.autoMode && this.images.length >= 2) {
                    this.resizeCanvasToFitImages();
                }

                this.render();
            },

            toggleBisect: function() {
                this.showBisect = !this.showBisect;
                this.render();
            },

            toggleLogo: function() {
                this.showLogo = !this.showLogo;
                this.render();
            },


            reset: function() {
                this.transform = {
                    img1: { x: 0, y: 0, scale: 1, rotation: 0 },
                    img2: { x: 0, y: 0, scale: 1, rotation: 0 },
                    logo: { x: 0, y: 0, scale: 1, rotation: 0 }
                };

                // In auto mode, recompute canvas + autoImageSize from the actual
                // images so reset restores the same layout the user first saw.
                // Falling back to originalDimensions here would leave a stale
                // autoImageSize and draw the images huge on a tiny canvas.
                if (this.autoMode && this.images.length >= 2) {
                    this.resizeCanvasToFitImages();
                } else if (this.originalDimensions) {
                    const canvas = this.canvas;
                    canvas.width = this.originalDimensions.width;
                    canvas.height = this.originalDimensions.height;
                    if (this.updateDimensions) {
                        this.updateDimensions({
                            width: this.originalDimensions.width,
                            height: this.originalDimensions.height
                        });
                    }
                }

                this.render();
            },

            toDataURL: function() {
                return this.canvas.toDataURL('image/png');
            }
        };

        setComparison(comparisonHandler);
    }, [showLogo]);

    const loadComparisonImages = useCallback(async () => {
        if (!comparison || selectedTimepoints.length !== 2 || !selectedPhotoType) return;

        try {
            setLoading(true);

            const photoType = PHOTO_TYPES.find(p => p.id === selectedPhotoType);
            if (!photoType) throw new Error('Invalid photo type');

            const sortedTimepoints = [...selectedTimepoints].sort((a, b) => a - b);

            const getCategoryCode = (photoId: string): string => {
                const categoryMap: Record<string, string> = {
                    'profile': '.I10', 'rest': '.I12', 'smile': '.I13',
                    'upper': '.I23', 'lower': '.I24', 'right': '.I20',
                    'center': '.I22', 'left': '.I21'
                };
                return categoryMap[photoId] || '';
            };

            const categoryCode = getCategoryCode(selectedPhotoType);

            const urls = [
                `/DolImgs/${personId}0${sortedTimepoints[0]}${categoryCode}`,
                `/DolImgs/${personId}0${sortedTimepoints[1]}${categoryCode}`,
                '/images/logo_white.png'
            ];

            await comparison.loadImages(urls);
            setImages({
                img1: urls[0],
                img2: urls[1],
                logo: urls[2]
            });

        } catch (err) {
            console.error('Error loading comparison images:', err);
            toast.error('Failed to load comparison images: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }, [comparison, selectedTimepoints, selectedPhotoType, personId, toast]);

    useEffect(() => {
        loadTimepoints();
    }, [loadTimepoints]);

    useEffect(() => {
        if (canvasRef.current && !comparison) {
            initializeComparison();
        }
    }, [comparison, initializeComparison]);

    useEffect(() => {
        if (selectedTimepoints.length === 2 && selectedPhotoType) {
            loadComparisonImages();
        }
    }, [selectedTimepoints, selectedPhotoType, loadComparisonImages]);

    // Clear selectedPhotoType if the user changes a timepoint and the previously-
    // chosen photo type is no longer present in both. Prevents the canvas from
    // attempting to render a missing image (404).
    useEffect(() => {
        if (!selectedPhotoType || selectedTimepoints.length !== 2) return;
        const current = PHOTO_TYPES.find(p => p.id === selectedPhotoType);
        if (current && !isPhotoTypeAvailable(current.code)) {
            setSelectedPhotoType('');
        }
    }, [selectedTimepoints, selectedPhotoType, isPhotoTypeAvailable]);

    useEffect(() => {
        if (comparison) {
            comparison.showLogo = showLogo;
            comparison.render();
        }
    }, [showLogo, comparison]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDisplaySize({ width, height });
                }
            }
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || !comparison) return;
        const handler = (e: WheelEvent) => {
            if (comparison.images.length < 2) return;
            if (comparison.selectedImage === 0) return;
            e.preventDefault();
            comparison.zoomImage(e.deltaY < 0 ? 'in' : 'out');
            bumpBox();
        };
        wrapper.addEventListener('wheel', handler, { passive: false });
        return () => wrapper.removeEventListener('wheel', handler);
    }, [comparison, bumpBox]);

    // canvasRef is set on first commit; one-shot read after mount.
    useEffect(() => {
        if (canvasRef.current) {
            setCanvasDimensions({
                width: canvasRef.current.width,
                height: canvasRef.current.height
            });
        }
    }, []);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const inFullscreen = document.fullscreenElement === fullscreenRef.current;
            setIsFullscreen(inFullscreen);
            // System gesture / F11 exit while slideshow was active: end the slideshow too
            if (!inFullscreen) setSlideshowActive(false);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (slideshowActive) {
                if (e.key === 'ArrowRight') { e.preventDefault(); stepSlideshow(1); return; }
                if (e.key === 'ArrowLeft')  { e.preventDefault(); stepSlideshow(-1); return; }
                if (e.key === 'Escape')     { e.preventDefault(); stopSlideshow(); return; }
            } else if (e.key === 'Escape') {
                deselect();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [slideshowActive, deselect, stepSlideshow, stopSlideshow]);

    const handleTimepointSelection = async (tpCode: number, checked: boolean) => {
        if (checked) {
            if (selectedTimepoints.length >= 2) {
                toast.warning('You can only select two timepoints for comparison');
                return;
            }

            if (timepointImages[tpCode]) {
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
                return;
            }

            const images = await fetchTimepointImages(tpCode);
            setTimepointImages(prev => ({ ...prev, [tpCode]: images }));
            setSelectedTimepoints([...selectedTimepoints, tpCode]);
        } else {
            setSelectedTimepoints(selectedTimepoints.filter(tp => tp !== tpCode));
        }
    };

    const handleCanvasSizeChange = (value: string) => {
        setCanvasSize(value);

        if (canvasRef.current && comparison) {
            if (value === 'auto' || value === 'auto-50' || value === 'auto-25') {
                comparison.autoMode = true;
                comparison.autoScale = value === 'auto-50' ? 0.5 : value === 'auto-25' ? 0.25 : 1;
                if (comparison.images.length >= 2) {
                    comparison.resizeCanvasToFitImages();
                } else {
                    // Default size when no images loaded yet
                    canvasRef.current.width = 800;
                    canvasRef.current.height = 600;
                    setCanvasDimensions({ width: 800, height: 600 });
                }
            } else {
                // Disable auto mode and use fixed size
                comparison.autoMode = false;
                comparison.autoScale = 1;
                const size = JSON.parse(value) as CanvasDimensions;
                canvasRef.current.width = size.width;
                canvasRef.current.height = size.height;
                setCanvasDimensions({ width: size.width, height: size.height });
                comparison.originalDimensions = { width: size.width, height: size.height };
            }

            comparison.render();
        }
    };

    const handleWhatsAppSend = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!phoneNumber || !comparison) return;

        try {
            setSendingMessage(true);

            const imageData = comparison.toDataURL();

            const response = await fetch('/api/wa/sendmedia', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneNumber, file: imageData })
            });

            if (response.ok) {
                toast.success('Image sent successfully!');
                setShowWhatsAppModal(false);
            } else {
                throw new Error('Failed to send image');
            }
        } catch (err) {
            console.error('Error sending WhatsApp message:', err);
            toast.error('Failed to send image: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setSendingMessage(false);
        }
    };

    const clientToCanvas = (clientX: number, clientY: number): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
        return {
            x: ((clientX - rect.left) * canvas.width) / rect.width,
            y: ((clientY - rect.top) * canvas.height) / rect.height,
        };
    };

    const getRectForKey = (key: ImageKey): ImageRect | null => {
        if (!comparison) return null;
        const img = comparison.images[IMG_INDEX_FOR_KEY[key]];
        if (!img || !img.complete) return null;
        return getContainerRect(
            key,
            comparison.orientation,
            comparison.autoMode,
            comparison.autoImageSize,
            comparison.canvas.width,
            comparison.canvas.height,
            img.width,
            img.height,
        );
    };

    const startDrag = (e: React.PointerEvent, mode: DragState['mode'], key: ImageKey) => {
        if (!comparison) return;
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
            startTransform: { ...comparison.transform[key] },
            abort: ctrl,
        };
        dragRef.current = drag;

        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== drag.pointerId) return;
            const cur = clientToCanvas(ev.clientX, ev.clientY);
            const t = comparison.transform[drag.key];
            if (drag.mode === 'translate') {
                t.x = drag.startTransform.x + (cur.x - drag.startCanvasX);
                t.y = drag.startTransform.y + (cur.y - drag.startCanvasY);
            } else if (drag.mode === 'scale') {
                const cxAbs = drag.rectCx + drag.startTransform.x;
                const cyAbs = drag.rectCy + drag.startTransform.y;
                const startDist = Math.hypot(drag.startCanvasX - cxAbs, drag.startCanvasY - cyAbs);
                if (startDist < 1) return;
                const curDist = Math.hypot(cur.x - cxAbs, cur.y - cyAbs);
                t.scale = Math.max(0.1, Math.min(5, drag.startTransform.scale * (curDist / startDist)));
            } else {
                const cxAbs = drag.rectCx + drag.startTransform.x;
                const cyAbs = drag.rectCy + drag.startTransform.y;
                const startAngle = Math.atan2(drag.startCanvasY - cyAbs, drag.startCanvasX - cxAbs);
                const curAngle = Math.atan2(cur.y - cyAbs, cur.x - cxAbs);
                t.rotation = drag.startTransform.rotation + ((curAngle - startAngle) * 180) / Math.PI;
            }
            comparison.render();
            bumpBox();
        };
        const onUp = (ev: PointerEvent) => {
            if (ev.pointerId !== drag.pointerId) return;
            ctrl.abort();
            dragRef.current = null;
            bumpBox();
        };

        window.addEventListener('pointermove', onMove, { signal: ctrl.signal });
        window.addEventListener('pointerup', onUp, { signal: ctrl.signal });
        window.addEventListener('pointercancel', onUp, { signal: ctrl.signal });
    };

    const renderOverlay = () => {
        if (!comparison || comparison.images.length < 2) return null;

        const dpi = canvasDimensions.width / Math.max(1, displaySize.width);
        const handlePx = 10 * dpi;
        const rotPx = 30 * dpi;
        const strokeW = 1.5 * dpi;
        const dashOn = 5 * dpi;
        const dashOff = 4 * dpi;

        const allKeys: ImageKey[] = ['img1', 'img2', 'logo'];
        const selectedKey: ImageKey | null = KEY_FOR_TOOL[selectedTool] ?? null;

        type Geom = { rect: ImageRect; drawSize: DrawSize; corners: Point[]; transform: Transform };
        const geom = new Map<ImageKey, Geom>();
        for (const key of allKeys) {
            if (key === 'logo' && !comparison.showLogo) continue;
            const img = comparison.images[IMG_INDEX_FOR_KEY[key]];
            if (!img || !img.complete) continue;
            const rect = getContainerRect(
                key,
                comparison.orientation,
                comparison.autoMode,
                comparison.autoImageSize,
                comparison.canvas.width,
                comparison.canvas.height,
                img.width,
                img.height,
            );
            if (!rect) continue;
            const drawSize = getDrawSize(img.width, img.height, rect.w, rect.h);
            const transform = comparison.transform[key];
            const corners = getImageCorners(rect, drawSize, transform);
            geom.set(key, { rect, drawSize, corners, transform });
        }

        const ordered: ImageKey[] = selectedKey
            ? [...allKeys.filter(k => k !== selectedKey), selectedKey]
            : allKeys;
        const stroke = 'rgba(0, 123, 255, 0.95)';

        // Dynamic dash pattern scales with DPI; static cursor + hover rules live in the module.
        const rotateDashStyle = { '--rotate-dash': `${dashOn * 0.5} ${dashOff * 0.5}` } as CSSProperties;

        return (
            <svg
                ref={svgRef}
                className={styles.svgOverlay}
                viewBox={`0 0 ${canvasDimensions.width} ${canvasDimensions.height}`}
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
                                    if (!comparison) return;
                                    selectTool(TOOL_FOR_KEY[key]);
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
                                stroke={stroke}
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
                                    stroke={stroke}
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
                                    stroke={stroke}
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
                                stroke="rgba(220, 53, 69, 0.95)"
                                strokeWidth={strokeW}
                                pointerEvents="all"
                                style={{ cursor: 'pointer' }}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    deselect();
                                }}
                            >
                                <title>Deselect (Esc)</title>
                            </circle>
                            <line
                                x1={closeBtnPos.x - closeR * 0.45}
                                y1={closeBtnPos.y - closeR * 0.45}
                                x2={closeBtnPos.x + closeR * 0.45}
                                y2={closeBtnPos.y + closeR * 0.45}
                                stroke="rgba(220, 53, 69, 0.95)"
                                strokeWidth={strokeW * 1.5}
                                pointerEvents="none"
                            />
                            <line
                                x1={closeBtnPos.x + closeR * 0.45}
                                y1={closeBtnPos.y - closeR * 0.45}
                                x2={closeBtnPos.x - closeR * 0.45}
                                y2={closeBtnPos.y + closeR * 0.45}
                                stroke="rgba(220, 53, 69, 0.95)"
                                strokeWidth={strokeW * 1.5}
                                pointerEvents="none"
                            />
                        </g>
                    );
                })}
            </svg>
        );
    };

    if (loading && timepoints.length === 0) {
        return (
            <div className="loading-spinner">
                Loading compare page...
            </div>
        );
    }

    const isReady = selectedTimepoints.length === 2 && Boolean(selectedPhotoType);

    return (
        <div className={styles.container}>
            <div className={cn(styles.statusBanner, isReady ? styles.statusBannerReady : styles.statusBannerPending)}>
                <strong>Status: </strong>
                <span>
                    {selectedTimepoints.length === 0 ? 'Select 2 timepoints to begin' :
                    selectedTimepoints.length === 1 ? 'Select 1 more timepoint' :
                    selectedTimepoints.length === 2 && !selectedPhotoType ? 'Now select a photo type' :
                    isReady ? 'Ready! Images should appear in canvas below' :
                    'Please select timepoints and photo type'}
                </span>
            </div>

            <div className={styles.mainArea}>
                <div
                    ref={fullscreenRef}
                    onPointerDown={() => deselect()}
                    className={isFullscreen ? styles.canvasPanelFullscreen : styles.canvasPanel}
                >
                    <div className={cn(styles.canvasToolbar, slideshowActive && styles.canvasToolbarHidden)}>
                        {canNativeShare && (
                            <button
                                onClick={handleShare}
                                title="Share comparison"
                                aria-label="Share comparison"
                                className={styles.toolbarButton}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
                                </svg>
                            </button>
                        )}
                        {(() => {
                            const canSlideshow = selectedTimepoints.length === 2 && availablePhotoTypes.length > 0;
                            return (
                                <button
                                    onClick={startSlideshow}
                                    disabled={!canSlideshow}
                                    title={canSlideshow
                                        ? `Start slideshow (${availablePhotoTypes.length} pair${availablePhotoTypes.length === 1 ? '' : 's'})`
                                        : 'Select two timepoints with shared images to enable slideshow'}
                                    aria-label="Start pair slideshow"
                                    className={cn(styles.toolbarButton, styles.toolbarButtonLarge)}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </button>
                            );
                        })()}
                        <button
                            onClick={toggleFullscreen}
                            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
                            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                            className={cn(styles.toolbarButton, styles.toolbarButtonLarge)}
                        >
                            {isFullscreen ? '✕' : '⛶'}
                        </button>
                    </div>
                    {slideshowActive && (
                        <>
                            <button
                                onClick={stopSlideshow}
                                title="Close slideshow (Esc)"
                                aria-label="Close slideshow"
                                className={styles.slideshowClose}
                            >✕</button>
                            <button
                                onClick={() => stepSlideshow(-1)}
                                disabled={slideshowIndex === 0}
                                title="Previous pair (←)"
                                aria-label="Previous pair"
                                className={cn(styles.slideshowArrow, styles.slideshowPrev)}
                            >‹</button>
                            <button
                                onClick={() => stepSlideshow(1)}
                                disabled={slideshowIndex === availablePhotoTypes.length - 1}
                                title="Next pair (→)"
                                aria-label="Next pair"
                                className={cn(styles.slideshowArrow, styles.slideshowNext)}
                            >›</button>
                            <div className={styles.slideshowCounter}>
                                {slideshowIndex + 1} / {availablePhotoTypes.length}
                            </div>
                        </>
                    )}
                    <div
                        ref={wrapperRef}
                        className={isFullscreen ? styles.canvasWrapperFullscreen : styles.canvasWrapper}
                    >
                        <canvas
                            ref={canvasRef}
                            id="comparison-canvas"
                            width={800}
                            height={600}
                            className={isFullscreen ? styles.canvasElFullscreen : styles.canvasEl}
                        />
                        {renderOverlay()}
                    </div>
                </div>

                <div className={cn(styles.sidePanel, styles.controlsPanel)}>
                    <h3 className={styles.panelHeading}>
                        Canvas Controls
                    </h3>

                    <div className={styles.dimensionsBox}>
                        <div className={styles.dimensionsLabel}>
                            Canvas Size
                        </div>
                        <div className={styles.dimensionsValue}>
                            {canvasDimensions.width} × {canvasDimensions.height}
                        </div>
                    </div>

                    <div className={styles.controlGroup}>
                        <label className={styles.controlLabel}>
                            Canvas Size:
                        </label>
                        <select
                            value={canvasSize}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCanvasSizeChange(e.target.value)}
                            title="Choose canvas dimensions - Auto fits to container, other options set specific pixel dimensions for social media"
                            className="form-control"
                        >
                            {CANVAS_SIZES.map(size => (
                                <option key={size.value} value={size.value}>
                                    {size.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.controlGroup}>
                        <label className={styles.controlLabel}>
                            Selected Tool:
                        </label>
                        <select
                            value={selectedTool}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => selectTool(Number(e.target.value))}
                            title="Choose which element to manipulate - Image 1 (top/left), Image 2 (bottom/right), or Logo (overlay). 'None' deselects."
                            className="form-control"
                        >
                            {TOOLS.map(tool => (
                                <option key={tool.value} value={tool.value}>
                                    {tool.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.controlGroup}>
                        <label className={styles.controlLabelCentered}>
                            Move Selected Image:
                        </label>
                        {(() => {
                            const hasSelection = selectedTool !== 0;
                            const disabledTitle = (base: string) =>
                                hasSelection ? base : 'Select an image first (click a photo or use the dropdown)';
                            return (
                                <div className={styles.movementGrid}>
                                    <div />
                                    <button
                                        onClick={() => comparison && comparison.moveImage('up')}
                                        disabled={!hasSelection}
                                        title={disabledTitle('Move Up - Move the selected image upward')}
                                        className={styles.movementButton}
                                    >
                                        ↑
                                    </button>
                                    <div />
                                    <button
                                        onClick={() => comparison && comparison.moveImage('left')}
                                        disabled={!hasSelection}
                                        title={disabledTitle('Move Left - Move the selected image to the left')}
                                        className={styles.movementButton}
                                    >
                                        ←
                                    </button>
                                    <div className={styles.movementCenter}>
                                        ⊕
                                    </div>
                                    <button
                                        onClick={() => comparison && comparison.moveImage('right')}
                                        disabled={!hasSelection}
                                        title={disabledTitle('Move Right - Move the selected image to the right')}
                                        className={styles.movementButton}
                                    >
                                        →
                                    </button>
                                    <div />
                                    <button
                                        onClick={() => comparison && comparison.moveImage('down')}
                                        disabled={!hasSelection}
                                        title={disabledTitle('Move Down - Move the selected image downward')}
                                        className={styles.movementButton}
                                    >
                                        ↓
                                    </button>
                                    <div />
                                </div>
                            );
                        })()}
                    </div>

                    <div className={styles.controlsGrid}>
                        <button
                            onClick={() => comparison && selectedTool !== 0 && comparison.zoomImage('in')}
                            disabled={selectedTool === 0}
                            title={selectedTool === 0 ? 'Select an image first (click a photo or use the dropdown)' : 'Zoom In - Enlarge the selected image'}
                            className={cn('btn', 'btn-primary', styles.controlButtonIcon)}
                        >
                            🔍+
                        </button>
                        <button
                            onClick={() => comparison && selectedTool !== 0 && comparison.zoomImage('out')}
                            disabled={selectedTool === 0}
                            title={selectedTool === 0 ? 'Select an image first (click a photo or use the dropdown)' : 'Zoom Out - Shrink the selected image'}
                            className={cn('btn', 'btn-info', styles.controlButtonIcon)}
                        >
                            🔍-
                        </button>
                        <button
                            onClick={() => comparison && selectedTool !== 0 && comparison.rotateImage('clockwise')}
                            disabled={selectedTool === 0}
                            title={selectedTool === 0 ? 'Select an image first (click a photo or use the dropdown)' : 'Rotate Clockwise - Rotate the selected image 1° clockwise'}
                            className={cn('btn', 'btn-warning', styles.controlButtonIcon)}
                            aria-label="Rotate Clockwise"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-3.2-6.9" />
                                <polyline points="21 4 21 10 15 10" />
                            </svg>
                        </button>
                        <button
                            onClick={() => comparison && selectedTool !== 0 && comparison.rotateImage('counterclockwise')}
                            disabled={selectedTool === 0}
                            title={selectedTool === 0 ? 'Select an image first (click a photo or use the dropdown)' : 'Rotate Counter-Clockwise - Rotate the selected image 1° counter-clockwise'}
                            className={cn('btn', 'btn-warning', styles.controlButtonIcon)}
                            aria-label="Rotate Counter-Clockwise"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 12a9 9 0 1 0 3.2-6.9" />
                                <polyline points="3 4 3 10 9 10" />
                            </svg>
                        </button>
                        <button
                            onClick={() => comparison && comparison.toggleOrientation()}
                            title="Toggle Layout - Switch between vertical and horizontal image arrangement"
                            className={cn('btn', 'btn-success', styles.controlButtonIcon)}
                            aria-label="Toggle Layout Orientation"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="3" width="7" height="18" rx="1.2" />
                                <rect x="14" y="3" width="7" height="18" rx="1.2" />
                            </svg>
                        </button>
                        <button
                            onClick={() => comparison && comparison.toggleBisect()}
                            title="Toggle Bisect Line - Show/hide alignment line between images"
                            className={cn('btn', 'btn-danger', styles.controlButtonIcon)}
                        >
                            ═
                        </button>
                        <button
                            onClick={() => {
                                setShowLogo(!showLogo);
                                if (comparison) {
                                    comparison.toggleLogo();
                                }
                            }}
                            title={showLogo ? 'Hide Logo - Remove logo from comparison' : 'Show Logo - Add logo to comparison'}
                            className={cn('btn', showLogo ? 'btn-warning' : 'btn-success', styles.controlButton)}
                        >
                            {showLogo ? 'Hide Logo' : 'Show Logo'}
                        </button>
                        <button
                            onClick={() => comparison && comparison.reset()}
                            title="Reset All - Return all images to their original position, size, and rotation"
                            className={cn('btn', 'btn-light', styles.controlButton)}
                        >
                            Reset
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!comparison}
                            title="Save - Download the comparison image as a PNG file"
                            className={cn('btn', 'btn-primary', styles.controlButton)}
                        >
                            Save
                        </button>
                        {(() => {
                            const pixelCount = canvasDimensions.width * canvasDimensions.height;
                            const isSendable = pixelCount <= MAX_WHATSAPP_PIXELS;
                            return (
                                <button
                                    onClick={() => setShowWhatsAppModal(true)}
                                    disabled={!isSendable}
                                    title={isSendable
                                        ? "Send to WhatsApp - Export the comparison image and send via WhatsApp"
                                        : `Image too large for WhatsApp (${canvasDimensions.width}×${canvasDimensions.height}, ${(pixelCount / 1_000_000).toFixed(1)} MP). Choose a smaller size from the dropdown.`}
                                    className={cn('btn', styles.controlButton, styles.whatsappBrandButton)}
                                >
                                    WhatsApp
                                </button>
                            );
                        })()}
                    </div>
                </div>

                <div className={cn(styles.sidePanel, styles.selectionPanel)}>
                    <h3 className={styles.panelHeadingCentered}>
                        Image Selection
                    </h3>

                    <div className={styles.stepBox}>
                        <h4 className={styles.stepHeader}>
                            <span className={cn(styles.stepNumber, selectedTimepoints.length === 2 && styles.stepNumberComplete)}>
                                1
                            </span>
                            <span>Select 2 Timepoints</span>
                        </h4>
                        <div className={styles.timepointList}>
                            {timepoints.map(tp => (
                                <label
                                    key={tp.tp_code}
                                    className={cn(styles.checkboxRow, selectedTimepoints.includes(tp.tp_code) && styles.checkboxRowSelected)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTimepoints.includes(tp.tp_code)}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleTimepointSelection(tp.tp_code, e.target.checked)}
                                        className={styles.checkboxInput}
                                    />
                                    <span>
                                        {tp.tp_description} ({new Date(tp.tp_date_time).toLocaleDateString()})
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className={cn(styles.stepBoxLast, selectedTimepoints.length !== 2 && styles.stepBoxDisabled)}>
                        <h4 className={styles.stepHeader}>
                            <span className={cn(styles.stepNumber, isReady && styles.stepNumberComplete)}>
                                2
                            </span>
                            <span>Select Photo Type</span>
                        </h4>
                        {selectedTimepoints.length < 2 && (
                            <p className={styles.stepHint}>
                                Select 2 timepoints first
                            </p>
                        )}
                        <div className={styles.photoTypeList}>
                            {['facial', 'occlusal', 'intraoral'].map(category => (
                                <div key={category} className={styles.photoTypeCategory}>
                                    <h5 className={styles.photoTypeCategoryTitle}>
                                        {category}
                                    </h5>
                                    <div>
                                        {PHOTO_TYPES.filter(pt => pt.category === category).map(photoType => {
                                            const available = isPhotoTypeAvailable(photoType.code) && selectedTimepoints.length === 2;
                                            return (
                                                <label
                                                    key={photoType.id}
                                                    className={cn(
                                                        styles.radioRow,
                                                        selectedPhotoType === photoType.id && styles.radioRowSelected,
                                                        !available && styles.radioRowDisabled,
                                                    )}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="photoType"
                                                        value={photoType.id}
                                                        checked={selectedPhotoType === photoType.id}
                                                        disabled={!available}
                                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedPhotoType(e.target.value)}
                                                        className={styles.radioInput}
                                                    />
                                                    <span>{photoType.label}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showWhatsAppModal}
                onClose={() => setShowWhatsAppModal(false)}
                ariaLabelledBy="compare-whatsapp-title"
            >
                <div className={styles.modalCard}>
                    <h3 id="compare-whatsapp-title">Send to WhatsApp</h3>
                    <form onSubmit={handleWhatsAppSend}>
                        <input
                            type="tel"
                            placeholder="Phone number"
                            value={phoneNumber}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoneNumber(e.target.value)}
                            required
                            className={cn('form-control', styles.modalInput)}
                        />
                        <div className={styles.modalActions}>
                            <button
                                type="button"
                                onClick={() => setShowWhatsAppModal(false)}
                                className="btn btn-light"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={sendingMessage}
                                className={cn('btn', styles.whatsappBrandButton)}
                            >
                                {sendingMessage ? 'Sending...' : 'Send'}
                            </button>
                        </div>
                    </form>
                </div>
            </Modal>
        </div>
    );
};

export default CompareComponent;
