import React, { useEffect, useRef } from 'react';
import cn from 'classnames';
import styles from './SettingsTabNavigation.module.css';

interface TabConfig {
    id: string;
    label: string;
    icon: string;
    description: string;
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

/** Shared with SettingsComponent, which puts the matching ids on the panel. */
export const settingsTabId = (tabId: string) => `settings-tab-${tabId}`;
export const settingsPanelId = (tabId: string) => `settings-panel-${tabId}`;

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

    // WAI-ARIA tabs: roving tabindex, so the strip is ONE tab stop and the arrow
    // keys move between tabs (the previous markup was a row of plain buttons with
    // no role, no aria-selected and no type — inside a form they would also have
    // submitted it).
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        const i = tabs.findIndex(t => t.id === activeTab);
        if (i < 0) return;
        let next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        const nextId = tabs[next].id;
        onTabChange(nextId);
        // Move focus with the selection. Roving tabindex makes the previously
        // active button tabIndex -1 on the next render, so leaving focus behind
        // would strand the keyboard user on a non-tab-stop.
        document.getElementById(settingsTabId(nextId))?.focus();
    };

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

            <div className={styles.buttons} ref={buttonsRef} role="tablist" aria-label="Settings sections">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={settingsTabId(tab.id)}
                        aria-selected={activeTab === tab.id}
                        aria-controls={settingsPanelId(tab.id)}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                        ref={activeTab === tab.id ? activeButtonRef : undefined}
                        className={cn(styles.button, activeTab === tab.id && styles.active)}
                        onClick={() => onTabChange(tab.id)}
                        onKeyDown={handleKeyDown}
                        title={tab.description}
                    >
                        <i className={tab.icon}></i>
                        <span className={styles.label}>{tab.label}</span>
                        {getTabBadge(tab.id)}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default SettingsTabNavigation;
