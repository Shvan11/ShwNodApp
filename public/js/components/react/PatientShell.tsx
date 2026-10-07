import { useEffect } from 'react';
import { useParams, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Navigation from './Navigation';
import ContentRenderer from './ContentRenderer';
import storage from '../../core/storage';
import { patientInfoQuery, workDetailsQuery } from '../../query/queries';

/**
 * Fire-and-forget POST to the chair-display endpoint. Uses navigator.sendBeacon
 * (the textbook fire-and-forget primitive) so the call cannot block the JS
 * thread, never delays the staff workflow, and survives the page unloading.
 * Falls back to fetch with keepalive if sendBeacon is unavailable. Errors are
 * silently swallowed — chair-display is non-critical and must never disrupt
 * the main app.
 */
/**
 * Ordering tag for the beacons. Leaving patient A for B sends CLEAR(A) then
 * LOAD(B) as two independent beacons, and sendBeacon does not keep their order:
 * a CLEAR that landed second blanked the chair kiosk with B open (audit
 * FE-F4-10). The server drops a beacon older than one it already took from this
 * tab — `src` names the tab, `seq` only ever grows within it.
 */
const BEACON_SRC = Math.random().toString(36).slice(2, 12);
let beaconSeq = 0;

const notifyChairDisplay = (path: '/api/chair-display/patient-loaded' | '/api/chair-display/patient-cleared', payload: object): void => {
    try {
        beaconSeq += 1;
        const body = JSON.stringify({ ...payload, src: BEACON_SRC, seq: beaconSeq });
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(path, blob);
            return;
        }
        // Fallback: still non-blocking (no await), keepalive survives unload
        // eslint-disable-next-line no-restricted-syntax -- beacon fallback: fire-and-forget keepalive POST on unload, no response read
        void fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
            credentials: 'same-origin',
        }).catch(() => { /* swallow */ });
    } catch {
        /* swallow — chair display is non-critical */
    }
};

// CSS Module for PatientShell
import styles from './PatientShell.module.css';

// Patient portal CSS (loaded when any patient route is visited)
import '../../../css/layout/sidebar-navigation.css';
import '../../../css/components/work-card.css';

/** What ContentRenderer actually reads. This used to declare `view`, `filter`,
 *  `workId` and `phone` as well — four fields PatientShell computed on every
 *  render for no reader (ContentRenderer pulls workId/visitId from the query
 *  string itself). */
interface ContentParams {
    tpCode?: string;
}

