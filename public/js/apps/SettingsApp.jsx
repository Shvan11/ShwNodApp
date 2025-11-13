// SettingsApp.jsx - Settings Router
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { Router } from 'react-router';
import { Routes, Route, Navigate } from 'react-router-dom';
import { sharedHistory } from '/single-spa/shared-history.js';
import SettingsComponent from '../components/react/SettingsComponent.jsx';

/**
 * Settings Application with React Router
 *
 * Routes:
 * - /settings → General settings (default)
 * - /settings/:tab → Specific settings tab (general, database, alignerDoctors, messaging, system, security)
 *
 * Note: Uses shared history instance for consistent navigation across all apps
 */
const SettingsApp = () => {
    return (
        <Router location={sharedHistory.location} navigator={sharedHistory}>
            <Routes>
                {/* Settings with specific tab */}
                <Route path="/settings/:tab" element={<SettingsComponent />} />

                {/* Default settings route - redirect to general tab */}
                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />

                {/* Redirect unknown routes to general settings */}
                <Route path="*" element={<Navigate to="/settings/general" replace />} />
            </Routes>
        </Router>
    );
};

// Single-SPA Lifecycle Exports

const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: SettingsApp,
    renderType: 'createRoot', // React 18 API
  domElementGetter: () => {
    let el = document.getElementById('settings-app-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'settings-app-container';
      document.getElementById('app-container')?.appendChild(el) || document.body.appendChild(el);
    }
    return el;
  },
    errorBoundary(err, info, props) {
        console.error('[SettingsApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Settings Error</h2>
                <p>Failed to load settings. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
