// CanvasControlButtons.js - React component for canvas control buttons
const CanvasControlButtons = ({ comparison, showWhatsAppModal, setShowWhatsAppModal }) => {
    return React.createElement('div', {
        className: 'canvas-controls',
        style: {
            position: 'absolute',
            top: '10px',
            right: '10px',
            display: 'flex',
            gap: '8px',
            zIndex: 1000,
            flexWrap: 'wrap'
        }
    }, [
        // Zoom In Button
        React.createElement('button', {
            key: 'zoom-in',
            type: 'button',
            onClick: () => comparison && comparison.zoomIn(),
            title: 'Zoom In',
            style: {
                padding: '8px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '🔍+'),

        // Zoom Out Button
        React.createElement('button', {
            key: 'zoom-out',
            type: 'button',
            onClick: () => comparison && comparison.zoomOut(),
            title: 'Zoom Out',
            style: {
                padding: '8px 12px',
                backgroundColor: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '🔍-'),

        // Rotate Clockwise Button
        React.createElement('button', {
            key: 'rotate-cw',
            type: 'button',
            onClick: () => comparison && comparison.rotateImage('clockwise'),
            title: 'Rotate Clockwise',
            style: {
                padding: '8px 12px',
                backgroundColor: '#fd7e14',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '↻'),

        // Rotate Counter-clockwise Button
        React.createElement('button', {
            key: 'rotate-ccw',
            type: 'button',
            onClick: () => comparison && comparison.rotateImage('counter'),
            title: 'Rotate Counter-clockwise',
            style: {
                padding: '8px 12px',
                backgroundColor: '#fd7e14',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '↺'),

        // Reset Button
        React.createElement('button', {
            key: 'reset',
            type: 'button',
            onClick: () => comparison && comparison.resetImage(),
            title: 'Reset Image',
            style: {
                padding: '8px 12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '🔄'),

        // WhatsApp Button
        React.createElement('button', {
            key: 'whatsapp',
            type: 'button',
            onClick: () => setShowWhatsAppModal(!showWhatsAppModal),
            title: 'Send via WhatsApp',
            style: {
                padding: '8px 12px',
                backgroundColor: '#25d366',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer'
            }
        }, '📱')
    ]);
};

// Export for use in other components
window.CanvasControlButtons = CanvasControlButtons;