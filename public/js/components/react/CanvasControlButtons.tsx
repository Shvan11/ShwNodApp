/**
 * CanvasControlButtons - Canvas control interface component
 *
 * Provides control buttons for canvas manipulation and image operations
 */

import React from 'react';
import styles from './CanvasControlButtons.module.css';

interface ComparisonHandler {
    zoomIn?: () => void;
    zoomOut?: () => void;
    rotateImage?: (direction: 'clockwise' | 'counter') => void;
    resetImage?: () => void;
}

interface Props {
    comparison: ComparisonHandler | null;
    showWhatsAppModal: boolean;
    setShowWhatsAppModal: (show: boolean) => void;
}

const CanvasControlButtons = ({ comparison, showWhatsAppModal, setShowWhatsAppModal }: Props) => {
    return (
        <div className={styles.controls}>
            {/* Zoom In Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomIn?.()}
                title="Zoom In"
                className={styles.btnZoomIn}
            >
                🔍+
            </button>

            {/* Zoom Out Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomOut?.()}
                title="Zoom Out"
                className={styles.btnZoomOut}
            >
                🔍-
            </button>

            {/* Rotate Clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage?.('clockwise')}
                title="Rotate Clockwise"
                className={styles.btnRotate}
            >
                ↻
            </button>

            {/* Rotate Counter-clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage?.('counter')}
                title="Rotate Counter-clockwise"
                className={styles.btnRotate}
            >
                ↺
            </button>

            {/* Reset Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.resetImage?.()}
                title="Reset Image"
                className={styles.btnReset}
            >
                🔄
            </button>

            {/* WhatsApp Button */}
            <button
                type="button"
                onClick={() => setShowWhatsAppModal(!showWhatsAppModal)}
                title="Send via WhatsApp"
                className={styles.btnWhatsapp}
            >
                📱
            </button>
        </div>
    );
};

export default CanvasControlButtons;
