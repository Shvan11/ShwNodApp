import { useState } from 'react';
import type { PortalPatient } from './PortalApp';
import PhotosTab from './tabs/PhotosTab';
import VisitsTab from './tabs/VisitsTab';
import AppointmentTab from './tabs/AppointmentTab';
import PaymentsTab from './tabs/PaymentsTab';
import styles from './portal.module.css';
import PortalIcon, { type PortalIconName } from './PortalIcon';

interface Props {
  patient: PortalPatient;
  onLogout: () => void;
}

type TabKey = 'appointment' | 'photos' | 'visits' | 'payments';

interface TabDef {
  key: TabKey;
  label: string;
  icon: PortalIconName;
}

const TABS: TabDef[] = [
  { key: 'appointment', label: 'Next Visit', icon: 'calendar-day' },
  { key: 'photos', label: 'Photos', icon: 'images' },
  { key: 'visits', label: 'Visits', icon: 'notes-medical' },
  { key: 'payments', label: 'Payments', icon: 'receipt' },
];

const PortalDashboard = ({ patient, onLogout }: Props) => {
  const [tab, setTab] = useState<TabKey>('appointment');
  const displayName = patient.patientName || `Patient #${patient.personId}`;

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerTitle}>
            <PortalIcon name="tooth" />
            <div>
              <div className={styles.headerHello}>Welcome</div>
              <div className={styles.headerName}>{displayName}</div>
            </div>
          </div>
          <button type="button" className={styles.logoutButton} onClick={onLogout}>
            <PortalIcon name="sign-out" />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      <main className={styles.content}>
        {tab === 'appointment' && <AppointmentTab />}
        {tab === 'photos' && <PhotosTab />}
        {tab === 'visits' && <VisitsTab />}
        {tab === 'payments' && <PaymentsTab />}
      </main>

      <nav className={styles.tabBar} aria-label="Portal sections">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              className={active ? `${styles.tabButton} ${styles.tabActive}` : styles.tabButton}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
            >
              <PortalIcon name={t.icon} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default PortalDashboard;
