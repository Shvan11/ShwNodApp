import DailyAppointments from '../components/react/appointments/DailyAppointments';

// Note: Component styles are now in CSS Modules (co-located with components)
import '../../css/components/appointment-calendar.css';

/**
 * Daily Appointments Route
 *
 * Standalone appointment management for clinic-wide daily operations.
 * Features:
 * - Date-based appointment viewing
 * - Real-time WebSocket updates
 * - Check-in workflow (Scheduled → Present → Seated → Dismissed)
 * - Mobile-responsive design
 * - Context menus and notifications
 * - Statistics dashboard
 */
export default function DailyAppointmentsRoute() {
  return <DailyAppointments />;
}
