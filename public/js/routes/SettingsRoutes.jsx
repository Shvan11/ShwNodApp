import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import SettingsComponent from '../components/react/SettingsComponent.jsx';

// Settings page styles
import '../../css/pages/settings.css';
import '../../css/pages/cost-presets-settings.css';
import '../../css/pages/user-management.css';

/**
 * Settings Routes
 *
 * Routes:
 * - /settings → General settings (default)
 * - /settings/:tab → Specific settings tab (general, database, alignerDoctors, messaging, system, security)
 */
export default function SettingsRoutes() {
  return (
    <Routes>
      {/* Settings with specific tab */}
      <Route path="/:tab" element={<SettingsComponent />} />

      {/* Default settings route - redirect to general tab */}
      <Route path="/" element={<Navigate to="/settings/general" replace />} />

      {/* Redirect unknown routes to general settings */}
      <Route path="*" element={<Navigate to="/settings/general" replace />} />
    </Routes>
  );
}
