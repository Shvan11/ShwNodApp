// DailyAppointmentsApp.jsx - Daily Appointments Application
import React from 'react';
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

export default DailyAppointmentsApp;
