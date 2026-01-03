import AppointmentCalendar from '../components/react/AppointmentCalendar';

// Calendar view styles - appointment-calendar.css kept global due to :root variables and shared by many components
import '../../css/components/appointment-calendar.css';

/**
 * Appointment Calendar Route
 * Monthly/weekly calendar view for appointments
 */
export default function Calendar() {
  return <AppointmentCalendar />;
}
