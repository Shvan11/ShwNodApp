import React from 'react';

const SettingsTabNavigation = ({ tabs, activeTab, onTabChange, tabData }) => {
    
    const getTabBadge = (tabId) => {
        const data = tabData[tabId];
        if (data && data.hasChanges) {
            return (
                <span className="tab-badge">
                    <i className="fas fa-circle"></i>
                </span>
            );
        }
        return null;
    };

    return (
        <div className="settings-tab-navigation">
            <div className="tab-header">
                <h2>Settings</h2>
            </div>
            
            <div className="tab-buttons">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${tab.disabled ? 'disabled' : ''}`}
                        onClick={() => !tab.disabled && onTabChange(tab.id)}
                        disabled={tab.disabled}
                        title={tab.description}
                    >
                        <i className={tab.icon}></i>
                        <span className="tab-label">{tab.label}</span>
                        {getTabBadge(tab.id)}
                        {tab.disabled && (
                            <span className="coming-soon-badge">Soon</span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default SettingsTabNavigation;