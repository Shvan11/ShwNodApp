import React, { useState, useEffect, useCallback, ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Settings page CSS (loaded when settings route is visited)
import '../../../css/pages/settings.css';
import '../../../css/pages/cost-presets-settings.css';
import '../../../css/pages/user-management.css';
import SettingsTabNavigation from './SettingsTabNavigation';
import GeneralSettings from './GeneralSettings';
import DatabaseSettings from './DatabaseSettings';
import AlignerDoctorsSettings from './AlignerDoctorsSettings';
import EmailSettings from './EmailSettings';
import EmployeeSettings from './EmployeeSettings';
import UserManagement from './UserManagement';
import AdminUserManagement from './AdminUserManagement';
import CostPresetsSettings from './CostPresetsSettings';
import LookupsSettings from './LookupsSettings';

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

interface UserResponse {
    success: boolean;
    user?: {
        role: string;
    };
}

const SettingsComponent: React.FC = () => {
    const { tab } = useParams<{ tab?: string }>();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<string>(tab || 'general');
    const [userRole, setUserRole] = useState<string | null>(null);
    const [tabData, setTabData] = useState<TabDataState>({
        general: { hasChanges: false },
        database: { hasChanges: false },
        alignerDoctors: { hasChanges: false },
        email: { hasChanges: false },
        employees: { hasChanges: false },
        costPresets: { hasChanges: false },
        lookups: { hasChanges: false },
        messaging: { hasChanges: false },
        system: { hasChanges: false },
        security: { hasChanges: false },
        users: { hasChanges: false }
    });

    // Fetch current user role
    useEffect(() => {
        async function fetchUserRole(): Promise<void> {
            try {
                const response = await fetch('/api/auth/me', { credentials: 'include' });
                const data: UserResponse = await response.json();
                if (data.success && data.user) {
                    setUserRole(data.user.role);
                }
            } catch (error) {
                console.error('Failed to fetch user role:', error);
            }
        }
        fetchUserRole();
    }, []);

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
            id: 'costPresets',
            label: 'Cost Presets',
            icon: 'fas fa-dollar-sign',
            component: CostPresetsSettings,
            description: 'Manage estimated cost preset values'
        },
        {
            id: 'lookups',
            label: 'Lookups',
            icon: 'fas fa-list',
            component: LookupsSettings,
            description: 'Manage dropdown and reference data'
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

    // Sync activeTab with URL parameter
    useEffect(() => {
        if (tab && tabs.find(t => t.id === tab && !t.disabled)) {
            setActiveTab(tab);
        }
    }, [tab]);

    const handleTabChange = (tabId: string): void => {
        const selectedTab = tabs.find(t => t.id === tabId);
        if (selectedTab && !selectedTab.disabled) {
            navigate(`/settings/${tabId}`);
        }
    };

    const handleTabChangesUpdate = useCallback((tabId: string, hasChanges: boolean): void => {
        setTabData(prev => ({
            ...prev,
            [tabId]: {
                ...prev[tabId],
                hasChanges
            }
        }));
    }, []);

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
        <div className="settings-container">
            <SettingsTabNavigation
                tabs={filteredTabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                tabData={tabData}
            />

            <div className="settings-content">
                {ActiveTabComponent ? (
                    <ActiveTabComponent
                        onChangesUpdate={(hasChanges: boolean) => handleTabChangesUpdate(activeTab, hasChanges)}
                    />
                ) : (
                    <div className="settings-placeholder">
                        <div className="placeholder-icon">
                            <i className={activeTabConfig?.icon || 'fas fa-cog'}></i>
                        </div>
                        <h3>{activeTabConfig?.label || 'Settings'}</h3>
                        <p>This section is coming soon.</p>
                        <p className="placeholder-description">
                            {activeTabConfig?.description || 'Configure your system settings'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsComponent;
