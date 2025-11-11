import React from 'react';
import '../../css/pages/dashboard.css';

const DashboardApp = () => {
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
      link: '/template-management',
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

  const quickActions = [
    {
      title: 'Connect WhatsApp',
      icon: 'fab fa-whatsapp',
      link: '/auth'
    },
    {
      title: 'View Patients',
      icon: 'fas fa-th',
      link: '/patient-management'
    },
    {
      title: 'Add New Patient',
      icon: 'fas fa-user-plus',
      link: '/patient/new/add'
    }
  ];

  return (
    <div id="app">
      <header className="header">
        <div className="container">
          <div className="logo">
            <img src="../images/logo.png" alt="Shwan Orthodontics" />
            <h1>Shwan Orthodontics</h1>
          </div>
          <div className="user-info">
            <span>Welcome to the System</span>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="container">
          <div className="dashboard-grid">
            {dashboardCards.map((card, index) => (
              <a
                key={index}
                href={card.link}
                className="dashboard-card-link"
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

            {/* Quick Actions Card */}
            <div className="dashboard-card quick-actions">
              <div className="card-icon">
                <i className="fas fa-bolt"></i>
              </div>
              <h3>Quick Actions</h3>
              <div className="quick-actions-list">
                {quickActions.map((action, index) => (
                  <a key={index} href={action.link} className="quick-action">
                    <i className={action.icon}></i>
                    <span>{action.title}</span>
                  </a>
                ))}
              </div>
            </div>
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
};

export default DashboardApp;
