import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnalogClock from '../components/react/AnalogClock';
import { VISIBILITY_RESUME_THRESHOLD_MS } from '../constants/websocket-liveness';
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

const ChairDisplay = () => {
    const [searchParams] = useSearchParams();
    const chairParam = searchParams.get('chair');
    const chairId = useMemo(() => (chairParam && /^([1-9]|10)$/.test(chairParam) ? chairParam : null), [chairParam]);

    const [connected, setConnected] = useState(false);
    const [patient, setPatient] = useState<PatientPayload | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const hiddenSinceRef = useRef<number | null>(null);

    useEffect(() => {
        if (!chairId) return;

        let cancelled = false;

        // Native EventSource auto-reconnects per the server's `retry: 3000`
        // directive — no manual reconnect loop or liveness timer needed.
        // visibilitychange / pageshow handle the silent-NAT-drop case.
        const open = () => {
            if (cancelled) return;
            // Tear down any previous handle before opening a new one.
            if (esRef.current) {
                try { esRef.current.close(); } catch { /* ignore */ }
                esRef.current = null;
            }
            const es = new EventSource(`/sse/chair-display/${chairId}`);
            esRef.current = es;

            es.onopen = () => {
                if (cancelled) return;
                setConnected(true);
            };

            es.onerror = () => {
                if (cancelled) return;
                // CONNECTING means the browser is auto-reconnecting; CLOSED
                // means it gave up (e.g. 4xx). UI shows "Reconnecting…" either way.
                setConnected(false);
            };

            es.addEventListener('chair_display_patient_loaded', (evt) => {
                if (cancelled) return;
                try {
                    setPatient(JSON.parse((evt as MessageEvent).data) as PatientPayload);
                } catch {
                    /* malformed payload — ignore */
                }
            });

            es.addEventListener('chair_display_patient_cleared', () => {
                if (cancelled) return;
                setPatient(null);
            });
        };

        open();

        const handleVisibility = () => {
            if (cancelled) return;
            if (document.visibilityState === 'hidden') {
                hiddenSinceRef.current = performance.now();
                return;
            }
            const since = hiddenSinceRef.current;
            hiddenSinceRef.current = null;
            if (since && performance.now() - since > VISIBILITY_RESUME_THRESHOLD_MS) {
                open();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        const handlePageShow = (evt: PageTransitionEvent) => {
            if (cancelled) return;
            if (evt.persisted) open(); // iOS bfcache restore
        };
        window.addEventListener('pageshow', handlePageShow);

        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pageshow', handlePageShow);
            if (esRef.current) {
                try { esRef.current.close(); } catch { /* ignore */ }
                esRef.current = null;
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
