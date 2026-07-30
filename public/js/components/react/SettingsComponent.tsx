import React, { useState, useEffect, useCallback, useMemo, useRef, ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authMeQuery } from '@/query/queries';
import { roleCaps, type UserRole } from '@shared/auth/roles';

// CSS Modules
import styles from './SettingsContainer.module.css';

import SettingsTabNavigation from './SettingsTabNavigation';
import GeneralSettings from './GeneralSettings';
import DatabaseSettings from './DatabaseSettings';
import AlignerDoctorsSettings from './AlignerDoctorsSettings';
import EmailSettings from './EmailSettings';
import EmployeeSettings from './EmployeeSettings';
import UserManagement from './UserManagement';
import AdminUserManagement from './AdminUserManagement';
import ExchangeRatesSettings from './ExchangeRatesSettings';
import LookupsSettings from './LookupsSettings';
import ProtocolHandlersSettings from './ProtocolHandlersSettings';
import CalendarTimesSettings from './CalendarTimesSettings';
import SupabaseStatusSettings from './SupabaseStatusSettings';
import DolphinStatusSettings from './DolphinStatusSettings';
import IntegrationsSettings from './IntegrationsSettings';
import DatabaseBackupSettings from './DatabaseBackupSettings';
import TvDisplaySettings from './TvDisplaySettings';

// Types
interface SettingsTabComponentProps {
    onChangesUpdate: (hasChanges: boolean) => void;
}

interface TabConfig {
    id: string;
    label: string;
    icon: string;
    component: ComponentType<SettingsTabComponentProps>;
    description: string;
    adminOnly?: boolean;
    /** Hide from roles without finance-write capability (clinical). */
    financeOnly?: boolean;
}

interface TabDataState {
    [key: string]: {
        hasChanges: boolean;
    };
}

// Tab configuration defined statically outside the component to avoid recreation on render.
const tabs: TabConfig[] = [
    {
        id: 'general',
        label: 'General',
        icon: 'fas fa-cog',
        component: GeneralSettings,
        description: 'System options and preferences'
    },
    {
        id: 'database',
        label: 'Database',
        icon: 'fas fa-database',
        component: DatabaseSettings,
        description: 'Database connection and configuration'
    },
    {
        id: 'databaseBackup',
        label: 'Database Backup',
        icon: 'fas fa-download',
        component: DatabaseBackupSettings,
        description: 'Download a full backup of this clinic\'s database'
    },
    {
        id: 'protocolHandlers',
        label: 'Protocol Handlers',
        icon: 'fas fa-link',
        component: ProtocolHandlersSettings,
        description: 'Windows protocol handler configuration (Dolphin, CS Imaging)'
    },
    {
        id: 'alignerDoctors',
        label: 'Aligner Doctors',
        icon: 'fas fa-user-md',
        component: AlignerDoctorsSettings,
        description: 'Manage aligner doctors and portal access'
    },
    {
        id: 'email',
        label: 'Email',
        icon: 'fas fa-envelope',
        component: EmailSettings,
        description: 'Email notifications and SMTP configuration'
    },
    {
        id: 'employees',
        label: 'Employees',
        icon: 'fas fa-users',
        component: EmployeeSettings,
        description: 'Manage staff members and email notification settings',
        adminOnly: true
    },
    {
        id: 'exchangeRates',
        label: 'Exchange Rates',
        icon: 'fas fa-exchange-alt',
        component: ExchangeRatesSettings,
        description: "Edit today's USD→IQD rate and view historical rates",
        financeOnly: true
    },
    {
        id: 'lookups',
        label: 'Lookups',
        icon: 'fas fa-list',
        component: LookupsSettings,
        description: 'Manage dropdown and reference data'
    },
    {
        id: 'calendarTimes',
        label: 'Calendar Times',
        icon: 'fas fa-clock',
        component: CalendarTimesSettings,
        description: 'Configure calendar time slot visibility'
    },
    {
        id: 'supabaseStatus',
        label: 'Supabase Status',
        icon: 'fas fa-cloud',
        component: SupabaseStatusSettings,
        description: 'Live status of Supabase portal & failover sync'
    },
    {
        id: 'dolphinStatus',
        label: 'Dolphin Status',
        icon: 'fas fa-database',
        component: DolphinStatusSettings,
        description: 'Live status of the legacy Dolphin Imaging SQL Server sink'
    },
    {
        id: 'tvDisplay',
        label: 'TV Display',
        icon: 'fas fa-tv',
        component: TvDisplaySettings,
        description: 'Waiting-room screen: schedule, playback options and media',
        // Deliberately available to every staff role — reception runs the
        // waiting-room screen day to day. Access is enforced server-side in
        // routes/api/tv-display.routes.ts (authorize); the two must move together.
    },
    {
        id: 'integrations',
        label: 'Integrations',
        icon: 'fas fa-plug',
        component: IntegrationsSettings,
        description: 'Manage Telegram (and later WhatsApp/Google) authentication',
        adminOnly: true
    },
    {
        id: 'security',
        label: 'Security',
        icon: 'fas fa-shield-alt',
        component: UserManagement,
        description: 'Password management and account security'
    },
    {
        id: 'users',
        label: 'Users',
        icon: 'fas fa-users',
        component: AdminUserManagement,
        description: 'User management (admin only)',
        adminOnly: true // Only show to admins
    }
];

