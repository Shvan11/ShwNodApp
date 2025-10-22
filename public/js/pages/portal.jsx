// portal.jsx - Entry point for Portal Application
import React from 'react';
import ReactDOM from 'react-dom/client';
import PortalApp from '../apps/PortalApp.jsx';
import '../../css/main.css';
import '../../css/pages/alignerportal.css';

// Initialize the portal app
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing Portal App with React Router...');

    const portalRoot = document.getElementById('portal-root');
    if (portalRoot) {
        const root = ReactDOM.createRoot(portalRoot);
        root.render(<PortalApp />);
        console.log('✅ Portal App initialized with React Router');
    } else {
        console.error('❌ Portal root element not found');
    }
});
