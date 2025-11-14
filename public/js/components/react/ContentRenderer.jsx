import React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import GridComponent from './GridComponent.jsx'
import XraysComponent from './XraysComponent.jsx'
import VisitsComponent from './VisitsComponent.jsx'
import NewVisitComponent from './NewVisitComponent.jsx'
import CompareComponent from './CompareComponent.jsx'
import AppointmentForm from './AppointmentForm.jsx'
import EditAppointmentForm from './EditAppointmentForm.jsx'
import WorkComponent from './WorkComponent.jsx'
import NewWorkComponent from './NewWorkComponent.jsx'
import EditPatientComponent from './EditPatientComponent.jsx'
import ViewPatientInfo from './ViewPatientInfo.jsx'
import PatientAppointments from './PatientAppointments.jsx'
import AddPatientForm from './AddPatientForm.jsx'
import '../../../css/components/new-work-component.css'

const ContentRenderer = ({ patientId, page = 'photos', params = {} }) => {
    const navigate = useNavigate();
    const wildcardParams = useParams();
    const [searchParams] = useSearchParams();

    // Extract appointmentId from wildcard route (for edit-appointment/:appointmentId)
    const appointmentId = wildcardParams['*'];

    // Extract workId and visitId from query params for work-specific pages like visits
    const workId = searchParams.get('workId');
    const visitId = searchParams.get('visitId');

    // Get tpCode from params (passed from PatientShell)
    const tpCode = params.tpCode;

    const renderContent = () => {
        switch (page) {
            case 'photos':
                return (
                    <GridComponent
                        patientId={patientId}
                        tpCode={tpCode ? tpCode.replace('tp', '') : '0'}
                    />
                );

            case 'xrays':
                return (
                    <XraysComponent
                        patientId={patientId}
                    />
                );
            
            case 'visits':
                // Visits can be shown at work level (with workId) or patient level (all visits)
                return (
                    <VisitsComponent
                        workId={workId ? parseInt(workId) : null}
                        patientId={patientId ? parseInt(patientId) : null}
                    />
                );

            case 'new-visit':
                // New visit form - clean component directly related to parent work
                return (
                    <NewVisitComponent
                        workId={workId ? parseInt(workId) : null}
                        visitId={visitId ? parseInt(visitId) : null}
                        onSave={() => {
                            // Navigate back to visit history after save
                            navigate(`/patient/${patientId}/visits?workId=${workId}`);
                        }}
                        onCancel={() => {
                            // Navigate back to visit history on cancel
                            navigate(`/patient/${patientId}/visits?workId=${workId}`);
                        }}
                    />
                );

            case 'works':
                return (
                    <WorkComponent
                        patientId={patientId}
                    />
                );

            case 'new-work':
                // New work form - uses NewWorkComponent
                return (
                    <NewWorkComponent
                        patientId={patientId}
                        workId={workId ? parseInt(workId) : null}
                        onSave={(result) => {
                            console.log('Work saved successfully:', result);
                            // Navigate back to works page
                            navigate(`/patient/${patientId}/works`);
                        }}
                        onCancel={() => {
                            // Go back to works page
                            navigate(`/patient/${patientId}/works`);
                        }}
                    />
                );

            case 'compare':
                return (
                    <CompareComponent
                        patientId={patientId}
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
                        patientId={patientId}
                    />
                );

            case 'new-appointment':
                return (
                    <AppointmentForm
                        patientId={patientId}
                        onClose={() => {
                            // Go back to previous page
                            navigate(-1);
                        }}
                        onSuccess={(result) => {
                            console.log('Appointment created successfully:', result);
                            // Navigate to works page after success
                            navigate(`/patient/${patientId}/works`);
                        }}
                    />
                );

            case 'edit-appointment':
                // Handle edit-appointment/:appointmentId pattern
                return (
                    <EditAppointmentForm
                        patientId={patientId}
                        appointmentId={appointmentId}
                        onClose={() => {
                            // Go back to previous page
                            navigate(-1);
                        }}
                        onSuccess={(result) => {
                            console.log('Appointment updated successfully:', result);
                            // Go back to previous page after success
                            navigate(-1);
                        }}
                    />
                );

            case 'patient-info':
                return (
                    <ViewPatientInfo
                        patientId={patientId}
                    />
                );

            case 'edit-patient':
                return (
                    <EditPatientComponent
                        patientId={patientId}
                    />
                );

            case 'add':
                // Add new patient form (when patientId is "new")
                return (
                    <AddPatientForm
                        onSuccess={(newPatientId) => {
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