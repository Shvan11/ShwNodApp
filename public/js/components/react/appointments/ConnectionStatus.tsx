type ConnectionStatusType = 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'connecting';

interface ConnectionStatusProps {
    status: ConnectionStatusType;
    showFlash?: boolean;
}

/**
 * ConnectionStatus Component
 * Shows WebSocket connection status indicator
 */
const ConnectionStatus = ({ status, showFlash = false }: ConnectionStatusProps) => {
    const getStatusText = (): string => {
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

    const getStatusClass = (): string => {
        return `ws-status-indicator ws-${status}${showFlash ? ' ws-flash' : ''}`;
    };

    return (
        <div className={getStatusClass()}>
            <span className="ws-status-dot"></span>
            <span className="ws-status-text">{getStatusText()}</span>
        </div>
    );
};

export type { ConnectionStatusType, ConnectionStatusProps };
export default ConnectionStatus;
