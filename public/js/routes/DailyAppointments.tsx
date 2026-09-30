import DailyAppointments from '../components/react/appointments/DailyAppointments';

/**
 * Daily Appointments Route
 *
 * Standalone appointment management for clinic-wide daily operations.
 * Features:
 * - Date-based appointment viewing
 * - Real-time SSE updates
 * - Check-in workflow (Scheduled → Present → Seated → Dismissed)
 * - Mobile-responsive design
 * - Context menus and notifications
 * - Statistics dashboard
 */
export default function DailyAppointmentsRoute() {
  return <DailyAppointments />;
}
