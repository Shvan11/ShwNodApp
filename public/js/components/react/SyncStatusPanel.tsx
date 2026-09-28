import { useEffect } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import type { SyncClockReport, SyncDriftReport, SyncSinkStatus, SyncSinkStatusResponse } from '@/query/queries';
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

/**
 * A backlog whose oldest entry is older than this has stopped draining rather than being mid-cycle,
 * and the card says so in words instead of leaving the reader to subtract two timestamps. Matches
 * STUCK_BACKLOG_WARN_SEC in services/sync/cdc/engine.ts, which logs the same threshold server-side.
 */
const STUCK_BACKLOG_SEC = 3600;

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

/** Coarse age in the largest unit that still reads naturally — "3 days", not "259,200 s". */
function formatAge(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86_400) return `${Math.floor(sec / 3600)}h`;
    const days = Math.floor(sec / 86_400);
    return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The mirror row-count sweep, shown above the sink cards because it is the one line here that
 * reports on data rather than on plumbing: a sink can be enabled, reachable, empty-backlogged and
 * not stale while the mirror is missing a day of clinic writes (audit F1a/F1f). A clean sweep is
 * stated too — "identical" is the reassurance the old card could never give.
 */
const DriftBanner = ({ drift }: { drift: SyncDriftReport }) => {
    if (drift.error) {
        return (
            <div className={styles.errorBanner}>
                <i className="fas fa-exclamation-triangle"></i>
                <span>
                    Mirror comparison could not run — {drift.error}
                    <span className={styles.subtle}> · attempted {formatTime(drift.checkedAt)}</span>
                </span>
            </div>
        );
    }
    if (drift.tables.length === 0) {
        return (
            <div className={styles.driftOk}>
                <i className="fas fa-check-circle"></i>
                <span>
                    Mirror matches local — {drift.tablesChecked} captured table(s) identical
                    <span className={styles.subtle}> · checked {formatTime(drift.checkedAt)}</span>
                </span>
            </div>
        );
    }
    return (
        <div className={styles.errorBanner}>
            <i className="fas fa-exclamation-triangle"></i>
            <span>
                Mirror diverged — {drift.missing.toLocaleString()} row(s) missing from the mirror
                {drift.extra > 0 && `, ${drift.extra.toLocaleString()} only on the mirror`}, across{' '}
                {drift.tables.length} of {drift.tablesChecked} table(s):{' '}
                {drift.tables
                    .slice(0, 5)
                    .map((t) => (t.setMismatch ? `${t.tbl} (same count, different rows)` : `${t.tbl} ${t.local}/${t.mirror}`))
                    .join(', ')}
                {drift.tables.length > 5 && ` +${drift.tables.length - 5} more`}.
                <span className={styles.subtle}>
                    {' '}
                    · checked {formatTime(drift.checkedAt)} · repair with{' '}
                    <code>node scripts/reconcile-mirror.mjs --apply</code>
                </span>
            </span>
        </div>
    );
};

function formatOffset(offsetSec: number): string {
    const sign = offsetSec < 0 ? '-' : '+';
    const abs = Math.abs(offsetSec);
    return `UTC${sign}${String(Math.floor(abs / 3600)).padStart(2, '0')}:${String(Math.floor((abs % 3600) / 60)).padStart(2, '0')}`;
}

/**
 * The clock-alignment check: the app server, local PostgreSQL and the mirror must stamp wall-clock
 * time in one zone, or every portal-written time is off by the gap and reverse-sync last-write-wins
 * misjudges which edit is newer (audit FE-F5-1). Like the drift banner, a clean result is stated —
 * with the zone — so the reader can see what was actually compared.
 */
const ClockBanner = ({ clock }: { clock: SyncClockReport }) => {
    if (clock.mismatches.length > 0) {
        return (
            <div className={styles.errorBanner}>
                <i className="fas fa-clock"></i>
                <span>
                    Clocks disagree — {clock.mismatches.join(' ')}
                    <span className={styles.subtle}> · checked {formatTime(clock.checkedAt)}</span>
                </span>
            </div>
        );
    }
    if (clock.error || !clock.local) {
        return (
            <div className={styles.errorBanner}>
                <i className="fas fa-exclamation-triangle"></i>
                <span>
                    Clock check could not read every clock — {clock.error ?? 'local database unreadable'}
                    <span className={styles.subtle}> · attempted {formatTime(clock.checkedAt)}</span>
                </span>
            </div>
        );
    }
    return (
        <div className={styles.driftOk}>
            <i className="fas fa-clock"></i>
            <span>
                Clocks agree — {clock.local.tz} ({formatOffset(clock.local.offsetSec)}) on the app server, local
                database{clock.mirror ? ' and mirror' : ''}
                <span className={styles.subtle}> · checked {formatTime(clock.checkedAt)}</span>
            </span>
        </div>
    );
};

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
    // Only the Supabase endpoint sends these two; the Dolphin one omits both fields entirely.
    const drift = status?.drift ?? null;
    const clock = status?.clock ?? null;

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

            {clock && <ClockBanner clock={clock} />}
            {drift && <DriftBanner drift={drift} />}

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
                                        <dt>Oldest pending</dt>
                                        <dd
                                            className={
                                                s.backlogAgeSec != null && s.backlogAgeSec >= STUCK_BACKLOG_SEC
                                                    ? styles.warnText
                                                    : ''
                                            }
                                        >
                                            {s.backlogAgeSec == null ? (
                                                '—'
                                            ) : (
                                                <>
                                                    {formatAge(s.backlogAgeSec)} ago
                                                    {s.backlogAgeSec >= STUCK_BACKLOG_SEC && ' — not draining'}
                                                    {s.oldestChangeAt && (
                                                        <span className={styles.subtle}>
                                                            {' '}
                                                            · {formatTime(s.oldestChangeAt)}
                                                        </span>
                                                    )}
                                                </>
                                            )}
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
