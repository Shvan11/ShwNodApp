import React, { useEffect, useRef } from 'react';
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

    const buttonsRef = useRef<HTMLDivElement>(null);
    const activeButtonRef = useRef<HTMLButtonElement>(null);

    // On mobile the tabs are a horizontal-scroll strip — keep the active tab in
    // view when it changes (e.g. deep-link or programmatic switch). Scrolls only
    // the strip horizontally, never the page (no-op on desktop where it wraps).
    useEffect(() => {
        const container = buttonsRef.current;
        const active = activeButtonRef.current;
        if (!container || !active) return;
        const cRect = container.getBoundingClientRect();
        const aRect = active.getBoundingClientRect();
        const delta = (aRect.left - cRect.left) - (container.clientWidth - active.clientWidth) / 2;
        container.scrollBy({ left: delta, behavior: 'smooth' });
    }, [activeTab]);

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

            <div className={styles.buttons} ref={buttonsRef}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        ref={activeTab === tab.id ? activeButtonRef : undefined}
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
