/**
 * Adjust / export rail card: canvas-size preset, target picker (which element
 * the transform tools act on), movement pad, zoom/rotate, view toggles and
 * the export actions (Save / Share).
 */

import React, { ChangeEvent } from 'react';
import cn from 'classnames';
import type { ComparisonEngine, EngineSnapshot } from './ComparisonEngine';
import { CANVAS_SIZES, TOOLS } from './types';
import {
    IconArrowDown,
    IconArrowLeft,
    IconArrowRight,
    IconArrowUp,
    IconBadge,
    IconBisect,
    IconDownload,
    IconLayout,
    IconReset,
    IconRotateCcw,
    IconRotateCw,
    IconShare,
    IconZoomIn,
    IconZoomOut,
} from './icons';
import styles from './ControlsPanel.module.css';

interface Props {
    engine: ComparisonEngine | null;
    snap: EngineSnapshot;
    canvasSizeMode: string;
    onCanvasSizeModeChange: (value: string) => void;
    onSave: () => void;
    onShare: () => void;
    shareStaging: boolean;
    nativeShare: boolean;
    isReady: boolean;
}

const SELECT_FIRST_HINT = 'Select an element first (click a photo or use the target picker)';

const ControlsPanel = ({
    engine,
    snap,
    canvasSizeMode,
    onCanvasSizeModeChange,
    onSave,
    onShare,
    shareStaging,
    nativeShare,
    isReady,
}: Props) => {
    const hasSelection = snap.selectedImage !== 0;
    const canAdjust = engine !== null && hasSelection;
    const adjustTitle = (base: string) => (canAdjust ? base : SELECT_FIRST_HINT);

    return (
        <div className={styles.card}>
            <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Canvas</h4>
                <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel} htmlFor="compare-canvas-size">Size</label>
                    <select
                        id="compare-canvas-size"
                        value={canvasSizeMode}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => onCanvasSizeModeChange(e.target.value)}
                        title="Choose canvas dimensions - Auto fits to source images, presets set exact pixel dimensions for social media"
                        className={styles.sizeSelect}
                    >
                        {CANVAS_SIZES.map(size => (
                            <option key={size.value} value={size.value}>
                                {size.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Target</h4>
                <div className={styles.segmented} role="group" aria-label="Element to adjust">
                    {TOOLS.map(tool => (
                        <button
                            key={tool.value}
                            onClick={() => engine?.setSelectedImage(tool.value)}
                            disabled={!engine}
                            aria-pressed={snap.selectedImage === tool.value}
                            className={cn(styles.segment, snap.selectedImage === tool.value && styles.segmentActive)}
                        >
                            {tool.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Adjust</h4>
                <div className={styles.adjustGrid}>
                    <div className={styles.dpad}>
                        <div />
                        <button
                            onClick={() => engine?.moveImage('up')}
                            disabled={!canAdjust}
                            title={adjustTitle('Move up')}
                            aria-label="Move up"
                            className={styles.dpadButton}
                        >
                            <IconArrowUp size={15} />
                        </button>
                        <div />
                        <button
                            onClick={() => engine?.moveImage('left')}
                            disabled={!canAdjust}
                            title={adjustTitle('Move left')}
                            aria-label="Move left"
                            className={styles.dpadButton}
                        >
                            <IconArrowLeft size={15} />
                        </button>
                        <div className={styles.dpadCenter} aria-hidden="true">⊕</div>
                        <button
                            onClick={() => engine?.moveImage('right')}
                            disabled={!canAdjust}
                            title={adjustTitle('Move right')}
                            aria-label="Move right"
                            className={styles.dpadButton}
                        >
                            <IconArrowRight size={15} />
                        </button>
                        <div />
                        <button
                            onClick={() => engine?.moveImage('down')}
                            disabled={!canAdjust}
                            title={adjustTitle('Move down')}
                            aria-label="Move down"
                            className={styles.dpadButton}
                        >
                            <IconArrowDown size={15} />
                        </button>
                        <div />
                    </div>
                    <div className={styles.transformColumn}>
                        <button
                            onClick={() => engine?.zoomImage('in')}
                            disabled={!canAdjust}
                            title={adjustTitle('Zoom in (or scroll up on the image)')}
                            aria-label="Zoom in"
                            className={styles.iconButton}
                        >
                            <IconZoomIn size={16} />
                        </button>
                        <button
                            onClick={() => engine?.zoomImage('out')}
                            disabled={!canAdjust}
                            title={adjustTitle('Zoom out (or scroll down on the image)')}
                            aria-label="Zoom out"
                            className={styles.iconButton}
                        >
                            <IconZoomOut size={16} />
                        </button>
                        <button
                            onClick={() => engine?.rotateImage('clockwise')}
                            disabled={!canAdjust}
                            title={adjustTitle('Rotate 1° clockwise')}
                            aria-label="Rotate clockwise"
                            className={styles.iconButton}
                        >
                            <IconRotateCw size={16} />
                        </button>
                        <button
                            onClick={() => engine?.rotateImage('counterclockwise')}
                            disabled={!canAdjust}
                            title={adjustTitle('Rotate 1° counter-clockwise')}
                            aria-label="Rotate counter-clockwise"
                            className={styles.iconButton}
                        >
                            <IconRotateCcw size={16} />
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.section}>
                <h4 className={styles.sectionTitle}>View</h4>
                <div className={styles.viewRow}>
                    <button
                        onClick={() => engine?.toggleOrientation()}
                        disabled={!engine}
                        aria-pressed={snap.orientation === 'horizontal'}
                        title="Toggle layout - switch between stacked and side-by-side arrangement"
                        aria-label="Toggle layout orientation"
                        className={cn(styles.iconButton, snap.orientation === 'horizontal' && styles.iconButtonActive)}
                    >
                        <IconLayout size={16} />
                    </button>
                    <button
                        onClick={() => engine?.toggleBisect()}
                        disabled={!engine}
                        aria-pressed={snap.showBisect}
                        title="Toggle bisect line - show/hide the alignment guides between images"
                        aria-label="Toggle bisect line"
                        className={cn(styles.iconButton, snap.showBisect && styles.iconButtonActive)}
                    >
                        <IconBisect size={16} />
                    </button>
                    <button
                        onClick={() => engine?.toggleLogo()}
                        disabled={!engine}
                        aria-pressed={snap.showLogo}
                        title={snap.showLogo ? 'Hide the clinic logo' : 'Show the clinic logo'}
                        aria-label="Toggle clinic logo"
                        className={cn(styles.iconButton, snap.showLogo && styles.iconButtonActive)}
                    >
                        <IconBadge size={16} />
                    </button>
                </div>
                <button
                    onClick={() => engine?.reset()}
                    disabled={!engine}
                    title="Reset all - return every element to its original position, size and rotation"
                    className={styles.resetButton}
                >
                    <IconReset size={15} />
                    Reset all
                </button>
            </div>

            <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Export</h4>
                <div className={styles.exportGrid}>
                    <button
                        onClick={onSave}
                        disabled={!engine || !isReady}
                        title="Download the comparison as a PNG file"
                        className={styles.exportButton}
                    >
                        <IconDownload size={18} />
                        Save
                    </button>
                    <button
                        onClick={onShare}
                        disabled={!isReady || shareStaging}
                        title={nativeShare ? 'Share comparison' : 'Share via LocalSend / Telegram'}
                        className={styles.exportButton}
                    >
                        <IconShare size={18} />
                        {shareStaging ? 'Staging…' : 'Share'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ControlsPanel;
