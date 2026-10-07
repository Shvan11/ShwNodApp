import { useEffect, useState } from 'react';
import type { PortalNextAppointment } from '../portal.schemas';
import { portalNextAppointmentResponseSchema } from '../portal.schemas';
import { portalGet } from '../portalApi';
import { formatLocaleDate, formatLocaleTime } from '../../utils/formatters';
import { isClinicDoctorName } from '@shared/clinic-doctor';
import styles from '../portal.module.css';
import PortalIcon from '../PortalIcon';

function formatAppointmentDate(iso: string): { date: string; time: string } {
  // English, like the rest of the portal's text — never the phone's own locale (FE-F3-3).
  const date = formatLocaleDate(iso, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (!date) return { date: iso, time: '' };
  return { date, time: formatLocaleTime(iso, { hour: '2-digit', minute: '2-digit' }) };
}

const AppointmentTab = () => {
  const [appt, setAppt] = useState<PortalNextAppointment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await portalGet('/api/portal/appointments/next', portalNextAppointmentResponseSchema);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error || 'Unable to load your next appointment.');
          setAppt(null);
          return;
        }
        setAppt(result.data.appointment);
      } catch {
        if (!cancelled) setError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (appt === undefined && !error) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Loading your next appointment…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.errorBox}>{error}</div>
      </div>
    );
  }

  if (!appt) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.emptyState}>
          <PortalIcon name="calendar-check" className={styles.emptyIcon} />
          <p>No upcoming appointments scheduled.</p>
          <p className={styles.emptyHint}>Contact the clinic to book your next visit.</p>
        </div>
      </div>
    );
  }

  const { date, time } = formatAppointmentDate(appt.app_date);
  // The 'Clinic' pseudo-doctor is a bucket, not a person: no doctor line rather than
  // "Dr. Clinic" (FE-F23-6, as the Works card does since FE-F7-12).
  const doctor = appt.DrName && !isClinicDoctorName(appt.DrName) ? appt.DrName : null;

  return (
    <div className={styles.tabPanel}>
      <div className={styles.appointmentCard}>
        <div className={styles.appointmentLabel}>Your next appointment</div>
        <div className={styles.appointmentDate}>{date}</div>
        {time && <div className={styles.appointmentTime}>at {time}</div>}
        {doctor && (
          <div className={styles.appointmentRow}>
            <PortalIcon name="doctor" /> Dr. {doctor}
          </div>
        )}
        {appt.app_detail && (
          <div className={styles.appointmentRow}>
            <PortalIcon name="clipboard-list" /> {appt.app_detail}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentTab;
