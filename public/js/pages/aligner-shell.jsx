import React from 'react';
import ReactDOM from 'react-dom/client';
import UniversalHeader from '../components/react/UniversalHeader.jsx';
import AlignerApp from '../apps/AlignerApp.jsx';
import '../../css/main.css';
import '../../css/pages/aligner.css';
import '../../css/components/universal-header.css';

// Initialize the aligner management app with React Router
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing Aligner App with React Router...');

    // Name this window so tabManager can reuse it
    window.name = 'clinic_aligner';

    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }

    // Mount Aligner App with React Router
    const alignerRoot = document.getElementById('aligner-component-root');
    if (alignerRoot) {
        const root = ReactDOM.createRoot(alignerRoot);
        root.render(React.createElement(AlignerApp));
        console.log('✅ Aligner App initialized with React Router');
    }
});
