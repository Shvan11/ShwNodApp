import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SettingsTabNavigation from './SettingsTabNavigation.jsx';
import GeneralSettings from './GeneralSettings.jsx';
import DatabaseSettings from './DatabaseSettings.jsx';
import AlignerDoctorsSettings from './AlignerDoctorsSettings.jsx';
import EmailSettings from './EmailSettings.jsx';
import EmployeeSettings from './EmployeeSettings.jsx';
import UserManagement from './UserManagement.jsx';
import AdminUserManagement from './AdminUserManagement.jsx';

const SettingsComponent = () => {
    const { tab } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(tab || 'general');
    const [userRole, setUserRole] = useState(null);
    const [tabData, setTabData] = useState({
        general: { hasChanges: false },
        database: { hasChanges: false },
        alignerDoctors: { hasChanges: false },
        email: { hasChanges: false },
        employees: { hasChanges: false },
        messaging: { hasChanges: false },
        system: { hasChanges: false },
        security: { hasChanges: false },
        users: { hasChanges: false }
    });

    // Fetch current user role
    useEffect(() => {
        async function fetchUserRole() {
            try {
                const response = await fetch('/api/auth/me', { credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    setUserRole(data.user.role);
                }
            } catch (error) {
                console.error('Failed to fetch user role:', error);
            }
        }
        fetchUserRole();
    }, []);

    // Tab configuration
    const tabs = [
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

    const handleTabChange = (tabId) => {
        const selectedTab = tabs.find(t => t.id === tabId);
        if (selectedTab && !selectedTab.disabled) {
            navigate(`/settings/${tabId}`);
        }
    };

    const handleTabChangesUpdate = useCallback((tabId, hasChanges) => {
        setTabData(prev => ({
            ...prev,
            [tabId]: {
                ...prev[tabId],
                hasChanges
            }
        }));
    }, []);

    // Filter tabs based on user role
    const filteredTabs = tabs.filter(tab => {
        // Hide admin-only tabs from non-admins
        if (tab.adminOnly && userRole !== 'admin') {
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
                        onChangesUpdate={(hasChanges) => handleTabChangesUpdate(activeTab, hasChanges)}
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
