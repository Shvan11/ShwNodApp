/**
 * Daily Appointments React Entry Point
 *
 * This file has been refactored from a 1093-line monolith to a clean React SPA.
 * The legacy version has been backed up to daily-appointments-legacy.jsx
 *
 * New component architecture:
 * - DailyAppointments.jsx (main app container)
 * - AppointmentsHeader.jsx (title + date picker + connection status)
 * - StatsCards.jsx (statistics with animated counts)
 * - MobileViewToggle.jsx (mobile view switcher)
 * - AppointmentCard.jsx (individual appointment card)
 * - AppointmentsList.jsx (grid of appointments)
 * - Notification.jsx (notifications with undo)
 * - ContextMenu.jsx (right-click menu)
 * - ConnectionStatus.jsx (WebSocket status indicator)
 *
 * Custom hooks:
 * - useAppointments.js (data fetching and state management)
 * - useWebSocketSync.js (real-time WebSocket updates)
 */
import { initializeDailyAppointments } from '../components/react/appointments/DailyAppointments.jsx';

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDailyAppointments);
} else {
    initializeDailyAppointments();
}
