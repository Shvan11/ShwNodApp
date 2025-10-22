// Portal App - Separate React Router Application
// Clean routing for external doctor portal
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PortalDashboard from '../pages/portal/PortalDashboard.jsx';
import PatientDetail from '../pages/portal/PatientDetail.jsx';

/**
 * Portal Application with React Router
 *
 * Routes:
 * - /portal - Dashboard with all cases
 * - /portal/patient/:workId - Individual patient case details
 *
 * This is a completely separate SPA from the main application
 */
const PortalApp = () => {
    return (
        <BrowserRouter>
            <Routes>
                {/* Dashboard - List of all cases */}
                <Route path="/portal" element={<PortalDashboard />} />

                {/* Patient Detail - Individual case with sets, batches, notes */}
                <Route path="/portal/patient/:workId" element={<PatientDetail />} />

                {/* Redirect any unknown routes to dashboard */}
                <Route path="*" element={<Navigate to="/portal" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default PortalApp;