const PatientShell = () => {
    // React Router hooks
    const allParams = useParams<{ personId?: string; page?: string; workId?: string; '*'?: string }>();
    const { personId, page, workId } = allParams;
    const [searchParams] = useSearchParams();
    const location = useLocation();

    // --- Scroll-position memory --------------------------------------------
    // Restore the window scroll for this exact patient sub-path (works/visits/
    // payments/photos…) so returning via the header's patient button lands
    // where you left off. These pages scroll the window (min-height layout, no
    // inner overflow container), so this is just scrollY get/set. Keyed by the
    // full path incl. query (the active timepoint slot).
    const scrollStorageKey = `scrollPos:${location.pathname}${location.search}`;

    // Save — throttled to one write per animation frame while scrolling.
    useEffect(() => {
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [scrollStorageKey]);

    // Restore on path change. Retry across a few frames so late-growing content
    // (photo grids whose height expands as images decode) still settles onto
    // the saved offset instead of clamping short. No saved value → top.
    useEffect(() => {
        const saved = Number(sessionStorage.getItem(scrollStorageKey)) || 0;
        let tries = 0;
        let raf = requestAnimationFrame(function restore() {
            window.scrollTo(0, saved);
            if (saved > 0 && ++tries < 8 && Math.abs(window.scrollY - saved) > 2) {
                raf = requestAnimationFrame(restore);
            }
        });
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, location.search]);

    // Extract tpCode from wildcard path (e.g., "tp1" from /photos/tp1)
    const wildcardPath = allParams['*'] || '';
    const tpCode = wildcardPath.match(/^tp(\d+)$/)?.[0] || null;

    // Detect if this is the diagnosis route (/patient/:personId/work/:workId/diagnosis).
    // `location.pathname` (useLocation, two lines up), NOT `window.location`: the
    // router writes to history BEFORE it commits the new location into context,
    // so under v7_startTransition a render can see the NEW window.location beside
    // the OLD `page`/`workId` params — effectivePage would flip to 'diagnosis'
    // while workId still belonged to the previous route.
    const isDiagnosisRoute = !!workId && location.pathname.endsWith('/diagnosis');
    const effectivePage = isDiagnosisRoute ? 'diagnosis' : page;

    // isNew derived from the route param (replaces the loader's `isNew` flag).
    const isNewPatient = personId === 'new' || isNaN(parseInt(personId || '', 10));

    // workId from route or query param (the loader prefetched its details key).
    const workIdFromQuery = searchParams.get('workId');
    const effectiveWorkId = workId || workIdFromQuery || null;

    // Read patient + work from React Query — patientShellLoader prefetched these
    // exact keys, so they resolve instantly from cache (no loading flash). Reads
    // now invalidate live: a patient/work mutation refreshes the header here.
    const { data: patient } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: !isNewPatient && !!personId,
    });
    const { data: work } = useQuery({
        ...workDetailsQuery(effectiveWorkId ?? ''),
        enabled: !!effectiveWorkId,
    });

    // Validated person_id (null if invalid or new patient)
    const validatedPersonId = (patient?.person_id as number | undefined) ?? null;

    // Notify the chair-side public display (if this PC is configured as a chair)
    // when a patient is opened/closed. Fire-and-forget via sendBeacon — never
    // blocks the main app, even when the server is unreachable.
    useEffect(() => {
        if (validatedPersonId === null) return;
        const chairId = storage.chairId();
        if (!chairId) return;

        notifyChairDisplay('/api/chair-display/patient-loaded', {
            chairId,
            personId: validatedPersonId,
        });

        return () => {
            notifyChairDisplay('/api/chair-display/patient-cleared', { chairId });
        };
    }, [validatedPersonId]);

    // Patient display name from loader data
    const patientName = isNewPatient
        ? 'New Patient'
        : (patient?.name || patient?.patient_name || `Patient ${personId}`) as string;

    // Work display name (from the work-details query above)
    const workTypeName = (work?.type_name as string | undefined) || '';

    const params: ContentParams = { tpCode: tpCode ?? undefined };

    return (
        <div id="patient-shell" className={styles.patientShellContainer}>
            {/* Navigation Sidebar - Always Visible */}
            <div className={styles.navigationSidebar}>
                <Navigation
                    personId={personId}
                    currentPage={effectivePage}
                />
            </div>

            {/* Main Content Area */}
            <div className={styles.mainContentArea}>
                {/* Enhanced Breadcrumb */}
                <div className={styles.breadcrumbContainer}>
                    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                        {/* Patient Link - Disabled for new patients */}
                        {isNewPatient ? (
                            <span className={`${styles.breadcrumbItem} ${styles.breadcrumbItemActive}`}>
                                <i className="fas fa-user" aria-hidden="true"></i>
                                {' '}
                                {patientName}
                            </span>
                        ) : (
                            <Link to={`/patient/${validatedPersonId || personId}/works`} className={`${styles.breadcrumbItem} ${styles.breadcrumbLink}`}>
                                <i className="fas fa-user" aria-hidden="true"></i>
                                {' '}
                                {patientName}
                            </Link>
                        )}

                        {/* Work Level (if workId is present) */}
                        {effectiveWorkId && workTypeName && (
                            <>
                                <span className={styles.breadcrumbSeparator}>/</span>
                                <Link to={`/patient/${validatedPersonId || personId}/works`} className={`${styles.breadcrumbItem} ${styles.breadcrumbLink}`}>
                                    <i className="fas fa-briefcase-medical" aria-hidden="true"></i> {workTypeName}
                                </Link>
                            </>
                        )}

                        {/* Current Page */}
                        {effectivePage && effectivePage !== 'photos' && effectivePage !== 'works' && (
                            <>
                                <span className={styles.breadcrumbSeparator}>/</span>
                                <span className={`${styles.breadcrumbItem} ${styles.breadcrumbItemActive}`}>
                                    <i className={`fas fa-${effectivePage === 'visits' ? 'calendar-check' : effectivePage === 'appointments' ? 'calendar-alt' : effectivePage === 'xrays' ? 'x-ray' : effectivePage === 'patient-info' ? 'id-card' : effectivePage === 'diagnosis' ? 'stethoscope' : 'file'}`} aria-hidden="true"></i>
                                    {' '}
                                    {effectivePage.charAt(0).toUpperCase() + effectivePage.slice(1).replace(/-/g, ' ')}
                                </span>
                            </>
                        )}
                    </nav>
                </div>

                {/* Page Content */}
                <div className={styles.pageContent}>
                    <ContentRenderer
                        personId={validatedPersonId}
                        page={effectivePage}
                        params={params}
                    />
                </div>
            </div>
        </div>
    );
};

export default PatientShell;
