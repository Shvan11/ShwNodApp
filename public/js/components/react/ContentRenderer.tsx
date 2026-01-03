import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import GridComponent from './GridComponent';
import XraysComponent from './XraysComponent';
import VisitsComponent from './VisitsComponent';
import NewVisitComponent from './NewVisitComponent';
import CompareComponent from './CompareComponent';
import AppointmentForm from './AppointmentForm';
import EditAppointmentForm from './EditAppointmentForm';
import WorkComponent from './WorkComponent';
import NewWorkComponent from './NewWorkComponent';
import EditPatientComponent from './EditPatientComponent';
import ViewPatientInfo from './ViewPatientInfo';
import PatientAppointments from './PatientAppointments';
import AddPatientForm from './AddPatientForm';
import Diagnosis from '../../pages/Diagnosis';
// new-work-component.css -> NewWorkComponent.module.css

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

const ContentRenderer = ({ personId, page = 'photos', params = {}, isNewPatient = false }: ContentRendererProps) => {
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
                // If just /work, redirect to /works
                if (personId) navigate(`/patient/${personId}/works`, { replace: true });
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
                        onSave={(result: unknown) => {
                            console.log('Work saved successfully:', result);
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
                        phone={params.phone}
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
                        onSuccess={(result: unknown) => {
                            console.log('Appointment created successfully:', result);
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
                        onSuccess={(result: unknown) => {
                            console.log('Appointment updated successfully:', result);
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
                            console.log('Patient created successfully with ID:', newPatientId);
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
                {renderContent()}
            </div>
        </div>
    );
};

export default ContentRenderer;
