import React from 'react'
import ReactDOM from 'react-dom/client'
import UniversalHeader from '../components/react/UniversalHeader.jsx'
import AddPatientForm from '../components/react/AddPatientForm.jsx'
import '../../css/main.css'
import '../../css/pages/add-patient.css'
import '../../css/components/universal-header.css'

const AddPatientPage = () => {
    return (
        <div className="add-patient-container">
            <main className="add-patient-main">
                <AddPatientForm />
            </main>
        </div>
    );
};

// Initialize the add patient page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing React Add Patient Page...');
    
    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }
    
    // Mount Add Patient Form
    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
        const root = ReactDOM.createRoot(reactRoot);
        root.render(React.createElement(AddPatientPage));
        console.log('✅ Add Patient page initialized');
    }
});

export default AddPatientPage;