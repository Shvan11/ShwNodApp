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

import type { AutoImageSize, CanvasDimensions, CropInset, CropState, ImageKey, LogoTone, Transform, TransformState } from './types';
import { KEY_FOR_TOOL } from './types';

interface ImageInfo {
    width: number;
    height: number;
}

/** The longest edge an `auto` canvas may have (the `auto-full` mode lifts it). Renders
 *  keep their native resolution (up to 8,000 px), so a 100 % pair made a 26–36 MP canvas
 *  and a 30–45 MB PNG that a phone could not hold and *Share* could not upload off the
 *  LAN in 30 s (FE-F13-6). 4,096 px is past any screen and any social preset. */
export const AUTO_LONG_EDGE_CAP = 4096;

/** Immutable render snapshot — rebuilt lazily after each commit. */
export interface EngineSnapshot {
    /** True while a pair is loading (drives the stage loading veil). */
    loading: boolean;
    /** 2 while a pair is drawn, else 0. */
    imageCount: number;
    /** The `key` of the pair on the canvas — the caller compares it with what is
     *  selected, so Save/Share can never export a pair other than the selected one
     *  (FE-F13-4). Null when nothing is drawn. */
    sourceKey: string | null;
    /** Natural size per slot (img1, img2, logo); null until that image is loaded. */
    imageInfo: (ImageInfo | null)[];
    orientation: 'vertical' | 'horizontal';
    showBisect: boolean;
    /** False when this install has no logo (Settings → General) — then no watermark. */
    hasLogo: boolean;
    showLogo: boolean;
    logoTone: LogoTone;
    /** 0 = none, 1 = img1, 2 = img2, 3 = logo. */
    selectedImage: number;
    autoMode: boolean;
    autoImageSize: AutoImageSize | null;
    canvasWidth: number;
    canvasHeight: number;
    transform: TransformState;
    /** Per-image straight-line edge crop (container fractions). */
    crop: CropState;
    /** True while the crop-edit overlay (margin handles) is active. */
    cropMode: boolean;
}

function freshTransforms(): TransformState {
    return {
        img1: { x: 0, y: 0, scale: 1, rotation: 0 },
        img2: { x: 0, y: 0, scale: 1, rotation: 0 },
        logo: { x: 0, y: 0, scale: 1, rotation: 0 },
    };
}

function freshCrop(): CropState {
    const zero = (): CropInset => ({ top: 0, right: 0, bottom: 0, left: 0 });
    return { img1: zero(), img2: zero(), logo: zero() };
}

/** Snapshot served before the engine exists, so the UI renders consistently. */
export const EMPTY_SNAPSHOT: EngineSnapshot = {
    loading: false,
    imageCount: 0,
    sourceKey: null,
    imageInfo: [],
    orientation: 'vertical',
    showBisect: false,
    hasLogo: false,
    showLogo: false,
    logoTone: 'white',
    selectedImage: 0,
    autoMode: true,
    autoImageSize: null,
    canvasWidth: 800,
    canvasHeight: 600,
    transform: freshTransforms(),
    crop: freshCrop(),
    cropMode: false,
};

export const getEmptySnapshot = (): EngineSnapshot => EMPTY_SNAPSHOT;
export const emptySubscribe = (): (() => void) => () => {};

/** Thrown by `loadPair` when one photo fails; `index` says which (0 = before, 1 = after). */
export class PairLoadError extends Error {
    constructor(readonly index: number) {
        super(`Failed to load photo ${index + 1}`);
        this.name = 'PairLoadError';
    }
}

/** Release a decoded image (its pixels and any request still in flight). */
function release(img: HTMLImageElement): void {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
}

/** True when any pixel of the image is (partly) transparent — sampled at ≤128 px. */
function hasTransparency(img: HTMLImageElement): boolean {
    const scale = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
}

/** The logo in the requested tone: itself, or a white/black silhouette (alpha kept). */
function recolor(img: HTMLImageElement, tone: LogoTone): HTMLImageElement | HTMLCanvasElement {
    if (tone === 'original') return img;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    // Keep the logo's shape (its alpha) and paint it one colour.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = tone === 'white' ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
}

