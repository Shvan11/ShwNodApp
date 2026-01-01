import DailyAppointments from '../components/react/appointments/DailyAppointments';

// Daily appointments styles
import '../../css/pages/appointments.css';
import '../../css/components/appointment-calendar.css';
import '../../css/components/appointment-form.css';
import '../../css/components/simplified-calendar-picker.css';

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
