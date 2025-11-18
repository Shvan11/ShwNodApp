/**
 * Visits page entry point
 * Handles visit management for a specific work
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import VisitsComponent from '../components/react/VisitsComponent.jsx';

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const workId = urlParams.get('workId');
const patientId = urlParams.get('patient');

if (!workId) {
    // Note: Toast may not be available yet at module load time
    // Use setTimeout to ensure toast is initialized
    setTimeout(() => {
        window.toast?.error('Work ID is required');
    }, 100);
    window.location.href = '/dashboard';
}

// Load work information for the header
async function loadWorkInfo() {
    try {
        const response = await fetch(`/api/getworkdetails?workId=${workId}`);
        if (!response.ok) throw new Error('Failed to fetch work details');
        const work = await response.json();

        // Update breadcrumb
        if (patientId) {
            document.getElementById('breadcrumb-patient').innerHTML =
                `<a href="/patient/${patientId}/works">Patient ${patientId}</a>`;
        }

        // Update work info card
        document.getElementById('work-patient').textContent = work.PatientName || 'N/A';
        document.getElementById('work-type').textContent = work.TypeName || 'N/A';
        document.getElementById('work-doctor').textContent = work.DoctorName ? (work.DoctorName === 'Admin' ? work.DoctorName : `Dr. ${work.DoctorName}`) : 'N/A';
        document.getElementById('work-status').textContent = work.Finished ? 'Completed' : 'Active';
        document.getElementById('workInfoCard').style.display = 'block';
    } catch (error) {
        console.error('Error loading work info:', error);
    }
}

// Initialize
loadWorkInfo();

// Render React component
const root = ReactDOM.createRoot(document.getElementById('visits-root'));
root.render(
    <React.StrictMode>
        <VisitsComponent
            workId={parseInt(workId)}
            patientId={patientId ? parseInt(patientId) : null}
        />
    </React.StrictMode>
);
