import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MouseEvent } from 'react';

// Dashboard styles - CSS Module
import styles from './Dashboard.module.css';

// Presentation-stable card definitions (icon + route). The human-readable
// strings live in the `dashboard` catalog, keyed by `key`. `as const` keeps each
// `key` a literal so the t(`dashboard:cards.${card.key}.title`) template-literal
// keys stay fully compile-checked against the English catalog.
const DASHBOARD_CARDS = [
  { key: 'calendar', icon: 'fas fa-calendar-alt', link: '/calendar' },
  { key: 'appointments', icon: 'fas fa-clock', link: '/appointments' },
  { key: 'searchPatients', icon: 'fas fa-search', link: '/patient-management' },
  { key: 'whatsapp', icon: 'fab fa-whatsapp', link: '/send' },
  { key: 'aligners', icon: 'fas fa-tooth', link: '/aligner' },
  { key: 'labTracking', icon: 'fas fa-flask', link: '/lab-tracking' },
  { key: 'settings', icon: 'fas fa-cog', link: '/settings' },
  { key: 'videos', icon: 'fas fa-video', link: '/videos' },
  { key: 'expenses', icon: 'fas fa-money-bill-wave', link: '/expenses' },
  { key: 'templates', icon: 'fas fa-file-alt', link: '/templates' },
  { key: 'stand', icon: 'fas fa-store', link: '/stand' },
  { key: 'statistics', icon: 'fas fa-chart-bar', link: '/statistics' },
  { key: 'addPatient', icon: 'fas fa-user-plus', link: '/patient/new/add' },
] as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  const handleCardClick = (e: MouseEvent<HTMLAnchorElement>, link: string) => {
    e.preventDefault();

    // Special handling for Patient Management - restore last search
    if (link === '/patient-management') {
      const lastSearch = sessionStorage.getItem('lastPatientSearch');
      if (lastSearch) {
        navigate(`/patient-management?${lastSearch}`);
      } else {
        navigate(link);
      }
    }
    // Special handling for Appointments - restore last date or default to today
    else if (link === '/appointments') {
      const lastDate = sessionStorage.getItem('lastAppointmentDate');
      if (lastDate) {
        navigate(`/appointments?date=${lastDate}`);
      } else {
        // Default to today for first visit
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        navigate(`/appointments?date=${year}-${month}-${day}`);
      }
    } else {
      navigate(link);
    }
  };

  return (
    <div id="app">
      <main className={styles.mainContent}>
        <div className={styles.container}>
          <div className={styles.dashboardGrid}>
            {DASHBOARD_CARDS.map((card) => (
              <a
                key={card.key}
                href={card.link}
                className={styles.cardLink}
                onClick={(e) => handleCardClick(e, card.link)}
              >
                <div className={styles.dashboardCard}>
                  <div className={styles.cardIcon}>
                    <i className={card.icon}></i>
                  </div>
                  <h3>{t(`cards.${card.key}.title`)}</h3>
                  <p>{t(`cards.${card.key}.description`)}</p>
                  <div className={styles.cardFooter}>
                    <span>{t(`cards.${card.key}.linkText`)}</span>
                    <i className="fas fa-arrow-right"></i>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
  );
}
