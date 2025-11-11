import React from 'react';
import ReactDOM from 'react-dom/client';
import UniversalHeader from '../components/react/UniversalHeader.jsx';
import PatientApp from '../apps/PatientApp.jsx';
import '../../css/main.css';
import '../../css/pages/grid.css';
import '../../css/pages/work-payments.css';
import '../../css/pages/xrays.css';
import '../../css/pages/visits-summary.css';
import '../../css/pages/canvas.css';
import 'photoswipe/dist/photoswipe.css';
import '../../css/components/universal-header.css';
import '../../css/components/sidebar-navigation.css';
import '../../css/pages/patient-shell.css';
import '../../css/pages/edit-patient.css';
import '../../css/components/timepoints-selector.css';
import '../../css/components/appointment-form.css';
import '../../css/components/calendar-picker-modal.css';
import '../../css/components/simplified-calendar-picker.css';

// Initialize the patient portal with React Router
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing React Patient Portal with Router...');

    // Name this window so it reuses the same tab
    window.name = 'clinic_patient';

    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }

    // Mount Patient App with React Router
    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
        const root = ReactDOM.createRoot(reactRoot);
        root.render(React.createElement(PatientApp));
        console.log('✅ Patient portal with React Router initialized');
    }
});
