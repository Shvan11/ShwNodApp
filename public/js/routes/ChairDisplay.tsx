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
import { formatLocaleDate } from '../utils/formatters';
import styles from './ChairDisplay.module.css';

interface ImageEntry {
    name: string;
    /** The file's mtime — the URL's cache-bust token (`/DolImgs` is served immutable). */
    v?: number;
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
 * The latest-visit Summary string is HTML built by the server
 * (`visit-queries.ts#buildVisitSummary`: literal `<br>` separators and
 * `<font color=blue>...</font>` for the "Next" line). Parts of it interpolate
 * user-typed visit fields (Others, NextVisit, etc.), so we can't render it
 * verbatim with dangerouslySetInnerHTML.
 *
 * Strategy: HTML-escape everything, then re-enable only the small allowlist of
 * tags the builder itself produces. Anything a user typed remains escaped.
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

/** How long to wait between server probes while the server is still down (grows to the last). */
const RELOAD_PROBE_DELAYS_MS = [15_000, 30_000, 60_000];

/**
 * Is the app itself answering? A reload while the server is still down behind
 * Caddy / the tunnel lands on the proxy's error page, which has no script to try
 * again, and the kiosk stays there (audit FE-F11-15d). `/health/basic` is
 * public, so any answer from the app — even with an expired session — is a yes.
 */
async function appIsReachable(): Promise<boolean> {
    try {
        // eslint-disable-next-line no-restricted-syntax -- liveness probe of the public /health/basic, not an API read: no envelope, no CSRF, must not redirect on 401
        const res = await fetch('/health/basic', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        return res.ok;
    } catch {
        return false;
    }
}

/** The idle clock fills half the shorter side, and follows a resize or rotation (FE-F11-15c). */
const idleClockSize = (): number => Math.min(window.innerHeight * 0.5, window.innerWidth * 0.5);

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
    const [clockSize, setClockSize] = useState(idleClockSize);

    useEffect(() => {
        const onResize = () => setClockSize(idleClockSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

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
                // (a dead server leaves it CONNECTING and retrying): an expired
                // staff session, or a proxy's 502 while the server restarts.
                // EventSource never retries after either, so reload — but only
                // once the app answers: the web gate then shows /login.html for an
                // expired session, and a restarted server simply reconnects. While
                // it does not answer, probe again with a growing delay and stay on
                // this page. Latched, so a 5xx storm can't become a reload loop.
                if (es.readyState === EventSource.CLOSED && reloadTimerRef.current === null) {
                    let attempt = 0;
                    const tryReload = async () => {
                        if (cancelled) return;
                        if (await appIsReachable()) {
                            if (!cancelled) window.location.reload();
                            return;
                        }
                        const delay = RELOAD_PROBE_DELAYS_MS[Math.min(attempt, RELOAD_PROBE_DELAYS_MS.length - 1)];
                        attempt++;
                        if (!cancelled) reloadTimerRef.current = window.setTimeout(() => void tryReload(), delay);
                    };
                    reloadTimerRef.current = window.setTimeout(() => void tryReload(), CLOSED_STREAM_RELOAD_DELAY_MS);
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
    // A LOCAL day for a date-only string: `new Date('YYYY-MM-DD')` is UTC and
    // read a day early on a kiosk west of UTC (FE-F11-15a).
    const formattedVisitDate = visitDate
        ? formatLocaleDate(visitDate, { year: 'numeric', month: 'short', day: 'numeric' })
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
                                    src={`/DolImgs/${img.name}${img.v ? `?v=${img.v}` : ''}`}
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
                        <AnalogClock size={clockSize} />
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
