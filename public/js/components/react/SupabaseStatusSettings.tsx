import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import { supabaseStatusQuery } from '@/query/queries';
import styles from './SupabaseStatusSettings.module.css';

/**
 * Read-only Settings tab: live status of the single Supabase CDC mirror (sink 'failover').
 * Polls GET /api/sync/supabase-status every POLL_MS. Never reports unsaved changes, so the
 * tab never shows a Save badge.
 */

const POLL_MS = 10_000;

interface SinkStatus {
    sink: 'failover' | 'reverse';
    configured: boolean;
    envEnabled: boolean;
    enabled: boolean;
    stale: boolean;
    note: string | null;
    updatedAt: string | null;
    backlog: number;
    reachable: boolean | null;
    latencyMs: number | null;
    error: string | null;
}

interface StatusResponse {
    success: boolean;
    checkedAt?: string;
    sinks?: SinkStatus[];
    error?: string;
}

interface SupabaseStatusSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const SINK_META: Record<SinkStatus['sink'], { label: string; description: string }> = {
    failover: {
        label: 'Database mirror',
        description: 'Raw 1:1 mirror → the single Supabase database (the portal\'s serving source).',
    },
    reverse: {
        label: 'Reverse sync',
        description: 'Two-way path: web/portal edits on Supabase → applied back to local (last-write-wins).',
    },
};

type Health = 'ok' | 'warn' | 'down' | 'off';

function sinkHealth(s: SinkStatus): Health {
    if (!s.configured || !s.enabled) return 'off';
    if (s.reachable === false) return 'down';
    if (s.stale || s.backlog > 0) return 'warn';
    return 'ok';
}

const HEALTH_LABEL: Record<Health, string> = {
    ok: 'Online',
    warn: 'Degraded',
    down: 'Unreachable',
    off: 'Disabled',
};

function formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const SupabaseStatusSettings = ({ onChangesUpdate }: SupabaseStatusSettingsProps) => {
    const { data, isLoading, isError, error: queryError, refetch } = useQuery({
        ...supabaseStatusQuery(),
        refetchInterval: POLL_MS,
    });
    const status = data as StatusResponse | undefined;
    const sinks = status?.sinks ?? null;
    const checkedAt = status?.checkedAt ?? null;

    // Surface either a transport error (thrown) or a server-reported failure
    // ({ success:false } / no sinks) — mirroring the prior fetch's two paths.
    const error = isError
        ? httpErrorMessage(queryError, 'Failed to load Supabase status')
        : status && (!status.success || !status.sinks)
          ? status.error || 'Failed to load Supabase status'
          : null;

    // Read-only tab: explicitly declare no unsaved changes so no Save badge ever shows.
    useEffect(() => {
        onChangesUpdate?.(false);
    }, [onChangesUpdate]);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>
                        <i className="fas fa-cloud"></i>
                        Supabase Sync Status
                    </h3>
                    <p className={styles.description}>
                        Live reachability of the Supabase replication sinks. Refreshes automatically every{' '}
                        {POLL_MS / 1000}s.
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <span className={styles.checkedAt}>Last checked: {formatTime(checkedAt)}</span>
                    <button
                        type="button"
                        className={styles.refreshBtn}
                        onClick={() => refetch()}
                        disabled={isLoading}
                    >
                        <i className={`fas fa-sync-alt ${isLoading ? styles.spin : ''}`}></i>
                        Refresh now
                    </button>
                </div>
            </div>

            {error && (
                <div className={styles.errorBanner}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <span>{error}</span>
                </div>
            )}

            {isLoading && !sinks ? (
                <div className={styles.loading}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Checking Supabase status…</span>
                </div>
            ) : (
                <div className={styles.cards}>
                    {sinks?.map((s) => {
                        const health = sinkHealth(s);
                        const meta = SINK_META[s.sink];
                        return (
                            <div key={s.sink} className={`${styles.card} ${styles[health]}`}>
                                <div className={styles.cardHeader}>
                                    <span className={styles.sinkName}>{meta.label}</span>
                                    <span className={`${styles.badge} ${styles[health]}`}>
                                        <span className={styles.dot}></span>
                                        {HEALTH_LABEL[health]}
                                    </span>
                                </div>
                                <p className={styles.sinkDescription}>{meta.description}</p>

                                <dl className={styles.rows}>
                                    <div className={styles.row}>
                                        <dt>Configured</dt>
                                        <dd>{s.configured ? 'Yes' : 'No (env vars missing)'}</dd>
                                    </div>
                                    <div className={styles.row}>
                                        <dt>Reachable</dt>
                                        <dd>
                                            {!s.configured
                                                ? '—'
                                                : s.reachable
                                                  ? `Yes${s.latencyMs != null ? ` (${s.latencyMs} ms)` : ''}`
                                                  : `No${s.error ? ` — ${s.error}` : ''}`}
                                        </dd>
                                    </div>
                                    <div className={styles.row}>
                                        <dt>Capture enabled</dt>
                                        <dd>{s.enabled ? 'Yes' : 'No'}</dd>
                                    </div>
                                    <div className={styles.row}>
                                        <dt>Stale (needs reload)</dt>
                                        <dd className={s.stale ? styles.warnText : ''}>{s.stale ? 'Yes' : 'No'}</dd>
                                    </div>
                                    <div className={styles.row}>
                                        <dt>Pending backlog</dt>
                                        <dd className={s.backlog > 0 ? styles.warnText : ''}>
                                            {s.backlog.toLocaleString()} change(s)
                                        </dd>
                                    </div>
                                    <div className={styles.row}>
                                        <dt>Last status</dt>
                                        <dd>
                                            {s.note || '—'}
                                            {s.updatedAt && (
                                                <span className={styles.subtle}> · {formatTime(s.updatedAt)}</span>
                                            )}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SupabaseStatusSettings;
