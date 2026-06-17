import React, { useState, useEffect, useCallback, useRef, ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { UserResponse } from '@/types/api.types';
import { authMeQuery } from '@/query/queries';

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

// Types
interface SettingsTabComponentProps {
    onChangesUpdate: (hasChanges: boolean) => void;
}

interface TabConfig {
    id: string;
    label: string;
    icon: string;
    component: ComponentType<SettingsTabComponentProps> | null;
    description: string;
    disabled?: boolean;
    adminOnly?: boolean;
}

interface TabDataState {
    [key: string]: {
        hasChanges: boolean;
    };
}

const SettingsComponent: React.FC = () => {
    const { tab } = useParams<{ tab?: string }>();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<string>(tab || 'general');

    // Current user role — drives admin-only tab filtering.
    const { data: meData } = useQuery(authMeQuery());
    const me = meData as UserResponse | undefined;
    const userRole = me?.success && me.user ? me.user.role : null;

    // Ref to hold current activeTab - allows stable callback that reads current value.
    // Synced in an effect (not during render); the callbacks that read it run after
    // the commit, so they always see the latest tab.
    const activeTabRef = useRef(activeTab);
    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);
    const [tabData, setTabData] = useState<TabDataState>({
        general: { hasChanges: false },
        database: { hasChanges: false },
        protocolHandlers: { hasChanges: false },
        alignerDoctors: { hasChanges: false },
        email: { hasChanges: false },
        employees: { hasChanges: false },
        exchangeRates: { hasChanges: false },
        lookups: { hasChanges: false },
        calendarTimes: { hasChanges: false },
        supabaseStatus: { hasChanges: false },
        dolphinStatus: { hasChanges: false },
        integrations: { hasChanges: false },
        databaseBackup: { hasChanges: false },
        messaging: { hasChanges: false },
        system: { hasChanges: false },
        security: { hasChanges: false },
        users: { hasChanges: false }
    });

    // Tab configuration
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
            description: 'Manage staff members and email notification settings'
        },
        {
            id: 'exchangeRates',
            label: 'Exchange Rates',
            icon: 'fas fa-exchange-alt',
            component: ExchangeRatesSettings,
            description: "Edit today's USD→IQD rate and view historical rates"
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
            id: 'integrations',
            label: 'Integrations',
            icon: 'fas fa-plug',
            component: IntegrationsSettings,
            description: 'Manage Telegram (and later WhatsApp/Google) authentication',
            adminOnly: true
        },
        {
            id: 'messaging',
            label: 'Messaging',
            icon: 'fas fa-comments',
            component: null,
            description: 'WhatsApp and SMS configuration',
            disabled: true
        },
        {
            id: 'system',
            label: 'System',
            icon: 'fas fa-server',
            component: null,
            description: 'System preferences and maintenance',
            disabled: true
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

    // Sync activeTab with URL parameter. Done during render (adjust-state-during-render),
    // keyed on the URL `tab` value, rather than in an effect so the React Compiler can
    // optimize it.
    const [syncedTab, setSyncedTab] = useState<string | undefined>(tab);
    if (tab !== syncedTab) {
        setSyncedTab(tab);
        if (tab && tabs.find(t => t.id === tab && !t.disabled)) {
            setActiveTab(tab);
        }
    }

    const handleTabChange = (tabId: string): void => {
        const selectedTab = tabs.find(t => t.id === tabId);
        if (selectedTab && !selectedTab.disabled) {
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

    // Filter tabs based on user role
    const filteredTabs = tabs.filter(tabItem => {
        // Hide admin-only tabs from non-admins
        if (tabItem.adminOnly && userRole !== 'admin') {
            return false;
        }
        return true;
    });

    // Get the active tab component
    const activeTabConfig = filteredTabs.find(t => t.id === activeTab);
    const ActiveTabComponent = activeTabConfig?.component;

    return (
        <div className={styles.container}>
            <SettingsTabNavigation
                tabs={filteredTabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                tabData={tabData}
            />

            <div className={styles.content}>
                {ActiveTabComponent ? (
                    <ActiveTabComponent
                        onChangesUpdate={handleTabChangesUpdate}
                    />
                ) : (
                    <div className={styles.placeholder}>
                        <div className={styles.placeholderIcon}>
                            <i className={activeTabConfig?.icon || 'fas fa-cog'}></i>
                        </div>
                        <h3>{activeTabConfig?.label || 'Settings'}</h3>
                        <p>This section is coming soon.</p>
                        <p className={styles.placeholderDescription}>
                            {activeTabConfig?.description || 'Configure your system settings'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsComponent;
