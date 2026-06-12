/**
 * The canvas stage — a pinned-dark "lightbox" viewport hosting the comparison
 * canvas, its SVG manipulation overlay, the floating toolbar (share /
 * slideshow / fullscreen), the slideshow chrome and the dimensions badge.
 */

import React, { useEffect, useRef, useState, RefObject } from 'react';
import cn from 'classnames';
import type { ComparisonEngine, EngineSnapshot } from './ComparisonEngine';
import type { SlideshowState } from './useSlideshow';
import CompareOverlay from './CompareOverlay';
import {
    IconChevronLeft,
    IconChevronRight,
    IconClose,
    IconCompare,
    IconCompress,
    IconExpand,
    IconPlay,
    IconShare,
} from './icons';
import styles from './CompareStage.module.css';

interface Props {
    engine: ComparisonEngine | null;
    snap: EngineSnapshot;
    canvasRef: (canvas: HTMLCanvasElement | null) => void;
    canvasEl: HTMLCanvasElement | null;
    stageRef: RefObject<HTMLDivElement | null>;
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
    emptyHint: string;
    onShare: () => void;
    shareDisabled: boolean;
    nativeShare: boolean;
    slideshow: SlideshowState;
    canSlideshow: boolean;
    /** Photo-type label of the current slideshow pair. */
    slideLabel?: string;
}

const CompareStage = ({
    engine,
    snap,
    canvasRef,
    canvasEl,
    stageRef,
    isFullscreen,
    onToggleFullscreen,
    emptyHint,
    onShare,
    shareDisabled,
    nativeShare,
    slideshow,
    canSlideshow,
    slideLabel,
}: Props) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [displaySize, setDisplaySize] = useState({ width: 800, height: 600 });

    // Track the CSS-displayed canvas size for DPI-scaling the overlay handles.
    useEffect(() => {
        if (!canvasEl) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDisplaySize({ width, height });
                }
            }
        });
        ro.observe(canvasEl);
        return () => ro.disconnect();
    }, [canvasEl]);

    // Wheel-zoom on the selected element. Reads live engine state inside the
    // handler (not a captured snapshot), so a single subscription stays fresh.
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper || !engine) return;
        const handler = (e: WheelEvent) => {
            const s = engine.getSnapshot();
            if (s.imageCount < 2 || s.selectedImage === 0) return;
            e.preventDefault();
            engine.zoomImage(e.deltaY < 0 ? 'in' : 'out');
        };
        wrapper.addEventListener('wheel', handler, { passive: false });
        return () => wrapper.removeEventListener('wheel', handler);
    }, [engine]);

    const hasComparison = snap.imageCount >= 2;
    const pixelCount = snap.canvasWidth * snap.canvasHeight;
    const megapixels = (pixelCount / 1_000_000).toFixed(1);

    return (
        <div
            ref={stageRef}
            onPointerDown={() => engine?.setSelectedImage(0)}
            className={isFullscreen ? styles.stageFullscreen : styles.stage}
        >
            <div className={cn(styles.toolbar, slideshow.active && styles.toolbarHidden)}>
                <button
                    onClick={onShare}
                    disabled={shareDisabled}
                    title={nativeShare ? 'Share comparison' : 'Share comparison (LocalSend / Telegram)'}
                    aria-label="Share comparison"
                    className={styles.toolbarButton}
                >
                    <IconShare />
                </button>
                <button
                    onClick={slideshow.start}
                    disabled={!canSlideshow}
                    title={canSlideshow
                        ? `Start slideshow (${slideshow.total} pair${slideshow.total === 1 ? '' : 's'})`
                        : 'Select two timepoints with shared images to enable slideshow'}
                    aria-label="Start pair slideshow"
                    className={styles.toolbarButton}
                >
                    <IconPlay />
                </button>
                <button
                    onClick={onToggleFullscreen}
                    title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
                    aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    className={styles.toolbarButton}
                >
                    {isFullscreen ? <IconCompress /> : <IconExpand />}
                </button>
            </div>

            {slideshow.active && (
                <>
                    <button
                        onClick={slideshow.stop}
                        title="Close slideshow (Esc)"
                        aria-label="Close slideshow"
                        className={styles.slideshowClose}
                    >
                        <IconClose />
                    </button>
                    <button
                        onClick={() => slideshow.step(-1)}
                        disabled={slideshow.index === 0}
                        title="Previous pair (←)"
                        aria-label="Previous pair"
                        className={cn(styles.slideshowArrow, styles.slideshowPrev)}
                    >
                        <IconChevronLeft size={26} />
                    </button>
                    <button
                        onClick={() => slideshow.step(1)}
                        disabled={slideshow.index === slideshow.total - 1}
                        title="Next pair (→)"
                        aria-label="Next pair"
                        className={cn(styles.slideshowArrow, styles.slideshowNext)}
                    >
                        <IconChevronRight size={26} />
                    </button>
                    <div className={styles.slideshowCounter}>
                        {slideLabel}
                        <span className={styles.slideshowCounterIndex}>
                            {slideshow.index + 1} / {slideshow.total}
                        </span>
                    </div>
                </>
            )}

            <div
                ref={wrapperRef}
                className={cn(styles.canvasShell, !hasComparison && styles.canvasShellHidden)}
            >
                <canvas
                    ref={canvasRef}
                    id="comparison-canvas"
                    width={800}
                    height={600}
                    className={isFullscreen ? styles.canvasElFullscreen : styles.canvasEl}
                />
                {engine && (
                    <CompareOverlay
                        engine={engine}
                        snap={snap}
                        canvasEl={canvasEl}
                        displayWidth={displaySize.width}
                    />
                )}
            </div>

            {!hasComparison && (
                <div className={styles.empty}>
                    <span className={styles.emptyIcon}><IconCompare size={56} /></span>
                    <h3 className={styles.emptyTitle}>No comparison yet</h3>
                    <p className={styles.emptyHint}>{emptyHint}</p>
                </div>
            )}

            {snap.loading && (
                <div className={styles.loadingVeil}>
                    <div className={styles.spinner} role="status" aria-label="Loading images" />
                </div>
            )}

            {hasComparison && !slideshow.active && (
                <div className={styles.dimsBadge} title={`Export size: ${megapixels} MP`}>
                    {snap.canvasWidth} × {snap.canvasHeight} · {megapixels} MP
                </div>
            )}
        </div>
    );
};

export default CompareStage;
