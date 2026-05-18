import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnalogClock from '../components/react/AnalogClock';
import { WebSocketEvents } from '../constants/websocket-events';
import styles from './ChairDisplay.module.css';

interface ImageEntry {
    name: string;
}

interface LatestVisit {
    VisitDate?: string | Date;
    Summary?: string | null;
}

interface PatientPayload {
    pid: string;
    name?: string | null;
    images: ImageEntry[];
    latestVisit?: LatestVisit | null;
}

/**
 * The latest-visit Summary string is HTML emitted by the ProlatestVisitSum stored
 * procedure (literal `<br>` separators and `<font color=blue>...</font>` for the
 * "Next" line). Parts of it interpolate user-typed visit fields (Others, NextVisit,
 * etc.), so we can't render it verbatim with dangerouslySetInnerHTML.
 *
 * Strategy: HTML-escape everything, then re-enable only the small allowlist of
 * tags the SP itself produces. Anything a user typed remains escaped.
 */
const renderVisitSummary = (raw: string): string => {
    const escaped = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    return escaped
        .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
        .replace(/&lt;font color=blue&gt;/gi, '<span class="visit-next">')
        .replace(/&lt;\/font&gt;/gi, '</span>');
};

const buildWsUrl = (chairId: string): string => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const apiUrl = import.meta.env.VITE_API_URL;
    let host: string;
    try {
        host = apiUrl ? new URL(apiUrl).host : location.host;
    } catch {
        host = location.host;
    }
    const params = new URLSearchParams({
        clientType: 'chair-display',
        chairId,
    });
    return `${protocol}//${host}/?${params.toString()}`;
};

// Trigger a forced reconnect if the kiosk hasn't seen any message (including
// the 15s server heartbeat) in this many ms. Tolerates one missed heartbeat.
const KIOSK_STALE_THRESHOLD_MS = 35_000;
const KIOSK_LIVENESS_POLL_MS = 10_000;
// Only force a reconnect on visibility-return if the tab was hidden for at
// least this long — short Alt-Tabs don't need disruption.
const KIOSK_VISIBILITY_RESUME_MS = 2 * 60 * 1000;

