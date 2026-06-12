/**
 * ComparisonEngine — the imperative canvas controller behind the compare page.
 *
 * Plain TypeScript class, no React. All mutations go through methods that end
 * in `commit()`, which invalidates the cached immutable snapshot and notifies
 * subscribers — components read state exclusively via `useSyncExternalStore`
 * (see useComparisonEngine). This is what lets the React Compiler memoize the
 * components: render reads come from an immutable snapshot, never from this
 * mutable instance, and the instance is never mutated in component scope
 * (the old in-place `useState` handler tripped react-hooks/immutability).
 */

import type { AutoImageSize, CanvasDimensions, ImageKey, Transform, TransformState } from './types';
import { KEY_FOR_TOOL } from './types';

export interface ImageInfo {
    width: number;
    height: number;
}

/** Immutable render snapshot — rebuilt lazily after each commit. */
export interface EngineSnapshot {
    version: number;
    /** True while loadImages is in flight (drives the stage loading veil). */
    loading: boolean;
    imageCount: number;
    /** Natural size per slot (img1, img2, logo); null until that image is loaded. */
    imageInfo: (ImageInfo | null)[];
    orientation: 'vertical' | 'horizontal';
    showBisect: boolean;
    showLogo: boolean;
    /** 0 = none, 1 = img1, 2 = img2, 3 = logo. */
    selectedImage: number;
    autoMode: boolean;
    autoImageSize: AutoImageSize | null;
    canvasWidth: number;
    canvasHeight: number;
    transform: TransformState;
}

function freshTransforms(): TransformState {
    return {
        img1: { x: 0, y: 0, scale: 1, rotation: 0 },
        img2: { x: 0, y: 0, scale: 1, rotation: 0 },
        logo: { x: 0, y: 0, scale: 1, rotation: 0 },
    };
}

/** Snapshot served before the engine exists, so the UI renders consistently. */
export const EMPTY_SNAPSHOT: EngineSnapshot = {
    version: -1,
    loading: false,
    imageCount: 0,
    imageInfo: [],
    orientation: 'vertical',
    showBisect: false,
    showLogo: true,
    selectedImage: 0,
    autoMode: true,
    autoImageSize: null,
    canvasWidth: 800,
    canvasHeight: 600,
    transform: freshTransforms(),
};

export const getEmptySnapshot = (): EngineSnapshot => EMPTY_SNAPSHOT;
export const emptySubscribe = (): (() => void) => () => {};

export class ComparisonEngine {
    private canvas: HTMLCanvasElement;
    private context: CanvasRenderingContext2D;
    private images: HTMLImageElement[] = [];
    private transform: TransformState = freshTransforms();
    private orientation: 'vertical' | 'horizontal' = 'vertical';
    private showBisect = false;
    private showLogo = true;
    private selectedImage = 0;
    private autoMode = true;
    private autoScale = 1;
    private autoImageSize: AutoImageSize | null = null;
    private originalDimensions: CanvasDimensions;
    private loadSeq = 0;
    private loading = false;
    private version = 0;
    private listeners = new Set<() => void>();
    private snapshot: EngineSnapshot | null = null;

    constructor(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        this.canvas = canvas;
        this.context = context;
        this.originalDimensions = { width: canvas.width, height: canvas.height };
    }