export class ComparisonEngine {
    private canvas: HTMLCanvasElement;
    private context: CanvasRenderingContext2D;
    /** The two photos on the canvas (0 or 2). The logo lives apart (see `logo*`). */
    private photos: HTMLImageElement[] = [];
    private sourceKey: string | null = null;
    private sourceView: string | null = null;
    /** Images of the load in flight — released when a newer load supersedes it. */
    private pending: HTMLImageElement[] = [];
    private logoImg: HTMLImageElement | null = null;
    private logoUrl: string | null = null;
    private logoOpaque = false;
    /** The logo as drawn: the image itself, or a recoloured silhouette of it. */
    private logoSource: HTMLImageElement | HTMLCanvasElement | null = null;
    private transform: TransformState = freshTransforms();
    private crop: CropState = freshCrop();
    private cropMode = false;
    private orientation: 'vertical' | 'horizontal' = 'vertical';
    private showBisect = false;
    private showLogo = false;
    private logoTone: LogoTone = 'white';
    private selectedImage = 0;
    private autoMode = true;
    private autoScale = 1;
    /** `auto` caps the long edge at AUTO_LONG_EDGE_CAP; `auto-full` does not. */
    private autoCapped = true;
    private autoImageSize: AutoImageSize | null = null;
    private originalDimensions: CanvasDimensions;
    private loadSeq = 0;
    private logoSeq = 0;
    private loading = false;
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
        const info = (img: HTMLImageElement | null): ImageInfo | null =>
            img && img.complete && img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null;
        this.snapshot ??= {
            loading: this.loading,
            imageCount: this.photos.length,
            sourceKey: this.sourceKey,
            imageInfo: [...this.photos.map(info), this.photos.length ? info(this.logoImg) : null],
            orientation: this.orientation,
            showBisect: this.showBisect,
            hasLogo: this.logoImg !== null,
            showLogo: this.showLogo && this.logoImg !== null,
            logoTone: this.logoTone,
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
            crop: {
                img1: { ...this.crop.img1 },
                img2: { ...this.crop.img2 },
                logo: { ...this.crop.logo },
            },
            cropMode: this.cropMode,
        };
        return this.snapshot;
    };

    private commit(): void {
        this.snapshot = null;
        for (const listener of this.listeners) listener();
    }

    // --- image loading ---

    /**
     * Loads the two photos IN PARALLEL, then swaps them in together. A newer call
     * supersedes this one and releases its images, which cancels their downloads;
     * there is no fixed timeout (a 3.5 MB render on a weak link took 11 s and used to
     * fail at 10 s, while a superseded load kept fetching — FE-F13-9).
     *
     * On a failure the canvas is CLEARED and the error says which photo: the previous
     * pair used to stay drawn under the new selection, and Save exported it (FE-F13-4).
     *
     * @param key   identifies the selection; echoed as `snap.sourceKey`.
     * @param view  the photo type; a different view starts from a clean alignment —
     *              position, zoom, rotation and crop set for one view never suit another
     *              (FE-F13-10).
     */
    async loadPair(urls: [string, string], opts: { key: string; view: string }): Promise<void> {
        const seq = ++this.loadSeq;
        this.pending.forEach(release);
        const imgs = urls.map(() => new Image());
        this.pending = imgs;
        this.loading = true;
        this.commit();
        try {
            await Promise.all(
                imgs.map(
                    (img, i) =>
                        new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve();
                            img.onerror = () => reject(new PairLoadError(i));
                            img.src = urls[i];
                        })
                )
            );
            if (seq !== this.loadSeq) return;
            this.pending = [];
            this.photos.forEach(release);
            this.photos = imgs;
            if (opts.view !== this.sourceView) {
                this.transform = freshTransforms();
                this.crop = freshCrop();
                this.cropMode = false;
            }
            this.sourceKey = opts.key;
            this.sourceView = opts.view;
            if (this.autoMode) this.resizeCanvasToFitImages();
            this.render();
        } catch (err) {
            if (seq !== this.loadSeq) return;
            imgs.forEach(release);
            this.pending = [];
            this.clearPhotos();
            throw err;
        } finally {
            // A superseded load leaves the flag to the call that superseded it.
            if (seq === this.loadSeq) {
                this.loading = false;
                this.commit();
            }
        }
    }

    /**
     * Take the pair off the canvas — called whenever the selection stops being a
     * complete pair + type, so the canvas never shows a pair that is not selected
     * (FE-F13-4) and a change of patient never keeps the previous one's (FE-F13-12).
     */
    clear(): void {
        ++this.loadSeq;
        this.pending.forEach(release);
        this.pending = [];
        if (this.photos.length === 0 && !this.loading) return;
        this.loading = false;
        this.clearPhotos();
        this.commit();
    }

    private clearPhotos(): void {
        this.photos.forEach(release);
        this.photos = [];
        this.sourceKey = null;
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * The watermark: THIS install's logo (Settings → General), or none. It used to be
     * this clinic's wordmark from the repository, on by default, on every export
     * (FE-F13-7). With no logo set there is no watermark and no toggle.
     */
    async setLogo(url: string | null): Promise<void> {
        if (url === this.logoUrl) return;
        this.logoUrl = url;
        const seq = ++this.logoSeq;
        if (!url) {
            if (this.logoImg) release(this.logoImg);
            this.logoImg = null;
            this.logoSource = null;
            this.showLogo = false;
            this.render();
            this.commit();
            return;
        }
        const img = new Image();
        try {
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('logo'));
                img.src = url;
            });
        } catch {
            if (seq === this.logoSeq) {
                this.logoImg = null;
                this.logoSource = null;
                this.showLogo = false;
                this.commit();
            }
            return; // no logo is a valid state, not an error to report
        }
        if (seq !== this.logoSeq) return;
        if (this.logoImg) release(this.logoImg);
        const firstLogo = this.logoImg === null;
        this.logoImg = img;
        this.logoOpaque = !hasTransparency(img);
        // A logo with no transparency (a JPEG) would recolour into a solid block, so
        // it starts in its own colours; a transparent one starts as a white mark.
        if (firstLogo) {
            this.logoTone = this.logoOpaque ? 'original' : 'white';
            this.showLogo = true;
        }
        this.logoSource = recolor(img, this.logoTone);
        this.render();
        this.commit();
    }

    // --- selection / view options ---

    setSelectedImage(tool: number): void {
        if (this.selectedImage === tool) return;
        this.selectedImage = tool;
        // Crop mode only applies to the two images; switching away exits it.
        if (tool !== 1 && tool !== 2) this.cropMode = false;
        this.commit();
    }

    toggleOrientation(): void {
        this.orientation = this.orientation === 'vertical' ? 'horizontal' : 'vertical';
        if (this.autoMode && this.photos.length >= 2) {
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
        if (!this.logoImg) return;
        this.showLogo = !this.showLogo;
        this.render();
        this.commit();
    }

    /**
     * Cycle the watermark's colour: white → black → its own colours. Recoloured
     * locally from the one loaded logo, synchronously — the old toggle flipped its
     * flag, then fetched a second asset, so a failed fetch left the button and the
     * canvas disagreeing and an unhandled rejection behind (FE-F13-15b).
     */
    cycleLogoTone(): void {
        if (!this.logoImg) return;
        const order: LogoTone[] = ['white', 'black', 'original'];
        this.logoTone = order[(order.indexOf(this.logoTone) + 1) % order.length];
        this.logoSource = recolor(this.logoImg, this.logoTone);
        this.render();
        this.commit();
    }

    /**
     * 'auto' (long edge capped at AUTO_LONG_EDGE_CAP) | 'auto-full' | 'auto-50' |
     * 'auto-25' keep the canvas sized from the source images; any other value is a
     * JSON `{width,height}` fixed preset.
     */
    setSizeMode(value: string): void {
        if (value === 'auto' || value === 'auto-full' || value === 'auto-50' || value === 'auto-25') {
            this.autoMode = true;
            this.autoCapped = value === 'auto';
            this.autoScale = value === 'auto-50' ? 0.5 : value === 'auto-25' ? 0.25 : 1;
            if (this.photos.length >= 2) {
                this.resizeCanvasToFitImages();
            } else {
                this.canvas.width = 800;
                this.canvas.height = 600;
            }
        } else {
            this.autoMode = false;
            this.autoCapped = false;
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

    // --- crop (straight-line edge trimming) ---

    getCrop(key: ImageKey): CropInset {
        return { ...this.crop[key] };
    }

    /**
     * Sets a per-side crop (container fractions). Each side is clamped and the
     * two sides on an axis are kept from crossing, so a sliver of image always
     * remains. Drives the canvas clip rect in drawImage.
     */
    setCrop(key: ImageKey, next: CropInset): void {
        const clampSide = (v: number) => Math.max(0, Math.min(0.95, v));
        let left = clampSide(next.left);
        let right = clampSide(next.right);
        let top = clampSide(next.top);
        let bottom = clampSide(next.bottom);
        const MAX_SUM = 0.95;
        if (left + right > MAX_SUM) {
            const k = MAX_SUM / (left + right);
            left *= k;
            right *= k;
        }
        if (top + bottom > MAX_SUM) {
            const k = MAX_SUM / (top + bottom);
            top *= k;
            bottom *= k;
        }
        this.crop[key] = { top, right, bottom, left };
        this.render();
        this.commit();
    }

    /**
     * Steps all four crop insets of the selected image together (symmetric
     * trim). Positive delta trims more on every side; negative restores toward
     * the full image. Reuses setCrop, so the same clamp/keep-a-sliver rules apply.
     */
    nudgeCropAll(delta: number): void {
        const key = KEY_FOR_TOOL[this.selectedImage];
        if (key !== 'img1' && key !== 'img2') return;
        const c = this.crop[key];
        this.setCrop(key, {
            top: c.top + delta,
            right: c.right + delta,
            bottom: c.bottom + delta,
            left: c.left + delta,
        });
    }

    /** Crop mode is an overlay-only editing affordance; only valid on img1/img2. */
    setCropMode(on: boolean): void {
        const next = on && (this.selectedImage === 1 || this.selectedImage === 2);
        if (this.cropMode === next) return;
        this.cropMode = next;
        this.commit();
    }

    toggleCropMode(): void {
        this.setCropMode(!this.cropMode);
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
        this.crop = freshCrop();
        this.cropMode = false;
        // In auto mode, recompute canvas + autoImageSize from the actual
        // images so reset restores the same layout the user first saw.
        // Falling back to originalDimensions here would leave a stale
        // autoImageSize and draw the images huge on a tiny canvas.
        if (this.autoMode && this.photos.length >= 2) {
            this.resizeCanvasToFitImages();
        } else {
            this.canvas.width = this.originalDimensions.width;
            this.canvas.height = this.originalDimensions.height;
        }
        this.render();
        this.commit();
    }

    /**
     * The export, as a JPEG (quality 0.9). `toDataURL('image/png')` blocked the main
     * thread for ~1–1.4 s and produced 30–45 MB (FE-F13-6); `toBlob` encodes off the
     * main thread, at a fraction of the size.
     */
    exportBlob(): Promise<Blob> {
        return new Promise((resolve, reject) => {
            this.canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('The canvas could not be encoded'))),
                'image/jpeg',
                0.9
            );
        });
    }

    // --- canvas drawing (private) ---

    private resizeCanvasToFitImages(): void {
        if (this.photos.length < 2) return;
        const img1 = this.photos[0];
        const img2 = this.photos[1];
        if (!img1.complete || !img2.complete) return;

        // Simple approach: use the larger dimensions to ensure both fit without distortion
        const containerWidth = Math.max(img1.naturalWidth, img2.naturalWidth);
        const containerHeight = Math.max(img1.naturalHeight, img2.naturalHeight);

        let canvasWidth: number, canvasHeight: number;
        if (this.orientation === 'vertical') {
            canvasWidth = containerWidth;
            canvasHeight = containerHeight * 2;
        } else {
            canvasWidth = containerWidth * 2;
            canvasHeight = containerHeight;
        }

        let scale = this.autoScale ?? 1;
        if (this.autoCapped) {
            scale = Math.min(scale, AUTO_LONG_EDGE_CAP / Math.max(canvasWidth, canvasHeight));
        }
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
        if (this.photos.length < 2) return;
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

        if (this.autoMode && this.photos.length >= 2 && this.autoImageSize) {
            // In auto mode, use common smallest dimensions for both images
            const commonWidth = this.autoImageSize.width;
            const commonHeight = this.autoImageSize.height;
            if (this.photos[0]) {
                this.drawImage(this.photos[0], 0, 0, commonWidth, commonHeight, 'img1');
            }
            if (this.photos[1]) {
                this.drawImage(this.photos[1], 0, commonHeight, commonWidth, commonHeight, 'img2');
            }
        } else {
            // Fixed mode - use split layout
            const halfHeight = canvas.height / 2;
            if (this.photos[0]) {
                this.drawImage(this.photos[0], 0, 0, canvas.width, halfHeight, 'img1');
            }
            if (this.photos[1]) {
                this.drawImage(this.photos[1], 0, halfHeight, canvas.width, halfHeight, 'img2');
            }
        }

        if (this.logoSource && this.showLogo) {
            this.drawLogo(this.logoSource);
        }
    }

    private renderHorizontal(): void {
        const canvas = this.canvas;

        if (this.autoMode && this.photos.length >= 2 && this.autoImageSize) {
            // In auto mode, give each image a container but let them maintain aspect ratio
            const containerWidth = this.autoImageSize.width;
            const containerHeight = this.autoImageSize.height;
            if (this.photos[0]) {
                this.drawImage(this.photos[0], 0, 0, containerWidth, containerHeight, 'img1');
            }
            if (this.photos[1]) {
                this.drawImage(this.photos[1], containerWidth, 0, containerWidth, containerHeight, 'img2');
            }
        } else {
            // Fixed mode - use split layout
            const halfWidth = canvas.width / 2;
            if (this.photos[0]) {
                this.drawImage(this.photos[0], 0, 0, halfWidth, canvas.height, 'img1');
            }
            if (this.photos[1]) {
                this.drawImage(this.photos[1], halfWidth, 0, halfWidth, canvas.height, 'img2');
            }
        }

        if (this.logoSource && this.showLogo) {
            this.drawLogo(this.logoSource);
        }
    }

    private drawImage(img: HTMLImageElement, x: number, y: number, width: number, height: number, key: ImageKey): void {
        const ctx = this.context;
        const transform = this.transform[key];
        const crop = this.crop[key];

        if (!img.complete || img.naturalWidth === 0) return;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;

        // Per-side crop insets (fractions of the container) → an axis-aligned
        // clip rect in canvas space. Because the clip is set before the rotate,
        // the cut stays a straight, canvas-aligned line even on a rotated image.
        const cropL = crop.left * width;
        const cropR = crop.right * width;
        const cropT = crop.top * height;
        const cropB = crop.bottom * height;
        const hasCrop = cropL > 0 || cropR > 0 || cropT > 0 || cropB > 0;
        const clipX = x + cropL;
        const clipY = y + cropT;
        const clipW = Math.max(0, width - cropL - cropR);
        const clipH = Math.max(0, height - cropT - cropB);

        // In auto mode with no transforms AND no crop, prioritize aspect ratio preservation
        if (this.autoMode && !hasCrop && transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0) {
            // Pure aspect ratio preservation without transforms
            const aspectRatio = imgW / imgH;
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
            // Standard mode with transforms - clip to the (cropped) container so
            // the image cannot bleed into the other half of the canvas and any
            // trimmed margins read through to the background.
            ctx.save();
            ctx.beginPath();
            ctx.rect(clipX, clipY, clipW, clipH);
            ctx.clip();

            ctx.translate(x + width / 2 + transform.x, y + height / 2 + transform.y);
            ctx.rotate(transform.rotation * Math.PI / 180);
            ctx.scale(transform.scale, transform.scale);

            const aspectRatio = imgW / imgH;
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

    private drawLogo(img: HTMLImageElement | HTMLCanvasElement): void {
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
