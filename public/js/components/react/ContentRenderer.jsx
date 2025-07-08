import React from 'react'
import GridComponent from './GridComponent.jsx'
import PaymentsComponent from './PaymentsComponent.jsx'
import XraysComponent from './XraysComponent.jsx'
import VisitsComponent from './VisitsComponent.jsx'
import CompareComponent from './CompareComponent.jsx'
import AppointmentForm from './AppointmentForm.jsx'
import WorkComponent from './WorkComponent.jsx'

const ContentRenderer = ({ patientId, page = 'grid', params = {} }) => {
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
            
            case 'payments':
                return (
                    <PaymentsComponent
                        patientId={patientId}
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
            
            case 'new-appointment':
                return (
                    <AppointmentForm
                        patientId={patientId}
                        onClose={() => {
                            // Navigate back to grid page
                            const newUrl = `${window.location.pathname}?code=${patientId}&page=grid`;
                            window.history.pushState({}, '', newUrl);
                            window.dispatchEvent(new CustomEvent('urlChanged'));
                        }}
                        onSuccess={(result) => {
                            console.log('Appointment created successfully:', result);
                            // Could show success message here
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