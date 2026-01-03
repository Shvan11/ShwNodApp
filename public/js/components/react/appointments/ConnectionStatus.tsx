import styles from './ConnectionStatus.module.css';

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
        const statusStyles: Record<ConnectionStatusType, string> = {
            connected: styles.connected,
            disconnected: styles.disconnected,
            reconnecting: styles.reconnecting,
            error: styles.error,
            connecting: styles.connecting
        };
        return `${statusStyles[status] || styles.indicator}${showFlash ? ` ${styles.flash}` : ''}`;
    };

    return (
        <div className={getStatusClass()}>
            <span className={styles.dot}></span>
            <span className={styles.text}>{getStatusText()}</span>
        </div>
    );
};

export type { ConnectionStatusType, ConnectionStatusProps };
export default ConnectionStatus;
