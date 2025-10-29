// SettingsApp.jsx - Settings Router
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SettingsComponent from '../components/react/SettingsComponent.jsx';

/**
 * Settings Application with React Router
 *
 * Routes:
 * - /settings → General settings (default)
 * - /settings/:tab → Specific settings tab (general, database, alignerDoctors, messaging, system, security)
 */
const SettingsApp = () => {
    return (
        <BrowserRouter>
            <Routes>
                {/* Settings with specific tab */}
                <Route path="/settings/:tab" element={<SettingsComponent />} />

                {/* Default settings route - redirect to general tab */}
                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />

                {/* Redirect unknown routes to general settings */}
                <Route path="*" element={<Navigate to="/settings/general" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default SettingsApp;
