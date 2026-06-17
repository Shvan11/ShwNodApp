import { type ChangeEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import ConnectionStatus, { type ConnectionStatusType, type FreshnessType } from './ConnectionStatus';
import StatsCards from './StatsCards';
import DoctorFilterSelect from './DoctorFilterSelect';
import type { LegendDoctor } from '../calendar.types';
import { getActiveLanguageMeta } from '../../../core/language';
import styles from './AppointmentsHeader.module.css';

// Doctor-filter selection: a specific doctor (employees.id) or every doctor.
export type DoctorFilter = number | 'all';

interface AppointmentsHeaderProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onRefresh: () => void;
    isRefreshing: boolean;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    doctors: LegendDoctor[];
    selectedDrId: DoctorFilter;
    onDoctorChange: (value: DoctorFilter) => void;
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
    doctors,
    selectedDrId,
    onDoctorChange,
    connectionStatus,
    freshness,
    isViewingToday,
    showFlash,
    stats
}: AppointmentsHeaderProps) => {
    const { t } = useTranslation('appointments');

    // Compact, weekday-prefixed date — e.g. "Sat, 13-6-2026" / "السبت, 13-6-2026".
    // The weekday localizes to the active language; day/month/year stay Western
    // digits (the active locale pins Latin numerals — see core/language.ts).
    const formatShortDate = (dateString: string): string => {
        if (!dateString) return t('header.today');
        const date = new Date(dateString + 'T12:00:00'); // noon avoids TZ date-shift
        const weekday = date.toLocaleDateString(getActiveLanguageMeta().locale, { weekday: 'short' });
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
                        title={t('header.previousDay')}
                        aria-label={t('header.previousDay')}
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
                            aria-label={t('header.selectDate')}
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
                        title={t('header.nextDay')}
                        aria-label={t('header.nextDay')}
                    >
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>
                <button
                    className={styles.refreshButton}
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    title={t('header.refresh')}
                >
                    <i className={`fas fa-sync-alt ${isRefreshing ? styles.spinning : ''}`}></i>
                </button>
            </div>

            {/* Doctor filter + search + connection status — right */}
            <div className={styles.searchGroup}>
                <DoctorFilterSelect
                    doctors={doctors}
                    value={selectedDrId}
                    onChange={onDoctorChange}
                />
                <div className={styles.searchWrapper}>
                    <i className={`fas fa-search ${styles.searchIcon}`}></i>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder={t('header.searchPlaceholder')}
                        value={searchTerm}
                        onChange={handleSearchInputChange}
                    />
                    {searchTerm && (
                        <button
                            className={styles.searchClear}
                            onClick={() => onSearchChange('')}
                            title={t('header.clearSearch')}
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
