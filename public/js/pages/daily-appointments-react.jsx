/**
 * Daily Appointments React Entry Point
 * Initializes the React-based daily appointments application
 */
import { initializeDailyAppointments } from '../components/react/appointments/DailyAppointments.jsx';

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDailyAppointments);
} else {
    initializeDailyAppointments();
}
