import React from 'react'
import ReactDOM from 'react-dom/client'
import GridComponent from '../components/react/GridComponent.jsx'
import '../../css/pages/grid.css'
import 'photoswipe/dist/photoswipe.css'

// Initialize the grid page
document.addEventListener('DOMContentLoaded', async function() {
    // Extract patient ID and timepoint from URL
    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('code');
    const timepoint = urlParams.get('timepoint');
    
    if (!patientId) {
        console.error('No patient ID provided');
        return;
    }
    
    // Setup navigation if available
    if (window.setupNavigation) {
        try {
            await window.setupNavigation(patientId);
            console.log('✅ Navigation setup completed for patient:', patientId);
        } catch (error) {
            console.warn('Navigation setup failed:', error);
        }
    }
    
    // Mount Grid Component
    const gridRoot = document.getElementById('grid-root');
    if (gridRoot) {
        const root = ReactDOM.createRoot(gridRoot);
        root.render(React.createElement(GridComponent, {
            patientId: patientId,
            timepoint: timepoint
        }));
        console.log('✅ Grid page initialized for patient:', patientId);
    }
});