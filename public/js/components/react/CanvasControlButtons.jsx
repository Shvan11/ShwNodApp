/**
 * CanvasControlButtons - Canvas control interface component
 * 
 * Provides control buttons for canvas manipulation and image operations
 */

import React from 'react'

const CanvasControlButtons = ({ comparison, showWhatsAppModal, setShowWhatsAppModal }) => {
    return (
        <div className="canvas-controls">
            {/* Zoom In Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomIn()}
                title="Zoom In"
                className="btn-zoom-in"
            >
                🔍+
            </button>

            {/* Zoom Out Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomOut()}
                title="Zoom Out"
                className="btn-zoom-out"
            >
                🔍-
            </button>

            {/* Rotate Clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage('clockwise')}
                title="Rotate Clockwise"
                className="btn-rotate"
            >
                ↻
            </button>

            {/* Rotate Counter-clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage('counter')}
                title="Rotate Counter-clockwise"
                className="btn-rotate"
            >
                ↺
            </button>

            {/* Reset Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.resetImage()}
                title="Reset Image"
                className="btn-reset"
            >
                🔄
            </button>

            {/* WhatsApp Button */}
            <button
                type="button"
                onClick={() => setShowWhatsAppModal(!showWhatsAppModal)}
                title="Send via WhatsApp"
                className="btn-whatsapp"
            >
                📱
            </button>
        </div>
    );
};

export default CanvasControlButtons;