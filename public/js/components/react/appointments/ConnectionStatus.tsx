import styles from './ConnectionStatus.module.css';

type ConnectionStatusType = 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'connecting';
type FreshnessType = 'fresh' | 'stale';

interface ConnectionStatusProps {
    status: ConnectionStatusType;
    freshness: FreshnessType;
    isViewingToday: boolean;
    showFlash?: boolean;
}

/**
 * ConnectionStatus Component
 * Honest indicator: only shows "Live" when both the socket is OPEN and the
 * server heartbeat has been received recently. Past/future dates render as
 * "Static" because WebSocket subscriptions don't apply to non-today views.
 */
const ConnectionStatus = ({ status, freshness, isViewingToday, showFlash = false }: ConnectionStatusProps) => {
    type EffectiveState = 'static' | 'live' | 'stale' | 'reconnecting' | 'disconnected' | 'error' | 'connecting';

    const effective: EffectiveState = !isViewingToday
        ? 'static'
        : status === 'connected'
            ? (freshness === 'fresh' ? 'live' : 'stale')
            : status;

    const getStatusText = (): string => {
        switch (effective) {
            case 'static': return 'Static';
            case 'live': return 'Live';
            case 'stale': return 'Stale — Resyncing';
            case 'disconnected': return 'Offline';
            case 'reconnecting': return 'Reconnecting...';
            case 'error': return 'Connection Error';
            default: return 'Connecting...';
        }
    };

    const getStatusClass = (): string => {
        const map: Record<EffectiveState, string> = {
            static: styles.static,
            live: styles.connected,
            stale: styles.stale,
            disconnected: styles.disconnected,
            reconnecting: styles.reconnecting,
            error: styles.error,
            connecting: styles.connecting,
        };
        return `${map[effective] || styles.indicator}${showFlash ? ` ${styles.flash}` : ''}`;
    };

    return (
        <div className={getStatusClass()}>
            <span className={styles.dot}></span>
            <span className={styles.text}>{getStatusText()}</span>
        </div>
    );
};

export type { ConnectionStatusType, ConnectionStatusProps, FreshnessType };
export default ConnectionStatus;
