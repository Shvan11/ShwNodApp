import React from 'react'
import ReactDOM from 'react-dom/client'
import UniversalHeader from '../components/shared/UniversalHeader.jsx'
import App from '../components/react/App.jsx'
import '../../css/main.css'
import '../../css/pages/grid.css'
import '../../css/pages/payments.css'
import '../../css/pages/xrays.css'
import '../../css/pages/visits-summary.css'
import '../../css/pages/canvas.css'
import '../../photoswipe/dist/photoswipe.css'
import '../../css/components/universal-header.css'
import '../../css/components/sidebar-navigation.css'

// Initialize the patient shell page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing React Patient Shell...');
    
    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }
    
    // Mount React App
    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
        const root = ReactDOM.createRoot(reactRoot);
        root.render(React.createElement(App));
        console.log('✅ Patient shell initialized');
    }
});