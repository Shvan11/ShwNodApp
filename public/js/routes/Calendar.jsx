import React from 'react';
import AppointmentCalendar from '../components/react/AppointmentCalendar.jsx';

// Calendar view styles
import '../../css/components/appointment-calendar.css';
import '../../css/components/monthly-calendar-view.css';
import '../../css/components/appointment-form.css';
import '../../css/components/calendar-picker-modal.css';

/**
 * Appointment Calendar Route
 * Monthly/weekly calendar view for appointments
 */
export default function Calendar() {
  return <AppointmentCalendar />;
}
