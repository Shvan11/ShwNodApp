import { useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';

// Dashboard styles - CSS Module
import styles from './Dashboard.module.css';

interface DashboardCard {
  title: string;
  description: string;
  icon: string;
  link: string;
  linkText: string;
}

export default function Dashboard() {
  const navigate = useNavigate();

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

  const dashboardCards: DashboardCard[] = [
    {
      title: 'Calendar',
      description: 'View and manage monthly appointments',
      icon: 'fas fa-calendar-alt',
      link: '/calendar',
      linkText: 'Open Calendar'
    },
    {
      title: "Today's Appointments",
      description: "View today's scheduled appointments",
      icon: 'fas fa-clock',
      link: '/appointments',
      linkText: 'View Appointments'
    },
    {
      title: 'Search Patients',
      description: 'Quick search and patient management',
      icon: 'fas fa-search',
      link: '/patient-management',
      linkText: 'Search Patients'
    },
    {
      title: 'WhatsApp Messages',
      description: 'Send appointment reminders and follow-ups',
      icon: 'fab fa-whatsapp',
      link: '/send',
      linkText: 'Send Messages'
    },
    {
      title: 'Aligner Management',
      description: 'Manage aligner sets and delivery batches',
      icon: 'fas fa-tooth',
      link: '/aligner',
      linkText: 'Manage Aligners'
    },
    {
      title: 'Settings',
      description: 'System settings and preferences',
      icon: 'fas fa-cog',
      link: '/settings',
      linkText: 'Open Settings'
    },
    {
      title: 'Expense Management',
      description: 'Track and manage clinic expenses',
      icon: 'fas fa-money-bill-wave',
      link: '/expenses',
      linkText: 'Manage Expenses'
    },
    {
      title: 'Document Templates',
      description: 'Manage receipts, invoices, and prescription templates',
      icon: 'fas fa-file-alt',
      link: '/templates',
      linkText: 'Manage Templates'
    },
    {
      title: 'Financial Statistics',
      description: 'View clinic reports and financial analytics',
      icon: 'fas fa-chart-bar',
      link: '/statistics',
      linkText: 'View Statistics'
    },
    {
      title: 'Add New Patient',
      description: 'Register a new patient in the system',
      icon: 'fas fa-user-plus',
      link: '/patient/new/add',
      linkText: 'Add Patient'
    }
  ];

  return (
    <div id="app">
      <main className={styles.mainContent}>
        <div className={styles.container}>
          <div className={styles.dashboardGrid}>
            {dashboardCards.map((card, index) => (
              <a
                key={index}
                href={card.link}
                className={styles.cardLink}
                onClick={(e) => handleCardClick(e, card.link)}
              >
                <div className={styles.dashboardCard}>
                  <div className={styles.cardIcon}>
                    <i className={card.icon}></i>
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                  <div className={styles.cardFooter}>
                    <span>{card.linkText}</span>
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
          <p>&copy; 2024 Shwan Orthodontics - All Rights Reserved</p>
        </div>
      </footer>
    </div>
  );
}
