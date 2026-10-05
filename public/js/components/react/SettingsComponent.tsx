import React, { useState, useEffect, useCallback, useMemo, ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authMeQuery, syncFeaturesQuery } from '@/query/queries';
import { roleCaps, type RoleCapabilities, type UserRole } from '@shared/auth/roles';
import { useUnsavedRouteGuard } from '../../hooks/useUnsavedRouteGuard';

// CSS Modules
import styles from './SettingsContainer.module.css';

import SettingsTabNavigation, { settingsPanelId, settingsTabId } from './SettingsTabNavigation';
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
    /**
     * The capability a role needs to see the tab — the same line the tab's endpoints
     * draw on the server. Absent = every staff role. Database, Database Backup and
     * Email were offered to everyone and opened on "Insufficient permissions"; Lookups
     * and Calendar Times on a clinical 403 (audit FE-F21-3).
     */
    requires?: keyof RoleCapabilities;
    /**
     * The CDC sink the tab reports on. The tab shows only on an install that has that sink
     * (`GET /api/sync/features`) — for every role (audit FE-F22-7; owner, 2026-10-05).
     */
    feature?: 'supabase' | 'dolphin';
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
        description: 'Database connection and configuration',
        requires: 'manageSettings'
    },
    {
        id: 'databaseBackup',
        label: 'Database Backup',
        icon: 'fas fa-download',
        component: DatabaseBackupSettings,
        description: 'Download a full backup of this clinic\'s database',
        requires: 'manageSettings'
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
        description: 'Email notifications and SMTP configuration',
        requires: 'manageSettings'
    },
    {
        id: 'employees',
        label: 'Employees',
        icon: 'fas fa-users',
        component: EmployeeSettings,
        description: 'Manage staff members and email notification settings',
        requires: 'manageSettings'
    },
    {
        id: 'exchangeRates',
        label: 'Exchange Rates',
        icon: 'fas fa-exchange-alt',
        component: ExchangeRatesSettings,
        description: "Edit today's USD→IQD rate and view historical rates",
        requires: 'writeFinance'
    },
    {
        id: 'lookups',
        label: 'Lookups',
        icon: 'fas fa-list',
        component: LookupsSettings,
        description: 'Manage dropdown and reference data',
        requires: 'manageLookups'
    },
    {
        id: 'calendarTimes',
        label: 'Calendar Times',
        icon: 'fas fa-clock',
        component: CalendarTimesSettings,
        description: 'Configure calendar time slot visibility',
        // Owner decision (RF1, 2026-10-05): admin + front desk run it.
        requires: 'manageLookups'
    },
    {
        id: 'supabaseStatus',
        label: 'Supabase Status',
        icon: 'fas fa-cloud',
        component: SupabaseStatusSettings,
        description: 'Live status of Supabase portal & failover sync',
        feature: 'supabase'
    },
    {
        id: 'dolphinStatus',
        label: 'Dolphin Status',
        icon: 'fas fa-database',
        component: DolphinStatusSettings,
        description: 'Live status of the legacy Dolphin Imaging SQL Server sink',
        feature: 'dolphin'
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
        description: 'Telegram, 3Shape, Google Drive and Contacts, Gemini and the portal allow-list',
        requires: 'manageSettings'
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
        requires: 'manageUsers'
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

    // The active tab's unsaved-changes flag. Only the active tab can hold unsaved work
    // (a tab's edits live in its own state and are gone once it unmounts), so one
    // flag is the whole story. It used to be a per-tab map filed under a ref the
    // parent synced in an effect — which runs AFTER the newly mounted child's own
    // report, so a new tab's first report landed on the previous tab (FE-F21-4).
    const [dirtyTab, setDirtyTab] = useState<string | null>(null);
    const activeDirty = dirtyTab === activeTab;

    // Which sinks this install has. Until it answers (or if it fails) the sink tabs stay
    // listed, so a deep link to one is never bounced before the answer is in.
    const { data: features, isPending: featuresPending } = useQuery(syncFeaturesQuery());

    // Filter tabs by role and by what this install has.
    const filteredTabs = useMemo(() => {
        const caps = roleCaps((userRole ?? undefined) as UserRole | undefined);
        return tabs.filter(tabItem =>
            (!tabItem.requires || caps[tabItem.requires]) &&
            (!tabItem.feature || !features || features[tabItem.feature])
        );
    }, [userRole, features]);

    // Switching tabs or leaving Settings with unsaved edits asks first (the tab's
    // edits are dropped when it unmounts); a reload gets the browser's prompt.
    useUnsavedRouteGuard(activeDirty);

    // Sync activeTab with URL parameter. Done during render (adjust-state-during-render),
    // keyed on the URL `tab` value, rather than in an effect so the React Compiler can
    // optimize it.
    const [syncedTab, setSyncedTab] = useState<string | undefined>(tab);
    if (tab !== syncedTab) {
        setSyncedTab(tab);
        if (tab && filteredTabs.some(t => t.id === tab)) {
            setActiveTab(tab);
            // The guard let this switch through, so the old tab's edits are discarded.
            setDirtyTab(null);
        }
    }

    // Redirect to the fallback tab if the active one is unknown or unauthorized.
    useEffect(() => {
        if (userRole === null || featuresPending) return; // Wait until both are loaded

        if (!filteredTabs.some(t => t.id === activeTab)) {
            navigate(`/settings/${filteredTabs[0]?.id ?? 'general'}`, { replace: true });
        }
    }, [userRole, featuresPending, activeTab, filteredTabs, navigate]);

    const handleTabChange = (tabId: string): void => {
        if (filteredTabs.some(t => t.id === tabId)) {
            navigate(`/settings/${tabId}`);
        }
    };

    // The reporter handed to the active tab, bound to that tab's id. Stable per tab
    // (several tabs list it in an effect's deps).
    const handleTabChangesUpdate = useCallback((hasChanges: boolean): void => {
        setDirtyTab(prev => (hasChanges ? activeTab : prev === activeTab ? null : prev));
    }, [activeTab]);

    const tabData = useMemo(
        () => (dirtyTab ? { [dirtyTab]: { hasChanges: true } } : {}),
        [dirtyTab]
    );

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

            <div
                className={styles.content}
                role="tabpanel"
                id={settingsPanelId(activeTab)}
                aria-labelledby={settingsTabId(activeTab)}
                tabIndex={0}
            >
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