const SettingsComponent: React.FC = () => {
    const { tab } = useParams<{ tab?: string }>();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<string>(tab || 'general');

    // Current user role — drives admin-only tab filtering. Straight off the
    // contract (`auth.me.response`), where `role` is nullable: `null` means
    // "not loaded / unknown yet" and the redirect effect below waits on it.
    const { data: me } = useQuery(authMeQuery());
    const userRole = (me?.success && me.user ? me.user.role : null) ?? null;

    // Ref to hold current activeTab - allows stable callback that reads current value.
    // Synced in an effect (not during render); the callbacks that read it run after
    // the commit, so they always see the latest tab.
    const activeTabRef = useRef(activeTab);
    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);
    // Per-tab unsaved-changes flags, keyed by tab id. Starts empty: a tab only ever
    // appears here once it has reported a state, and `handleTabChangesUpdate` below
    // creates the entry on demand ("absent" and "false" both mean "no changes").
    const [tabData, setTabData] = useState<TabDataState>({});

    // Filter tabs based on user role dynamically.
    const filteredTabs = useMemo(() => {
        const caps = roleCaps((userRole ?? undefined) as UserRole | undefined);
        return tabs.filter(tabItem => {
            // Hide admin-only tabs from non-admins
            if (tabItem.adminOnly && userRole !== 'admin') {
                return false;
            }
            // Hide finance-write tabs from clinical (view-only money access)
            if (tabItem.financeOnly && !caps.writeFinance) {
                return false;
            }
            return true;
        });
    }, [userRole]);

    // Sync activeTab with URL parameter. Done during render (adjust-state-during-render),
    // keyed on the URL `tab` value, rather than in an effect so the React Compiler can
    // optimize it.
    const [syncedTab, setSyncedTab] = useState<string | undefined>(tab);
    if (tab !== syncedTab) {
        setSyncedTab(tab);
        if (tab && filteredTabs.some(t => t.id === tab)) {
            setActiveTab(tab);
        }
    }

    // Redirect to the fallback tab if the active one is unknown or unauthorized.
    useEffect(() => {
        if (userRole === null) return; // Wait until user info is loaded

        if (!filteredTabs.some(t => t.id === activeTab)) {
            navigate(`/settings/${filteredTabs[0]?.id ?? 'general'}`, { replace: true });
        }
    }, [userRole, activeTab, filteredTabs, navigate]);

    const handleTabChange = (tabId: string): void => {
        if (filteredTabs.some(t => t.id === tabId)) {
            navigate(`/settings/${tabId}`);
        }
    };

    // Stable callback - reads activeTab from ref, so it never changes reference
    const handleTabChangesUpdate = useCallback((hasChanges: boolean): void => {
        const tabId = activeTabRef.current;
        setTabData(prev => {
            // Only update if the value actually changed to avoid unnecessary re-renders
            if (prev[tabId]?.hasChanges === hasChanges) {
                return prev;
            }
            return {
                ...prev,
                [tabId]: {
                    ...prev[tabId],
                    hasChanges
                }
            };
        });
    }, []); // Empty deps = stable reference forever

    // Every tab has a component, so this is undefined only for an unknown or
    // unauthorized tab id — for the single render before the effect above
    // redirects. Render nothing rather than flashing an empty shell.
    const ActiveTabComponent = filteredTabs.find(t => t.id === activeTab)?.component;

    return (
        <div className={styles.container}>
            <SettingsTabNavigation
                tabs={filteredTabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                tabData={tabData}
            />

            <div className={styles.content}>
                {ActiveTabComponent && (
                    <ActiveTabComponent
                        onChangesUpdate={handleTabChangesUpdate}
                    />
                )}
            </div>
        </div>
    );
};

export default SettingsComponent;
