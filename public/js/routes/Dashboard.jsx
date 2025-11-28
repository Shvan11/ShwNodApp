import React from 'react';
import { useNavigate } from 'react-router-dom';

// Dashboard styles
import '../../css/pages/dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();

  const handleCardClick = (e, link) => {
    e.preventDefault();

    // Special handling for Patient Management - restore last search
    if (link === '/patient-management') {
      const lastSearch = sessionStorage.getItem('lastPatientSearch');
      if (lastSearch) {
        navigate(`/patient-management?${lastSearch}`);
      } else {
        navigate(link);
      }
    } else {
      navigate(link);
    }
  };

  const dashboardCards = [
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
      linkText: 'Manage Templates',
      borderClass: 'border-left-purple',
      gradientClass: 'gradient-purple'
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
      <main className="main-content">
        <div className="container">
          <div className="dashboard-grid">
            {dashboardCards.map((card, index) => (
              <a
                key={index}
                href={card.link}
                className="dashboard-card-link"
                onClick={(e) => handleCardClick(e, card.link)}
              >
                <div className={`dashboard-card ${card.borderClass || ''}`}>
                  <div className={`card-icon ${card.gradientClass || ''}`}>
                    <i className={card.icon}></i>
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                  <div className="card-link">
                    <span>{card.linkText}</span>
                    <i className="fas fa-arrow-right"></i>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <p>&copy; 2024 Shwan Orthodontics - All Rights Reserved</p>
        </div>
      </footer>
    </div>
  );
}
