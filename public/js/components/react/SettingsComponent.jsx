import React, { useState, useEffect, useCallback } from 'react';
import SettingsTabNavigation from './SettingsTabNavigation.jsx';
import GeneralSettings from './GeneralSettings.jsx';
import DatabaseSettings from './DatabaseSettings.jsx';
import AlignerDoctorsSettings from './AlignerDoctorsSettings.jsx';

const SettingsComponent = () => {
    const [activeTab, setActiveTab] = useState('general');
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

    // Load active tab from URL query parameter or localStorage
    useEffect(() => {
        // Check for tab query parameter in URL
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('tab');

        if (tabParam && tabs.find(tab => tab.id === tabParam && !tab.disabled)) {
            setActiveTab(tabParam);
        } else {
            // Fall back to saved tab from localStorage
            const savedTab = localStorage.getItem('settings-active-tab');
            if (savedTab && tabs.find(tab => tab.id === savedTab && !tab.disabled)) {
                setActiveTab(savedTab);
            }
        }
    }, []);

    // Save active tab to localStorage
    useEffect(() => {
        localStorage.setItem('settings-active-tab', activeTab);
    }, [activeTab]);

    const handleTabChange = (tabId) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab && !tab.disabled) {
            setActiveTab(tabId);
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

    const renderTabContent = () => {
        const currentTab = tabs.find(tab => tab.id === activeTab);
        
        if (!currentTab) return null;

        if (currentTab.disabled || !currentTab.component) {
            return (
                <div className="coming-soon-content">
                    <div className="coming-soon-icon">
                        <i className={currentTab.icon}></i>
                    </div>
                    <h3>{currentTab.label} Settings</h3>
                    <p>{currentTab.description}</p>
                    <div className="coming-soon-message">
                        <i className="fas fa-clock"></i>
                        <span>This feature is coming soon!</span>
                    </div>
                </div>
            );
        }

        const TabComponent = currentTab.component;
        return (
            <TabComponent 
                onChangesUpdate={(hasChanges) => handleTabChangesUpdate(activeTab, hasChanges)}
            />
        );
    };

    return (
        <div className="settings-container">
            <SettingsTabNavigation
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                tabData={tabData}
            />
            
            <div className="tab-content">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default SettingsComponent;