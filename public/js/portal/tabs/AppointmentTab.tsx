import { useEffect, useState } from 'react';
import type {
  PortalNextAppointment,
  PortalNextAppointmentResponse,
} from '@/types/api.types';
import styles from '../portal.module.css';

function formatAppointmentDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: iso, time: '' };
  const date = d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return { date, time };
}

const AppointmentTab = () => {
  const [appt, setAppt] = useState<PortalNextAppointment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/appointments/next', { credentials: 'same-origin' });
        const data = (await res.json()) as PortalNextAppointmentResponse;
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setError(data.error || 'Unable to load your next appointment.');
          setAppt(null);
          return;
        }
        setAppt(data.appointment);
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
          <i className={`fas fa-calendar-check ${styles.emptyIcon}`} aria-hidden="true" />
          <p>No upcoming appointments scheduled.</p>
          <p className={styles.emptyHint}>Contact the clinic to book your next visit.</p>
        </div>
      </div>
    );
  }

  const { date, time } = formatAppointmentDate(appt.AppDate);

  return (
    <div className={styles.tabPanel}>
      <div className={styles.appointmentCard}>
        <div className={styles.appointmentLabel}>Your next appointment</div>
        <div className={styles.appointmentDate}>{date}</div>
        {time && <div className={styles.appointmentTime}>at {time}</div>}
        {appt.DrName && (
          <div className={styles.appointmentRow}>
            <i className="fas fa-user-md" aria-hidden="true" /> Dr. {appt.DrName}
          </div>
        )}
        {appt.AppDetail && (
          <div className={styles.appointmentRow}>
            <i className="fas fa-clipboard-list" aria-hidden="true" /> {appt.AppDetail}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentTab;
