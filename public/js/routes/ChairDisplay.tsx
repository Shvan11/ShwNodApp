import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { brandingQuery } from '@/query/queries';
import AnalogClock from '../components/react/AnalogClock';
import {
    VISIBILITY_RESUME_THRESHOLD_MS,
    CLOSED_STREAM_RELOAD_DELAY_MS,
    SILENT_STREAM_TIMEOUT_MS,
    LIVENESS_CHECK_INTERVAL_MS,
} from '../constants/sse-liveness';
import { applyResolvedTheme, getStoredThemePreference, resolveTheme } from '../core/theme';
import { applyLanguageAttributes, getStoredLanguagePreference } from '../core/language';
import styles from './ChairDisplay.module.css';

interface ImageEntry {
    name: string;
}

interface LatestVisit {
    visit_date?: string | Date;
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
    // The clinic's own name (Settings → General). The idle screen read "Welcome to
    // Shwan Orthodontics" as a literal on every center's kiosk (audit FE-F11-6).
    const { data: branding } = useQuery(brandingQuery());
    const clinicName = branding?.clinicName?.trim() || null;
    const [patient, setPatient] = useState<PatientPayload | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const hiddenSinceRef = useRef<number | null>(null);
    const reloadTimerRef = useRef<number | null>(null);
    const lastActivityRef = useRef(0);

    // The kiosk is pinned to LIGHT + LTR regardless of the operator's device
    // theme/language. ChairDisplay lives outside RootLayout (no Theme/Language
    // provider), but the FOUC script sets data-theme + lang/dir on <html> on
    // every route — so force light + LTR on mount and restore the stored
    // preferences on unmount (navigating back into the app).
    useLayoutEffect(() => {
        applyResolvedTheme('light');
        applyLanguageAttributes('en');
        return () => {
            applyResolvedTheme(resolveTheme(getStoredThemePreference()));
            applyLanguageAttributes(getStoredLanguagePreference());
        };
    }, []);

    useEffect(() => {
        if (!chairId) return;

        let cancelled = false;

        // Native EventSource auto-reconnects per the server's `retry:` directive.
        // A transport that goes quiet WITHOUT closing is caught by the liveness
        // check below: the server pings every 25 s, and a stream silent for
        // SILENT_STREAM_TIMEOUT_MS is reopened. visibilitychange can't cover it —
        // a wall kiosk is never hidden — and before the check, a kiosk in that
        // state kept showing the last patient to whoever sat down next (FE-F11-7).
        const open = () => {
            if (cancelled) return;
            // Tear down any previous handle before opening a new one.
            if (esRef.current) {
                try { esRef.current.close(); } catch { /* ignore */ }
                esRef.current = null;
            }
            // Authenticated stream (mounted under /api/sse behind the auth gate).
            // Same-origin EventSource sends the session cookie automatically.
            const es = new EventSource(`/api/sse/chair-display/${chairId}`);
            esRef.current = es;
            lastActivityRef.current = Date.now();

            es.onopen = () => {
                if (cancelled) return;
                lastActivityRef.current = Date.now();
                setConnected(true);
            };

            es.addEventListener('ping', () => {
                lastActivityRef.current = Date.now();
            });

            es.onerror = () => {
                if (cancelled) return;
                // CONNECTING means the browser is auto-reconnecting; CLOSED means
                // it gave up. UI shows "Reconnecting…" either way.
                setConnected(false);

                // CLOSED comes from an HTTP error response, not a dropped socket
                // (a dead server leaves it CONNECTING and retrying). Since the
                // stream became session-authenticated, the realistic cause is an
                // expired staff session — and EventSource never retries after a
                // 4xx, so the kiosk would sit on "Reconnecting…" forever. Reload:
                // the web gate then redirects to /login.html, which is a screen a
                // human can act on. Delayed + latched so a server-side 5xx storm
                // can't turn this into a reload loop.
                if (es.readyState === EventSource.CLOSED && reloadTimerRef.current === null) {
                    reloadTimerRef.current = window.setTimeout(() => {
                        if (!cancelled) window.location.reload();
                    }, CLOSED_STREAM_RELOAD_DELAY_MS);
                }
            };

            es.addEventListener('chair_display_patient_loaded', (evt) => {
                if (cancelled) return;
                lastActivityRef.current = Date.now();
                try {
                    setPatient(JSON.parse((evt as MessageEvent).data) as PatientPayload);
                } catch {
                    /* malformed payload — ignore */
                }
            });

            es.addEventListener('chair_display_patient_cleared', () => {
                if (cancelled) return;
                lastActivityRef.current = Date.now();
                setPatient(null);
            });
        };

        open();

        const livenessTimer = window.setInterval(() => {
            const es = esRef.current;
            if (cancelled || !es || es.readyState !== EventSource.OPEN) return;
            if (Date.now() - lastActivityRef.current > SILENT_STREAM_TIMEOUT_MS) {
                setConnected(false);
                open();
            }
        }, LIVENESS_CHECK_INTERVAL_MS);

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
            window.clearInterval(livenessTimer);
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pageshow', handlePageShow);
            if (reloadTimerRef.current !== null) {
                window.clearTimeout(reloadTimerRef.current);
                reloadTimerRef.current = null;
            }
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
    const visitDate = patient?.latestVisit?.visit_date;
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
                        {clinicName ? <>Welcome to <strong>{clinicName}</strong></> : 'Welcome'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChairDisplay;
