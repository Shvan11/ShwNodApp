import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

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
 * would otherwise introduce. One page string → one factory; 'work' and
 * 'diagnosis' share the Diagnosis chunk.
 */
const preloaders = new Map<string, () => Promise<unknown>>();

function lazyPage<T extends ComponentType<any>>(
    pages: string[],
    factory: () => Promise<{ default: T }>
) {
    for (const p of pages) preloaders.set(p, factory);
    return lazy(factory);
}

/**
 * Warm a patient sub-page's chunk ahead of render. Called from
 * patientShellLoader at route-match so the page chunk downloads in parallel with
 * the loader's data fetch and the PatientShell chunk (mirrors routes.config's
 * `.preload()`). Fire-and-forget; unknown/empty pages no-op (the chunk simply
 * loads on render via Suspense). Swallow rejections — a genuinely unloadable
 * chunk still surfaces on the render path, where App.tsx's preloadError handler
 * self-heals; this speculative warm-up must not log spurious [client-error].
 */
export function preloadPatientPage(page: string | null | undefined): void {
    if (!page) return;
    const factory = preloaders.get(page);
    if (factory) void factory().catch(() => {});
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

interface ContentRendererParams {
    tpCode?: string;
    phone?: string;
    [key: string]: string | undefined;
}

interface ContentRendererProps {
    personId?: number | null;  // Validated PersonID from loader (null if invalid/new)
    page?: string;
    params?: ContentRendererParams;
    isNewPatient?: boolean;
}

const ContentRenderer = ({ personId, page = 'photos', params = {}, isNewPatient: _isNewPatient = false }: ContentRendererProps) => {
    const navigate = useNavigate();
    const wildcardParams = useParams<{ '*': string }>();
    const [searchParams] = useSearchParams();

    // Extract from wildcard route
    const wildcardPath = wildcardParams['*'] || '';

    // For edit-appointment/:appointmentId pattern
    const appointmentId = wildcardPath;

    // For work/:workId/diagnosis pattern
    const workPathMatch = wildcardPath.match(/^(\d+)\/diagnosis$/);
    const workIdFromPath = workPathMatch ? workPathMatch[1] : null;

    // Extract workId and visitId from query params for work-specific pages like visits
    const workId = workIdFromPath || searchParams.get('workId');
    const visitId = searchParams.get('visitId');

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
                // Visits can be shown at work level (with workId) or patient level (all visits)
                return (
                    <VisitsComponent
                        workId={workId ? parseInt(workId) : null}
                        personId={personId}
                    />
                );

            case 'new-visit':
                // New visit form - clean component directly related to parent work
                return (
                    <NewVisitComponent
                        workId={workId ? parseInt(workId) : null}
                        visitId={visitId ? parseInt(visitId) : null}
                        onSave={() => {
                            // Navigate back to works page after save
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                        onCancel={() => {
                            // Navigate back to works page on cancel
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                    />
                );

            case 'work':
                // Handle work/:workId/diagnosis nested route
                if (workIdFromPath && wildcardPath.endsWith('/diagnosis')) {
                    // Diagnosis component uses useParams() to get patientId and workId
                    return <Diagnosis />;
                }
                // If just /work, redirect to /works. Must use <Navigate> (not the
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
                        workId={workId ? parseInt(workId) : null}
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

            case 'compare':
                return (
                    <CompareComponent
                        personId={personId}
                    />
                );

            case 'slideshow':
                return (
                    <PatientSlideshow
                        personId={personId}
                    />
                );

            case 'details':
                return (
                    <div className="patient-details">
                        <div className="coming-soon">
                            <i className="fas fa-user"></i>
                            <h3>Patient Details</h3>
                            <p>Patient details view coming soon...</p>
                        </div>
                    </div>
                );

            case 'history':
                return (
                    <div className="patient-history">
                        <div className="coming-soon">
                            <i className="fas fa-history"></i>
                            <h3>Patient History</h3>
                            <p>Patient history view coming soon...</p>
                        </div>
                    </div>
                );

            case 'messages':
                return (
                    <div className="patient-messages">
                        <div className="coming-soon">
                            <i className="fas fa-comments"></i>
                            <h3>Messages</h3>
                            <p>Patient messaging view coming soon...</p>
                        </div>
                    </div>
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
                        onClose={() => {
                            // Go back to previous page
                            navigate(-1);
                        }}
                        onSuccess={() => {
                            // Navigate to works page after success
                            if (personId) navigate(`/patient/${personId}/works`);
                        }}
                    />
                );

            case 'edit-appointment':
                // Handle edit-appointment/:appointmentId pattern
                return (
                    <EditAppointmentForm
                        personId={personId}
                        appointmentId={appointmentId}
                        onClose={() => {
                            // Go back to previous page
                            navigate(-1);
                        }}
                        onSuccess={() => {
                            // Go back to previous page after success
                            navigate(-1);
                        }}
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
                        tpName={searchParams.get('tpName') || ''}
                        tpDate={searchParams.get('date') || ''}
                    />
                );

            default:
                return (
                    <div className="unknown-page">
                        <div className="error-message">
                            <i className="fas fa-question-circle"></i>
                            <h3>Page Not Found</h3>
                            <p>The page "{page}" is not available.</p>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="content-area">
            <div className="content-body">
                <Suspense fallback={<PageFallback />}>
                    {renderContent()}
                </Suspense>
            </div>
        </div>
    );
};

export default ContentRenderer;
