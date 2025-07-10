import React from 'react'
import ReactDOM from 'react-dom/client'
import UniversalHeader from '../components/react/UniversalHeader.jsx'
import SendMessage from '../components/react/SendMessage.jsx'

// Initialize the send message React page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing React Send Message Page...');
    
    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }
    
    // Mount Send Message Component
    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
        const root = ReactDOM.createRoot(reactRoot);
        root.render(React.createElement(SendMessage));
        console.log('✅ Send Message component initialized');
    }
});