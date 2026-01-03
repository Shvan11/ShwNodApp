import React from 'react';
import cn from 'classnames';
import styles from './SettingsTabNavigation.module.css';

interface TabConfig {
    id: string;
    label: string;
    icon: string;
    description: string;
    disabled?: boolean;
}

interface TabDataItem {
    hasChanges: boolean;
}

interface TabDataState {
    [key: string]: TabDataItem;
}

interface SettingsTabNavigationProps {
    tabs: TabConfig[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
    tabData: TabDataState;
}

const SettingsTabNavigation: React.FC<SettingsTabNavigationProps> = ({ tabs, activeTab, onTabChange, tabData }) => {

    const getTabBadge = (tabId: string): React.ReactNode => {
        const data = tabData[tabId];
        if (data && data.hasChanges) {
            return (
                <span className={styles.badge}>
                    <i className="fas fa-circle"></i>
                </span>
            );
        }
        return null;
    };

    return (
        <div className={styles.navigation}>
            <div className={styles.header}>
                <h2>Settings</h2>
            </div>

            <div className={styles.buttons}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={cn(
                            styles.button,
                            activeTab === tab.id && styles.active,
                            tab.disabled && styles.disabled
                        )}
                        onClick={() => !tab.disabled && onTabChange(tab.id)}
                        disabled={tab.disabled}
                        title={tab.description}
                    >
                        <i className={tab.icon}></i>
                        <span className={styles.label}>{tab.label}</span>
                        {getTabBadge(tab.id)}
                        {tab.disabled && (
                            <span className={styles.comingSoonBadge}>Soon</span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default SettingsTabNavigation;
