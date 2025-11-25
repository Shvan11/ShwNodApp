/**
 * Daily Appointments React Entry Point
 *
 * This file has been refactored from a 1093-line monolith to a clean React SPA.
 * The legacy version has been backed up to daily-appointments-legacy.jsx
 *
 * Architecture:
 * - DailyAppointmentsApp.jsx (app wrapper in /apps)
 * - DailyAppointments.jsx (main component)
 * - 9 sub-components (Header, Stats, Cards, Notifications, etc.)
 * - 2 custom hooks (useAppointments, useWebSocketSync)
 *
 * Route: /appointments or /daily-appointments
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import UniversalHeader from '../components/react/UniversalHeader.jsx';
import DailyAppointmentsApp from '../apps/DailyAppointmentsApp.jsx';
import '../../css/pages/appointments.css';
import '../../css/layout/universal-header.css';

// Initialize the daily appointments application
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Initializing Daily Appointments App...');

    // Name this window so window.open() can reuse/focus it
    window.name = 'clinic_appointments';

    // Register this tab as singleton - only one appointments tab should exist

    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
        console.log('✅ Universal Header initialized');
    }

    // Mount Daily Appointments App
    const appRoot = document.getElementById('daily-appointments-root');
    if (appRoot) {
        const appReactRoot = ReactDOM.createRoot(appRoot);
        appReactRoot.render(React.createElement(DailyAppointmentsApp));
        console.log('✅ Daily Appointments App initialized');
    }
});