    // --- store interface (stable identities for useSyncExternalStore) ---

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): EngineSnapshot => {
        this.snapshot ??= {
            version: this.version,
            loading: this.loading,
            imageCount: this.images.length,
            imageInfo: this.images.map(img =>
                img.complete && img.naturalWidth > 0 ? { width: img.width, height: img.height } : null,
            ),
            orientation: this.orientation,
            showBisect: this.showBisect,
            showLogo: this.showLogo,
            selectedImage: this.selectedImage,
            autoMode: this.autoMode,
            autoImageSize: this.autoImageSize ? { ...this.autoImageSize } : null,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            transform: {
                img1: { ...this.transform.img1 },
                img2: { ...this.transform.img2 },
                logo: { ...this.transform.logo },
            },
        };
        return this.snapshot;
    };

    private commit(): void {
        this.version++;
        this.snapshot = null;
        for (const listener of this.listeners) listener();
    }

    // --- image loading ---

    /**
     * Loads all URLs, then atomically swaps the image set (the previous
     * comparison stays visible until the new one is ready). Throws on the
     * first failed/timed-out image; a load superseded by a newer call is
     * silently abandoned.
     */
    async loadImages(urls: string[]): Promise<void> {
        const seq = ++this.loadSeq;
        this.loading = true;
        this.commit();
        try {
            const loaded: HTMLImageElement[] = [];
            for (const url of urls) {
                const img = new Image();
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error(`Timeout loading image: ${url}`)), 10000);
                    img.onload = () => {
                        clearTimeout(timeout);
                        resolve();
                    };
                    img.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error(`Failed to load image: ${url}`));
                    };
                    img.src = url;
                });
                loaded.push(img);
            }
            if (seq !== this.loadSeq) return;
            this.images = loaded;
            if (this.autoMode) this.resizeCanvasToFitImages();
            this.render();
        } finally {
            // A superseded load leaves the flag to the call that superseded it.
            if (seq === this.loadSeq) {
                this.loading = false;
                this.commit();
            }
        }
    }

    // --- selection / view options ---

    setSelectedImage(tool: number): void {
        if (this.selectedImage === tool) return;
        this.selectedImage = tool;
        this.commit();
    }

    toggleOrientation(): void {
        this.orientation = this.orientation === 'vertical' ? 'horizontal' : 'vertical';
        if (this.autoMode && this.images.length >= 2) {
            this.resizeCanvasToFitImages();
        }
        this.render();
        this.commit();
    }

    toggleBisect(): void {
        this.showBisect = !this.showBisect;
        this.render();
        this.commit();
    }

    toggleLogo(): void {
        this.showLogo = !this.showLogo;
        this.render();
        this.commit();
    }

    /**
     * 'auto' | 'auto-50' | 'auto-25' keep the canvas sized from the source
     * images; any other value is a JSON `{width,height}` fixed preset.
     */
    setSizeMode(value: string): void {
        if (value === 'auto' || value === 'auto-50' || value === 'auto-25') {
            this.autoMode = true;
            this.autoScale = value === 'auto-50' ? 0.5 : value === 'auto-25' ? 0.25 : 1;
            if (this.images.length >= 2) {
                this.resizeCanvasToFitImages();
            } else {
                this.canvas.width = 800;
                this.canvas.height = 600;
            }
        } else {
            this.autoMode = false;
            this.autoScale = 1;
            const size = JSON.parse(value) as CanvasDimensions;
            this.canvas.width = size.width;
            this.canvas.height = size.height;
            this.originalDimensions = { width: size.width, height: size.height };
        }
        this.render();
        this.commit();
    }

    // --- transforms ---

    getTransform(key: ImageKey): Transform {
        return { ...this.transform[key] };
    }

    /** Replaces a transform wholesale — the drag overlay computes absolute values. */
    setTransform(key: ImageKey, next: Transform): void {
        this.transform[key] = { ...next };
        this.render();
        this.commit();
    }

    moveImage(direction: 'left' | 'right' | 'up' | 'down', amount = 10): void {
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
        this.commit();
    }

    zoomImage(direction: 'in' | 'out'): void {
        const key = KEY_FOR_TOOL[this.selectedImage];
        if (!key) return;
        const transform = this.transform[key];
        const factor = direction === 'in' ? 1.1 : 0.9;
        transform.scale = Math.max(0.1, Math.min(5, transform.scale * factor));
        this.render();
        this.commit();
    }

    rotateImage(direction: 'clockwise' | 'counterclockwise'): void {
        const key = KEY_FOR_TOOL[this.selectedImage];
        if (!key) return;
        this.transform[key].rotation += direction === 'clockwise' ? 1 : -1;
        this.render();
        this.commit();
    }

    reset(): void {
        this.transform = freshTransforms();
        // In auto mode, recompute canvas + autoImageSize from the actual
        // images so reset restores the same layout the user first saw.
        // Falling back to originalDimensions here would leave a stale
        // autoImageSize and draw the images huge on a tiny canvas.
        if (this.autoMode && this.images.length >= 2) {
            this.resizeCanvasToFitImages();
        } else {
            this.canvas.width = this.originalDimensions.width;
            this.canvas.height = this.originalDimensions.height;
        }
        this.render();
        this.commit();
    }

    toDataURL(): string {
        return this.canvas.toDataURL('image/png');
    }

    // --- canvas drawing (private) ---

    private resizeCanvasToFitImages(): void {
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
            height: Math.round(containerHeight * scale),
        };

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
    }

    private render(): void {
        if (this.images.length < 2) return;
        const { canvas, context: ctx } = this;

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
    }

    private renderVertical(): void {
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
    }

    private renderHorizontal(): void {
        const canvas = this.canvas;

        if (this.autoMode && this.images.length >= 2 && this.autoImageSize) {
            // In auto mode, give each image a container but let them maintain aspect ratio
            const containerWidth = this.autoImageSize.width;
            const containerHeight = this.autoImageSize.height;
            if (this.images[0]) {
                this.drawImage(this.images[0], 0, 0, containerWidth, containerHeight, 'img1');
            }
            if (this.images[1]) {
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
    }

    private drawImage(img: HTMLImageElement, x: number, y: number, width: number, height: number, key: ImageKey): void {
        const ctx = this.context;
        const transform = this.transform[key];

        if (!img.complete || img.naturalWidth === 0) return;

        // In auto mode, prioritize aspect ratio preservation over transforms
        if (this.autoMode && transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0) {
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
    }

    private drawLogo(img: HTMLImageElement): void {
        const { canvas, context: ctx } = this;
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
    }

    private drawBisectLine(): void {
        const { canvas, context: ctx } = this;

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
    }
}
