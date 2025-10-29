// PatientApp.jsx - Patient Portal Router
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PatientShell from '../components/react/PatientShell.jsx';

/**
 * Patient Portal Application with React Router
 *
 * Routes:
 * - /patient/:patientId/works → Patient works/treatment records
 * - /patient/:patientId/grid → Patient photos grid
 * - /patient/:patientId/compare → Photo comparison view
 * - /patient/:patientId/xrays → X-rays view
 * - /patient/:patientId/visits → Visit summary
 * - /patient/:patientId/payments → Payment records
 * - /patient/:patientId/new-appointment → New appointment form
 * - /patient/:patientId/edit → Edit patient information
 */
const PatientApp = () => {
    return (
        <BrowserRouter>
            <Routes>
                {/* Patient routes with page parameter */}
                <Route path="/patient/:patientId/:page" element={<PatientShell />} />

                {/* Default patient route - redirect to works page */}
                <Route path="/patient/:patientId" element={<Navigate to="works" replace />} />

                {/* Redirect unknown routes to patient management */}
                <Route path="*" element={<Navigate to="/patient-management" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default PatientApp;
