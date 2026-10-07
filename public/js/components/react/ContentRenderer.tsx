import { Suspense, type ComponentType } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RouteErrorBoundary } from '../error-boundaries/RouteErrorBoundary';
import { lazyWithPreload } from '../../router/lazyWithPreload';

/**
 * Each patient sub-page is its own lazy chunk.
 *
 * Before: ContentRenderer statically imported all ~18 patient screens, so the
 * PatientShell route chunk was ~465 KB (117 KB gz) and every patient visit
 * downloaded WorkComponent, Diagnosis, CompareComponent, both appointment
 * forms, etc. — even just to view one tab. Now only the rendered tab loads.
 *
 * `preloaders` is the single source of truth shared by the lazy components and
 * `preloadPatientPage()` below, so the loader can warm the exact chunk it's
 * about to render — collapsing the route-chunk → page-chunk waterfall the split
 * would otherwise introduce. One page string → one component; 'work' and
 * 'diagnosis' share the Diagnosis chunk.
 */
const preloaders = new Map<string, () => Promise<void>>();

function lazyPage<T extends ComponentType<any>>(
    pages: string[],
    factory: () => Promise<{ default: T }>
) {
    const Page = lazyWithPreload(factory);
    for (const p of pages) preloaders.set(p, Page.preload);
    return Page;
}

/**
 * Load a patient sub-page's chunk ahead of render. patientShellLoader awaits
 * this beside its data, so the page mounts already loaded and never shows the
 * content spinner below: showing it, even for one tick, costs React's 300 ms
 * fallback throttle (audit FE-F26-3; `lazyWithPreload` has the detail). Resolves
 * for an unknown or empty page (the chunk then loads on render via Suspense) and
 * never rejects — a chunk that cannot load still surfaces on the render path,
 * where the chunk self-heal lives, and a warm-up must not file a [client-error].
 */
export function preloadPatientPage(page: string | null | undefined): Promise<void> {
    const preload = page ? preloaders.get(page) : undefined;
    return preload ? preload() : Promise.resolve();
}

const GridComponent = lazyPage(['photos'], () => import('./GridComponent'));
const XraysComponent = lazyPage(['xrays'], () => import('./XraysComponent'));
const ThreeShapeScansView = lazyPage(['scans'], () => import('./ThreeShapeScansView'));
const FileExplorer = lazyPage(['files'], () => import('./files/FileExplorer'));
const WorkingFilesView = lazyPage(['working-files'], () => import('./files/WorkingFilesView'));
const VisitsComponent = lazyPage(['visits'], () => import('./VisitsComponent'));
const NewVisitComponent = lazyPage(['new-visit'], () => import('./NewVisitComponent'));
const CompareComponent = lazyPage(['compare'], () => import('./CompareComponent'));
const PatientSlideshow = lazyPage(['slideshow'], () => import('./slideshow/PatientSlideshow'));
const AppointmentForm = lazyPage(['new-appointment'], () => import('./AppointmentForm'));
const EditAppointmentForm = lazyPage(['edit-appointment'], () => import('./EditAppointmentForm'));
const WorkComponent = lazyPage(['works'], () => import('./WorkComponent'));
const NewWorkComponent = lazyPage(['new-work'], () => import('./NewWorkComponent'));
const EditPatientComponent = lazyPage(['edit-patient'], () => import('./EditPatientComponent'));
const ViewPatientInfo = lazyPage(['patient-info'], () => import('./ViewPatientInfo'));
const PatientAppointments = lazyPage(['appointments'], () => import('./PatientAppointments'));
const AddPatientForm = lazyPage(['add'], () => import('./AddPatientForm'));
const Diagnosis = lazyPage(['work', 'diagnosis'], () => import('../../pages/Diagnosis'));
// react-easy-crop rides this chunk, so it stays out of the bundle until edit.
const PhotoEditor = lazyPage(['photo-editor'], () => import('./photo-editor/PhotoEditor'));

/**
 * Content-local Suspense fallback. MANDATORY boundary: ContentRenderer's pages
 * are now lazy, and the nearest Suspense above it is RootLayout's route-level
 * one — without this, a tab's chunk load would bubble there and blank the whole
 * app shell (header + sidebar). Scoped here, only the content body shows it.
 */
