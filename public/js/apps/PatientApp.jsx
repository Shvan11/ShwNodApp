// PatientApp.jsx - Patient Portal Router
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PatientShell from '../components/react/PatientShell.jsx';

/**
 * Patient Portal Application with React Router
 *
 * Routes:
 * - /patient/:patientId/works → Patient works/treatment records
 * - /patient/:patientId/grid → Patient photos grid
 * - /patient/:patientId/compare → Photo comparison view
 * - /patient/:patientId/xrays → X-rays view
 * - /patient/:patientId/visits → Visit summary (with ?workId query param)
 * - /patient/:patientId/new-visit → New visit form (with ?workId query param)
 * - /patient/:patientId/payments → Payment records
 * - /patient/:patientId/new-appointment → New appointment form
 * - /patient/:patientId/edit-appointment/:appointmentId → Edit appointment
 * - /patient/:patientId/edit → Edit patient information
 */
const PatientApp = () => {
    return (
        <Routes>
            {/* Patient routes with page parameter - handles both simple and nested pages */}
            <Route path="/patient/:patientId/:page/*" element={<PatientShell />} />

            {/* Default patient route - redirect to works page */}
            <Route path="/patient/:patientId" element={<Navigate to="works" replace />} />

            {/* Redirect unknown routes to patient management */}
            <Route path="*" element={<Navigate to="/patient-management" replace />} />
        </Routes>
    );
};

// Single-SPA Lifecycle Exports
const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: PatientApp,
    errorBoundary(err, info, props) {
        console.error('[PatientApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Patient Portal Error</h2>
                <p>Failed to load patient portal. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
export default PatientApp;
