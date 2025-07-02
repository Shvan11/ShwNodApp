/**
 * CanvasControlButtons - Canvas control interface component
 * 
 * Provides control buttons for canvas manipulation and image operations
 */

import React from 'react'

const CanvasControlButtons = ({ comparison, showWhatsAppModal, setShowWhatsAppModal }) => {
    return (
        <div 
            className="canvas-controls"
            style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                display: 'flex',
                gap: '8px',
                zIndex: 1000,
                flexWrap: 'wrap'
            }}
        >
            {/* Zoom In Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomIn()}
                title="Zoom In"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                🔍+
            </button>

            {/* Zoom Out Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.zoomOut()}
                title="Zoom Out"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                🔍-
            </button>

            {/* Rotate Clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage('clockwise')}
                title="Rotate Clockwise"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#fd7e14',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                ↻
            </button>

            {/* Rotate Counter-clockwise Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.rotateImage('counter')}
                title="Rotate Counter-clockwise"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#fd7e14',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                ↺
            </button>

            {/* Reset Button */}
            <button
                type="button"
                onClick={() => comparison && comparison.resetImage()}
                title="Reset Image"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                🔄
            </button>

            {/* WhatsApp Button */}
            <button
                type="button"
                onClick={() => setShowWhatsAppModal(!showWhatsAppModal)}
                title="Send via WhatsApp"
                style={{
                    padding: '8px 12px',
                    backgroundColor: '#25d366',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer'
                }}
            >
                📱
            </button>
        </div>
    );
};

export default CanvasControlButtons;