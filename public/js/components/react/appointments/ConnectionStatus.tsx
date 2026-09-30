import { useTranslation } from 'react-i18next';
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
 * Honest indicator: "Live" needs the SSE stream OPEN. The shared channel
 * (services/sse-channel.ts) reopens a stream that has been silent past two
 * missed server pings (it then reads "Reconnecting…") and retries one the
 * browser gave up on (a proxy's 502 during a restart). Past/future dates render
 * as "Static" because SSE subscriptions don't apply to non-today views.
 */
const ConnectionStatus = ({ status, freshness, isViewingToday, showFlash = false }: ConnectionStatusProps) => {
    const { t } = useTranslation('appointments');

    type EffectiveState = 'static' | 'live' | 'stale' | 'reconnecting' | 'disconnected' | 'error' | 'connecting';

    const effective: EffectiveState = !isViewingToday
        ? 'static'
        : status === 'connected'
            ? (freshness === 'fresh' ? 'live' : 'stale')
            : status;

    const getStatusText = (): string => {
        switch (effective) {
            case 'static': return t('connection.static');
            case 'live': return t('connection.live');
            case 'stale': return t('connection.stale');
            case 'disconnected': return t('connection.offline');
            case 'reconnecting': return t('connection.reconnecting');
            case 'error': return t('connection.error');
            default: return t('connection.connecting');
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
