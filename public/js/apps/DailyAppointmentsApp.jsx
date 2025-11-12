// DailyAppointmentsApp.jsx - Daily Appointments Application
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import DailyAppointments from '../components/react/appointments/DailyAppointments.jsx';

/**
 * Daily Appointments Application
 *
 * Standalone appointment management application for clinic-wide daily operations.
 * Features:
 * - Date-based appointment viewing
 * - Real-time WebSocket updates
 * - Check-in workflow (Scheduled → Present → Seated → Dismissed)
 * - Mobile-responsive design
 * - Context menus and notifications
 * - Statistics dashboard
 *
 * Route: /appointments or /daily-appointments
 */
const DailyAppointmentsApp = () => {
    return <DailyAppointments />;
};

// Single-SPA Lifecycle Exports
const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: DailyAppointmentsApp,
    errorBoundary(err, info, props) {
        console.error('[DailyAppointmentsApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Appointments Error</h2>
                <p>Failed to load appointments. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
export default DailyAppointmentsApp;