const ChairDisplay = () => {
    const [searchParams] = useSearchParams();
    const chairParam = searchParams.get('chair');
    const chairId = useMemo(() => (chairParam && /^([1-9]|10)$/.test(chairParam) ? chairParam : null), [chairParam]);

    const [connected, setConnected] = useState(false);
    const [patient, setPatient] = useState<PatientPayload | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const lastMessageAtRef = useRef<number>(Date.now());
    const hiddenSinceRef = useRef<number | null>(null);

    useEffect(() => {
        if (!chairId) return;

        let cancelled = false;

        const connect = () => {
            if (cancelled) return;
            try {
                const ws = new WebSocket(buildWsUrl(chairId));
                wsRef.current = ws;

                ws.onopen = () => {
                    if (cancelled) return;
                    setConnected(true);
                    lastMessageAtRef.current = Date.now();
                };

                ws.onmessage = (event) => {
                    if (cancelled) return;
                    lastMessageAtRef.current = Date.now();
                    let data: { type?: string; data?: unknown } | null = null;
                    try {
                        data = JSON.parse(event.data);
                    } catch {
                        return;
                    }
                    if (!data || typeof data !== 'object') return;

                    if (data.type === WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED) {
                        setPatient(data.data as PatientPayload);
                    } else if (data.type === WebSocketEvents.CHAIR_DISPLAY_PATIENT_CLEARED) {
                        setPatient(null);
                    }
                };

                ws.onclose = () => {
                    if (cancelled) return;
                    setConnected(false);
                    wsRef.current = null;
                    reconnectTimerRef.current = window.setTimeout(connect, 3000);
                };

                ws.onerror = () => {
                    // Let onclose handle reconnect
                };
            } catch {
                if (!cancelled) {
                    reconnectTimerRef.current = window.setTimeout(connect, 3000);
                }
            }
        };

        connect();

        // Liveness check: if no message (including 15s SERVER_HEARTBEAT) has
        // arrived in KIOSK_STALE_THRESHOLD_MS, force-close the socket so the
        // reconnect path runs and the indicator flips to "Reconnecting…".
        const livenessInterval = window.setInterval(() => {
            if (cancelled) return;
            const elapsed = Date.now() - lastMessageAtRef.current;
            if (elapsed > KIOSK_STALE_THRESHOLD_MS && wsRef.current) {
                try {
                    wsRef.current.close(1000, 'liveness timeout');
                } catch {
                    /* ignore */
                }
            }
        }, KIOSK_LIVENESS_POLL_MS);

        const handleVisibility = () => {
            if (cancelled) return;
            if (document.visibilityState === 'hidden') {
                hiddenSinceRef.current = Date.now();
                return;
            }
            const since = hiddenSinceRef.current;
            hiddenSinceRef.current = null;
            if (since && Date.now() - since > KIOSK_VISIBILITY_RESUME_MS && wsRef.current) {
                try {
                    wsRef.current.close(1000, 'visibility resume');
                } catch {
                    /* ignore */
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            cancelled = true;
            window.clearInterval(livenessInterval);
            document.removeEventListener('visibilitychange', handleVisibility);
            if (reconnectTimerRef.current !== null) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onopen = null;
                wsRef.current.onmessage = null;
                wsRef.current.onclose = null;
                wsRef.current.onerror = null;
                try {
                    wsRef.current.close();
                } catch {
                    /* ignore */
                }
                wsRef.current = null;
            }
        };
    }, [chairId]);

    if (!chairId) {
        return (
            <div className={styles.root}>
                <div className={styles.notConfigured}>
                    <div>
                        <h1>Chair not configured</h1>
                        <p>
                            Open this page with a chair number in the URL, e.g.{' '}
                            <code>/chair-display?chair=2</code>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const visitSummary = patient?.latestVisit?.Summary;
    const visitDate = patient?.latestVisit?.VisitDate;
    const formattedVisitDate = visitDate
        ? new Date(visitDate).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
          })
        : null;

    return (
        <div className={styles.root}>
            <div className={styles.chairBadge}>Chair {chairId}</div>
            <div
                className={`${styles.connectionBadge} ${
                    connected ? styles.connectionConnected : styles.connectionLost
                }`}
            >
                {connected ? '● Connected' : '○ Reconnecting…'}
            </div>

            {patient ? (
                <div className={styles.patientView}>
                    <div className={styles.patientHeader}>
                        <div className={styles.patientHeaderLeft}>
                            <div className={styles.patientLabel}>Now Seeing</div>
                            <h1 className={styles.patientName}>
                                {patient.name?.trim() || `Patient #${patient.pid}`}
                            </h1>
                        </div>
                        <div className={styles.cornerClock}>
                            <AnalogClock size={140} showDate={false} />
                        </div>
                    </div>

                    <div className={styles.imagesGrid}>
                        {patient.images.length === 0 ? (
                            <div className={styles.noImages}>No intraoral photos on file</div>
                        ) : (
                            patient.images.map((img) => (
                                <img
                                    key={img.name}
                                    src={`/DolImgs/${img.name}`}
                                    alt={`Intraoral ${img.name}`}
                                />
                            ))
                        )}
                    </div>

                    {visitSummary && (
                        <div className={styles.visitNote}>
                            <div className={styles.visitNoteLabel}>
                                Latest Visit{formattedVisitDate ? ` · ${formattedVisitDate}` : ''}
                            </div>
                            <div
                                className={styles.visitNoteContent}
                                dangerouslySetInnerHTML={{ __html: renderVisitSummary(visitSummary) }}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className={styles.idle}>
                    <div className={styles.idleClockWrap}>
                        <AnalogClock size={Math.min(window.innerHeight * 0.5, window.innerWidth * 0.5)} />
                    </div>
                    <div className={styles.clinicCaption}>
                        Welcome to <strong>Shwan Orthodontics</strong>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChairDisplay;
