import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import GridComponent from './GridComponent.jsx'
import XraysComponent from './XraysComponent.jsx'
import VisitsComponent from './VisitsComponent.jsx'
import CompareComponent from './CompareComponent.jsx'
import AppointmentForm from './AppointmentForm.jsx'
import EditAppointmentForm from './EditAppointmentForm.jsx'
import WorkComponent from './WorkComponent.jsx'
import EditPatientComponent from './EditPatientComponent.jsx'
import PatientAppointments from './PatientAppointments.jsx'

const ContentRenderer = ({ patientId, page = 'grid', params = {} }) => {
    const navigate = useNavigate();
    const wildcardParams = useParams();

    // Extract appointmentId from wildcard route (for edit-appointment/:appointmentId)
    const appointmentId = wildcardParams['*'];
    const renderContent = () => {
        switch (page) {
            case 'grid':
            case 'photos':
                return (
                    <GridComponent
                        patientId={patientId}
                        tpCode={params.tp || '0'}
                    />
                );

            case 'xrays':
                return (
                    <XraysComponent
                        patientId={patientId}
                    />
                );
            
            case 'visits':
                return (
                    <VisitsComponent
                        patientId={patientId}
                    />
                );
            
            case 'works':
                return (
                    <WorkComponent
                        patientId={patientId}
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
                            // Navigate back to appointments page
                            navigate(`/patient/${patientId}/appointments`);
                        }}
                        onSuccess={(result) => {
                            console.log('Appointment created successfully:', result);
                            // Navigate back to appointments page after success
                            navigate(`/patient/${patientId}/appointments`);
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
                            // Navigate back to appointments page
                            navigate(`/patient/${patientId}/appointments`);
                        }}
                        onSuccess={(result) => {
                            console.log('Appointment updated successfully:', result);
                            // Navigate back to appointments page after success
                            navigate(`/patient/${patientId}/appointments`);
                        }}
                    />
                );

            case 'edit-patient':
                return (
                    <EditPatientComponent
                        patientId={patientId}
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