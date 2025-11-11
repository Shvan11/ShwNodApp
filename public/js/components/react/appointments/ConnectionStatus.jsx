import React from 'react';

/**
 * ConnectionStatus Component
 * Shows WebSocket connection status indicator
 */
const ConnectionStatus = ({ status, showFlash }) => {
    const getStatusText = () => {
        switch (status) {
            case 'connected':
                return 'Live';
            case 'disconnected':
                return 'Offline';
            case 'reconnecting':
                return 'Reconnecting...';
            case 'error':
                return 'Connection Error';
            default:
                return 'Connecting...';
        }
    };

    const getStatusClass = () => {
        return `ws-status-indicator ws-${status}${showFlash ? ' ws-flash' : ''}`;
    };

    return (
        <div className={getStatusClass()}>
            <span className="ws-status-dot"></span>
            <span className="ws-status-text">{getStatusText()}</span>
        </div>
    );
};

export default ConnectionStatus;
