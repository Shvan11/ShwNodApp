import { useEffect } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import type { SyncSinkStatus, SyncSinkStatusResponse } from '@/query/queries';
import styles from './SyncStatusPanel.module.css';

/**
 * The read-only CDC sink-health panel, shared by the two Settings tabs that show
 * one: Supabase (`SupabaseStatusSettings`, sinks 'failover' + 'reverse') and
 * Dolphin (`DolphinStatusSettings`, sink 'dolphin'). Both endpoints answer the
 * same shape (routes/sync-webhook.ts), so the card, the health rules and the
 * poll live here once and each tab supplies only its own copy.
 *
 * Neither tab ever reports unsaved changes, so no Save badge is ever shown.
 */

/**
 * How often a sink-status tab re-checks. Owned here so both tabs poll alike;
 * they pass it to their own `useQuery` (see the note on `result` below). Polling
 * stops when the tab is closed.
 */
export const SYNC_STATUS_POLL_MS = 10_000;

type Health = 'ok' | 'warn' | 'down' | 'off';

const HEALTH_LABEL: Record<Health, string> = {
    ok: 'Online',
    warn: 'Degraded',
    down: 'Unreachable',
    off: 'Disabled',
};

function sinkHealth(s: SyncSinkStatus): Health {
    if (!s.configured || !s.enabled) return 'off';
    if (s.reachable === false) return 'down';
    if (s.stale || s.backlog > 0) return 'warn';
    return 'ok';
}

function formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export interface SyncStatusPanelProps {
    /**
     * The already-run status query. The caller owns the `useQuery` because
     * `queryOptions()` brands its key as a literal tuple and `UseQueryOptions` is
     * invariant in that key — the two factories' option types can neither be
     * unioned nor widened into one prop. `UseQueryResult` carries no key generic,
     * so taking the RESULT is the seam that actually type-checks, and it leaves
     * this component purely presentational.
     */
    result: UseQueryResult<SyncSinkStatusResponse, Error>;
    /** Font Awesome class for the heading icon. */
    icon: string;
    title: string;
    description: string;
    /** Noun for the loading line and the fallback error text ("Supabase"/"Dolphin"). */
    subject: string;
    /** Per-sink display copy, keyed by sink name. */
    sinkMeta: Record<string, { label: string; description: string }>;
    /** What "not configured" means for this feed, e.g. 'env vars missing'. */
    notConfiguredHint: string;
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const SyncStatusPanel = ({
    result,
    icon,
    title,
    description,
    subject,
    sinkMeta,
    notConfiguredHint,
    onChangesUpdate,
}: SyncStatusPanelProps) => {
    const { data: status, isLoading, isError, error: queryError, refetch } = result;
    const sinks = status?.sinks ?? null;
    const checkedAt = status?.checkedAt ?? null;

    // Surface either a transport error (thrown) or a server-reported failure
    // ({ success:false } / no sinks) — these endpoints answer 200 on a sink
    // outage, so the second path is the one that usually fires.
    const fallback = `Failed to load ${subject} status`;
    const error = isError
        ? httpErrorMessage(queryError, fallback)
        : status && (!status.success || !status.sinks)
          ? status.error || fallback
          : null;

    // Read-only: explicitly declare no unsaved changes so no Save badge shows.
    useEffect(() => {
        onChangesUpdate?.(false);
    }, [onChangesUpdate]);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>
                        <i className={icon}></i>
                        {title}
                    </h3>
                    <p className={styles.description}>
                        {description} Refreshes automatically every {SYNC_STATUS_POLL_MS / 1000}s.
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
                    <span>Checking {subject} status…</span>
                </div>
            ) : (
                <div className={styles.cards}>
                    {sinks?.map((s) => {
                        const health = sinkHealth(s);
                        // Fall back to the raw sink name so a sink added server-side
                        // renders as an unlabelled card instead of throwing.
                        const meta = sinkMeta[s.sink] ?? { label: s.sink, description: '' };
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
                                        <dd>{s.configured ? 'Yes' : `No (${notConfiguredHint})`}</dd>
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

export default SyncStatusPanel;
