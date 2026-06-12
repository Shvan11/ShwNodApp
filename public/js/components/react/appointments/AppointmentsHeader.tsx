import { type ChangeEvent, type MouseEvent } from 'react';
import ConnectionStatus, { type ConnectionStatusType, type FreshnessType } from './ConnectionStatus';
import StatsCards from './StatsCards';
import styles from './AppointmentsHeader.module.css';

interface AppointmentsHeaderProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onRefresh: () => void;
    isRefreshing: boolean;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    connectionStatus: ConnectionStatusType;
    freshness: FreshnessType;
    isViewingToday: boolean;
    showFlash: boolean;
    stats: {
        total: number;
        checkedIn: number;
        absent: number;
        waiting: number;
    };
}

/**
 * AppointmentsHeader Component
 * Sticky header with a combined date label/picker, inline stat chips, refresh
 * button, search box, and connection status.
 */
const AppointmentsHeader = ({
    selectedDate,
    onDateChange,
    onRefresh,
    isRefreshing,
    searchTerm,
    onSearchChange,
    connectionStatus,
    freshness,
    isViewingToday,
    showFlash,
    stats
}: AppointmentsHeaderProps) => {
    // Compact, weekday-prefixed date — e.g. "Sat, 13-6-2026".
    const formatShortDate = (dateString: string): string => {
        if (!dateString) return 'Today';
        const date = new Date(dateString + 'T12:00:00'); // noon avoids TZ date-shift
        const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
        return `${weekday}, ${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
    };

    const handleDateInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        onDateChange(e.target.value);
    };

    // Step the selected day by ±1 (noon avoids TZ date-shift).
    const shiftDay = (delta: number): void => {
        const base = selectedDate ? new Date(selectedDate + 'T12:00:00') : new Date();
        base.setDate(base.getDate() + delta);
        const year = base.getFullYear();
        const month = String(base.getMonth() + 1).padStart(2, '0');
        const day = String(base.getDate()).padStart(2, '0');
        onDateChange(`${year}-${month}-${day}`);
    };

    const handleSearchInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        onSearchChange(e.target.value);
    };

    // The visible pill is just chrome; the transparent native date input overlays
    // it and owns interaction. A plain click on a date input only focuses it, so
    // pop the calendar explicitly where the browser supports it.
    const openDatePicker = (e: MouseEvent<HTMLInputElement>): void => {
        const el = e.currentTarget;
        if (typeof el.showPicker === 'function') {
            try { el.showPicker(); } catch { /* unsupported context — focus is enough */ }
        }
    };

    return (
        <div className={styles.header}>
            {/* Stats — left */}
            <StatsCards
                variant="header"
                total={stats.total}
                checkedIn={stats.checkedIn}
                absent={stats.absent}
                waiting={stats.waiting}
            />

            {/* Combined date label + picker (+ day steppers + refresh) — middle */}
            <div className={styles.dateGroup}>
                {/* Chevrons + pill form one cluster; refresh stays a separate
                    sibling so the mobile space-between row splits cluster | refresh */}
                <div className={styles.dateNav}>
                    <button
                        type="button"
                        className={styles.dayNavButton}
                        onClick={() => shiftDay(-1)}
                        title="Previous day"
                        aria-label="Previous day"
                    >
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    {/* The label IS the trigger (no separate "Select Date") */}
                    <div className={styles.datePill}>
                        <i className={`fas fa-calendar-day ${styles.datePillIcon}`} aria-hidden="true"></i>
                        <span className={styles.datePillText}>{formatShortDate(selectedDate)}</span>
                        <i className={`fas fa-chevron-down ${styles.datePillCaret}`} aria-hidden="true"></i>
                        <input
                            type="date"
                            aria-label="Select appointment date"
                            className={styles.datePillInput}
                            value={selectedDate}
                            onChange={handleDateInputChange}
                            onClick={openDatePicker}
                        />
                    </div>
                    <button
                        type="button"
                        className={styles.dayNavButton}
                        onClick={() => shiftDay(1)}
                        title="Next day"
                        aria-label="Next day"
                    >
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>
                <button
                    className={styles.refreshButton}
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    title="Jump to today and refresh"
                >
                    <i className={`fas fa-sync-alt ${isRefreshing ? styles.spinning : ''}`}></i>
                </button>
            </div>

            {/* Search + connection status — right */}
            <div className={styles.searchGroup}>
                <div className={styles.searchWrapper}>
                    <i className={`fas fa-search ${styles.searchIcon}`}></i>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search patient..."
                        value={searchTerm}
                        onChange={handleSearchInputChange}
                    />
                    {searchTerm && (
                        <button
                            className={styles.searchClear}
                            onClick={() => onSearchChange('')}
                            title="Clear search"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
                <ConnectionStatus
                    status={connectionStatus}
                    freshness={freshness}
                    isViewingToday={isViewingToday}
                    showFlash={showFlash}
                />
            </div>
        </div>
    );
};

export type { AppointmentsHeaderProps };
export default AppointmentsHeader;
