import { useEffect, useState } from 'react';
import type { PortalNextAppointment } from '../portal.schemas';
import { portalNextAppointmentResponseSchema } from '../portal.schemas';
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
        // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and reads res.ok/error.
        const res = await fetch('/api/portal/appointments/next', { credentials: 'same-origin' });
        const parsed = portalNextAppointmentResponseSchema.safeParse(await res.json());
        if (cancelled) return;
        if (!res.ok || !parsed.success || !parsed.data.success) {
          setError((parsed.success ? parsed.data.error : undefined) || 'Unable to load your next appointment.');
          setAppt(null);
          return;
        }
        setAppt(parsed.data.appointment);
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

  const { date, time } = formatAppointmentDate(appt.app_date);

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
        {appt.app_detail && (
          <div className={styles.appointmentRow}>
            <i className="fas fa-clipboard-list" aria-hidden="true" /> {appt.app_detail}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentTab;
