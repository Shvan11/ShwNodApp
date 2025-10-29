import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SettingsTabNavigation from './SettingsTabNavigation.jsx';
import GeneralSettings from './GeneralSettings.jsx';
import DatabaseSettings from './DatabaseSettings.jsx';
import AlignerDoctorsSettings from './AlignerDoctorsSettings.jsx';

const SettingsComponent = () => {
    const { tab } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(tab || 'general');
    const [tabData, setTabData] = useState({
        general: { hasChanges: false },
        database: { hasChanges: false },
        alignerDoctors: { hasChanges: false },
        messaging: { hasChanges: false },
        system: { hasChanges: false },
        security: { hasChanges: false }
    });

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
            component: null,
            description: 'Access control and security settings',
            disabled: true
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

    // Get the active tab component
    const activeTabConfig = tabs.find(t => t.id === activeTab);
    const ActiveTabComponent = activeTabConfig?.component;

    return (
        <div className="settings-container">
            <SettingsTabNavigation
                tabs={tabs}
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
