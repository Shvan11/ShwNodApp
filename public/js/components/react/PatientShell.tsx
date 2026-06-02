import { useEffect } from 'react';
import { useParams, useSearchParams, Link, useLoaderData } from 'react-router-dom';
import Navigation from './Navigation';
import ContentRenderer from './ContentRenderer';
import storage from '../../core/storage';
import type { PatientShellLoaderResult } from '../../router/loaders';

/**
 * Fire-and-forget POST to the chair-display endpoint. Uses navigator.sendBeacon
 * (the textbook fire-and-forget primitive) so the call cannot block the JS
 * thread, never delays the staff workflow, and survives the page unloading.
 * Falls back to fetch with keepalive if sendBeacon is unavailable. Errors are
 * silently swallowed — chair-display is non-critical and must never disrupt
 * the main app.
 */
const notifyChairDisplay = (path: '/api/chair-display/patient-loaded' | '/api/chair-display/patient-cleared', payload: object): void => {
    try {
        const body = JSON.stringify(payload);
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(path, blob);
            return;
        }
        // Fallback: still non-blocking (no await), keepalive survives unload
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
// patient-info.css -> ViewPatientInfo.module.css
// add-patient.css -> AddPatientForm.module.css
// edit-patient.css -> EditPatientComponent.module.css
// grid.css -> GridComponent.module.css
// work-management.css -> WorkComponent.module.css
// work-payments.css -> merged into WorkComponent.module.css
// xrays.css -> XraysComponent.module.css
// canvas.css -> CanvasControlButtons.module.css
// visits-summary.css and visits-spacing.css deleted - were dead code
import '../../../css/components/work-card.css';
// new-work-component.css -> NewWorkComponent.module.css
// invoice-form.css -> PaymentModal.module.css
// CSS Modules: visits-component.css, new-visit-component.css, patient-appointments.css migrated

interface ContentParams {
    tpCode?: string;
    view?: string;
    filter?: string;
    workId?: string;
    phone?: string;
    [key: string]: string | undefined;
}

const PatientShell = () => {
    // Get pre-loaded data from route loader (validated before render)
    const loaderData = useLoaderData() as PatientShellLoaderResult;

    // React Router hooks
    const allParams = useParams<{ personId?: string; page?: string; workId?: string; '*'?: string }>();
    const { personId, page, workId } = allParams;
    const [searchParams] = useSearchParams();

    // Extract tpCode from wildcard path (e.g., "tp1" from /photos/tp1)
    const wildcardPath = allParams['*'] || '';
    const tpCode = wildcardPath.match(/^tp(\d+)$/)?.[0] || null;

    // Detect if this is the diagnosis route (/patient/:personId/work/:workId/diagnosis)
    const isDiagnosisRoute = !!workId && window.location.pathname.endsWith('/diagnosis');
    const effectivePage = isDiagnosisRoute ? 'diagnosis' : page;

    // Use loader data - already validated and fetched
    const patient = loaderData?.patient;
    const work = loaderData?.work;
    const isNewPatient = loaderData?.isNew ?? (personId === 'new');

    // Validated person_id from loader data (null if invalid or new patient)
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

    // Work display name from loader data
    const workTypeName = work?.TypeName || '';

    // Fetch work data when workId (from route or query param) changes
    const workIdFromQuery = searchParams.get('workId');
    const effectiveWorkId = workId || workIdFromQuery || loaderData?.workId || null;

    // Extract additional params from URL (convert null to undefined)
    const params: ContentParams = {
        tpCode: tpCode ?? undefined,
        view: searchParams.get('view') ?? undefined,
        filter: searchParams.get('filter') ?? undefined,
        workId: effectiveWorkId ?? undefined,
        phone: patient?.Phone ?? undefined,
    };

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
                    <nav className={styles.breadcrumb}>
                        {/* Home Link - Use Link for SPA navigation */}
                        <Link to="/patient-management" className={`${styles.breadcrumbItem} ${styles.breadcrumbLink}`}>
                            <i className="fas fa-home"></i> Home
                        </Link>

                        <span className={styles.breadcrumbSeparator}>/</span>

                        {/* Patient Link - Disabled for new patients */}
                        {isNewPatient ? (
                            <span className={`${styles.breadcrumbItem} ${styles.breadcrumbItemActive}`}>
                                <i className="fas fa-user"></i>
                                {' '}
                                {patientName}
                            </span>
                        ) : (
                            <Link to={`/patient/${validatedPersonId || personId}/works`} className={`${styles.breadcrumbItem} ${styles.breadcrumbLink}`}>
                                <i className="fas fa-user"></i>
                                {' '}
                                {patientName}
                            </Link>
                        )}

                        {/* Work Level (if workId is present) */}
                        {effectiveWorkId && workTypeName && (
                            <>
                                <span className={styles.breadcrumbSeparator}>/</span>
                                <Link to={`/patient/${validatedPersonId || personId}/works`} className={`${styles.breadcrumbItem} ${styles.breadcrumbLink}`}>
                                    <i className="fas fa-briefcase-medical"></i> {workTypeName}
                                </Link>
                            </>
                        )}

                        {/* Current Page */}
                        {effectivePage && effectivePage !== 'photos' && effectivePage !== 'works' && (
                            <>
                                <span className={styles.breadcrumbSeparator}>/</span>
                                <span className={`${styles.breadcrumbItem} ${styles.breadcrumbItemActive}`}>
                                    <i className={`fas fa-${effectivePage === 'visits' ? 'calendar-check' : effectivePage === 'appointments' ? 'calendar-alt' : effectivePage === 'xrays' ? 'x-ray' : effectivePage === 'patient-info' ? 'id-card' : effectivePage === 'diagnosis' ? 'stethoscope' : 'file'}`}></i>
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
                        isNewPatient={isNewPatient}
                    />
                </div>
            </div>
        </div>
    );
};

export default PatientShell;