function PageFallback() {
    return (
        <div className="loading-fallback">
            <div className="loading-fallback-content">
                <div className="loading-spinner"></div>
            </div>
        </div>
    );
}

/** The only param this component reads. `phone` (declared, never read) and the
 *  `[key: string]` catch-all went with the `isNewPatient` prop below: PatientShell
 *  was building five fields of which one had a reader. */
interface ContentRendererParams {
    tpCode?: string;
}

interface ContentRendererProps {
    personId?: number | null;  // Validated PersonID from loader (null if invalid/new)
    page?: string;
    params?: ContentRendererParams;
}

// `isNewPatient` used to be a prop, destructured to `_isNewPatient` and never
// read — the "new patient" branch is reached by `page === 'add'`, like every
// other page, not by a flag.
const ContentRenderer = ({ personId, page = 'photos', params = {} }: ContentRendererProps) => {
    const navigate = useNavigate();
    const location = useLocation();

    // Back one page — or, when this is the first page of the tab (a pasted link,
    // a bookmark), to `fallback`: `navigate(-1)` there left the app (FE-F10-9).
    const goBackOr = (fallback: string) => {
        if (location.key === 'default') navigate(fallback, { replace: true });
        else navigate(-1);
    };
    const wildcardParams = useParams<{ '*': string }>();
    const [searchParams] = useSearchParams();

    // Extract from wildcard route
    const wildcardPath = wildcardParams['*'] || '';

    // For edit-appointment/:appointmentId pattern
    const appointmentId = wildcardPath;

    // Extract workId and visitId from query params for work-specific pages like visits
    const workId = searchParams.get('workId');
    const visitId = searchParams.get('visitId');
    // `from=visits`: the visit form was opened from Visit History, so it returns there.
    const visitFormReturnsTo = searchParams.get('from') === 'visits' && workId
        ? `/patient/${personId}/visits?workId=${workId}`
        : `/patient/${personId}/works`;

    // Get tpCode from params (passed from PatientShell)
    const tpCode = params.tpCode;

    const renderContent = () => {
        switch (page) {
            case 'photos':
                return (
                    <GridComponent
                        personId={personId}
                        tpCode={tpCode ? tpCode.replace('tp', '') : '0'}
                    />
                );

            case 'xrays':
                return (
                    <XraysComponent
                        personId={personId}
                    />
                );

            case 'scans':
                return (
                    <ThreeShapeScansView
                        personId={personId}
                    />
                );

            case 'files':
                return (
                    <FileExplorer
                        personId={personId}
                        subPath={wildcardPath}
                    />
                );

            case 'working-files':
                return <WorkingFilesView personId={personId} />;

            case 'visits':
                // Visit history is per work (`?workId=`). Without one there is no list
                // to show — VisitsComponent says so and points back to Works.
                return (
                    <VisitsComponent
                        workId={workId ? parseInt(workId, 10) : null}
                        personId={personId}
                    />
                );

            case 'new-visit':
                // New visit form - clean component directly related to parent work.
                // Keyed by work + visit: each visit is its own form with its own
                // post-mount read and seed, never the previous visit's state.
                return (
                    <NewVisitComponent
                        key={`${workId ?? ''}:${visitId ?? ''}`}
                        workId={workId ? parseInt(workId, 10) : null}
                        visitId={visitId ? parseInt(visitId, 10) : null}
                        personId={personId}
                        onSave={() => {
                            if (personId) navigate(visitFormReturnsTo);
                        }}
                        onCancel={() => {
                            if (personId) navigate(visitFormReturnsTo);
                        }}
                    />
                );

            case 'work':
                // Only the bare `/work` reaches here — `/work/:workId/diagnosis`
                // always matches its own route, which PatientShell renders as
                // page 'diagnosis' (below). Redirect to /works. Must use <Navigate> (not the
                // navigate() function) because this runs during render — calling
                // navigate() here updates RouterProvider mid-render ("Cannot update a
                // component while rendering a different component"). <Navigate> defers
                // the redirect to an effect.
                if (personId) return <Navigate to={`/patient/${personId}/works`} replace />;
                return null;

            case 'diagnosis':
                // Direct diagnosis route (from /patient/:patientId/work/:workId/diagnosis)
                // Diagnosis component uses useParams() to get patientId and workId
                return <Diagnosis />;

            case 'works':
                return (
                    <WorkComponent
                        personId={personId}
                    />
                );

            case 'new-work':
                // New work form - uses NewWorkComponent
                return (
                    <NewWorkComponent
                        personId={personId}
                        workId={workId ? parseInt(workId, 10) : null}
                        onSave={() => {
                            // Navigate back to works page
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                        onCancel={() => {
                            // Go back to works page
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                    />
                );

            // Keyed by patient: a step between two patients' pages (an in-app history
            // step) remounts instead of carrying the previous patient's canvas, open
            // sessions or in-flight gallery reads over (FE-F13-12, FE-F15-8).
            case 'compare':
                return (
                    <CompareComponent
                        key={personId}
                        personId={personId}
                    />
                );

            case 'slideshow':
                return (
                    <PatientSlideshow
                        key={personId}
                        personId={personId}
                    />
                );

            case 'appointments':
                return (
                    <PatientAppointments
                        personId={personId}
                    />
                );

            case 'new-appointment':
                return (
                    <AppointmentForm
                        personId={personId}
                        onClose={() => goBackOr(`/patient/${personId}/appointments`)}
                        onSuccess={() => {
                            // Navigate to works page after success
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                    />
                );

            case 'edit-appointment':
                // edit-appointment/:appointmentId. Both callbacks go back to wherever
                // Edit was opened from (the calendar or the patient's list); the form
                // calls exactly one of them.
                return (
                    <EditAppointmentForm
                        personId={personId}
                        appointmentId={appointmentId}
                        onClose={() => goBackOr(`/patient/${personId}/appointments`)}
                        onSuccess={() => goBackOr(`/patient/${personId}/appointments`)}
                    />
                );

            case 'patient-info':
                return (
                    <ViewPatientInfo
                        personId={personId}
                    />
                );

            case 'edit-patient':
                return (
                    <EditPatientComponent
                        personId={personId}
                    />
                );

            case 'add':
                // Add new patient form (when isNewPatient is true)
                return (
                    <AddPatientForm
                        onSuccess={(newPatientId: string | number) => {
                            // Navigate to the new patient's works page
                            if (newPatientId) {
                                navigate(`/patient/${newPatientId}/works`);
                            } else {
                                // Fallback to patient management if no ID returned
                                navigate('/patient-management');
                            }
                        }}
                        onCancel={() => {
                            // Go back to patient management
                            navigate('/patient-management');
                        }}
                    />
                );

            case 'photo-editor':
                return (
                    <PhotoEditor
                        // Remount per timepoint so slot state never leaks across
                        // timepoints (HYDRATE only overwrites slots present in the
                        // new timepoint's data, leaving others stale otherwise).
                        key={tpCode || 'none'}
                        personId={personId}
                        tpCode={tpCode ? tpCode.replace('tp', '') : ''}
                    />
                );

            // NOTE: 'details', 'history' and 'messages' used to be three cases
            // here rendering a hardcoded "…view coming soon…" card. None of them
            // appears in Navigation's item list, so they were reachable only by
            // typing /patient/7/details — three placeholder screens shipped and
            // URL-addressable. They now fall through to the unknown-page card
            // below, which is the honest answer.
            default:
                return (
                    <div className="unknown-page">
                        <div className="error-message">
                            <i className="fas fa-question-circle" aria-hidden="true"></i>
                            <h3>Page Not Found</h3>
                            <p>The page "{page}" is not available.</p>
                        </div>
                    </div>
                );
        }
    };

    // The boundary sits where the Suspense does — around the page body only — so one
    // tab's failed chunk or crash leaves the patient sidebar and header in place
    // (FE-F4-17 / FE-F12-8c: a failed Photos chunk used to blank the whole shell).
    // The boundary clears itself when the pathname changes, i.e. on another tab.
    return (
        <div className="content-area">
            <div className="content-body">
                <RouteErrorBoundary>
                    <Suspense fallback={<PageFallback />}>
                        {renderContent()}
                    </Suspense>
                </RouteErrorBoundary>
            </div>
        </div>
    );
};

export default ContentRenderer;
