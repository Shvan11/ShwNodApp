import React, { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { z } from 'zod';
import Chart from '../../utils/chartSetup';
import DailyInvoicesModal from './DailyInvoicesModal';
import DoctorCommissionsView from './DoctorCommissionsView';
import RevenueBreakdownView from './RevenueBreakdownView';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters';
import { getChartThemeColors } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import type * as reportsContract from '@shared/contracts/reports.contract';
import { httpErrorMessage } from '@/core/http';
import { parseLocalDate } from '@/utils/calendarDate';
import {
    statisticsQuery,
    yearlyStatisticsQuery,
    multiYearStatisticsQuery,
} from '@/query/queries';
import styles from './StatisticsComponent.module.css';

// Types — the parsed contract payloads; the screen reads them as they arrive
// (three hand-written interfaces used to re-type them by assertion: FE-F5-10).
type StatisticsData = z.infer<typeof reportsContract.statistics.response>;
type DailyData = StatisticsData['dailyData'][number];

interface ChartDataItem {
    label: string;
    /** null renders as a gap in the line — an unconvertible period, not a zero. */
    grandTotal: number | null;
}

// View mode constants
const VIEW_MODES = { DAILY: 'daily', MONTHLY: 'monthly', YEARLY: 'yearly', COMMISSIONS: 'commissions', BREAKDOWN: 'breakdown' } as const;
type ViewMode = typeof VIEW_MODES[keyof typeof VIEW_MODES];
const isViewMode = (v: string | null): v is ViewMode =>
    v != null && (Object.values(VIEW_MODES) as string[]).includes(v);

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * A year field that commits only a whole year inside `[min, max]`: at the 4th digit
 * (or a spinner step) and on Enter/blur. Committing every keystroke fetched
 * `year=2`, `20`, `202` and wrote `year=NaN` to the URL on clear; a range check on
 * every keystroke reverted each digit, so the Yearly From/To could not be typed into
 * at all (FE-F5-9). An invalid draft snaps back to the committed value on blur.
 */
const YearInput = ({ value, min, max, onCommit, id, className, ariaLabel }: {
    value: number;
    min: number;
    max: number;
    onCommit: (year: number) => void;
    id?: string;
    className?: string;
    ariaLabel?: string;
}) => {
    const [draft, setDraft] = useState(String(value));
    const [shown, setShown] = useState(value);
    if (value !== shown) {
        setShown(value);
        setDraft(String(value));
    }
    const valid = (v: string): number | null => {
        if (!/^\d{4}$/.test(v)) return null;
        const n = parseInt(v, 10);
        return n >= min && n <= max ? n : null;
    };
    const settle = () => {
        const n = valid(draft);
        if (n == null) setDraft(String(value));
        else if (n !== value) onCommit(n);
    };
    return (
        <input
            id={id}
            type="number"
            inputMode="numeric"
            value={draft}
            min={min}
            max={max}
            aria-label={ariaLabel}
            className={className}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setDraft(e.target.value);
                const n = valid(e.target.value);
                if (n != null && n !== value) onCommit(n);
            }}
            onBlur={settle}
            onKeyDown={(e) => { if (e.key === 'Enter') settle(); }}
        />
    );
};

// Self-contained tabs that own their own date-range picker + query and so hide the
// month-nav, summary cards, and daily table the time-based views share.
const isCustomView = (mode: ViewMode): boolean =>
    mode === VIEW_MODES.COMMISSIONS || mode === VIEW_MODES.BREAKDOWN;

// Tabs restricted to admins: per-doctor earnings / revenue breakdowns, plus the
// Monthly and Yearly rollups (multi-period revenue is admin-only like the others).
const isAdminOnlyView = (mode: ViewMode): boolean =>
    mode === VIEW_MODES.COMMISSIONS ||
    mode === VIEW_MODES.BREAKDOWN ||
    mode === VIEW_MODES.MONTHLY ||
    mode === VIEW_MODES.YEARLY;

// Label + icon for each tab, rendered in the persistent page-level tab bar.
const TAB_META: Record<ViewMode, { label: string; icon: string }> = {
    [VIEW_MODES.DAILY]: { label: 'Daily', icon: 'fa-calendar-day' },
    [VIEW_MODES.MONTHLY]: { label: 'Monthly', icon: 'fa-calendar-alt' },
    [VIEW_MODES.YEARLY]: { label: 'Yearly', icon: 'fa-calendar' },
    [VIEW_MODES.COMMISSIONS]: { label: 'Commissions', icon: 'fa-hand-holding-dollar' },
    [VIEW_MODES.BREAKDOWN]: { label: 'Breakdown', icon: 'fa-chart-pie' },
};

const StatisticsComponent = () => {
    const { resolvedTheme } = useTheme();
    const user = useAuthUser();
    // Clinic-wide money is admin + front-desk only (front desk runs the cash box and
    // hands the drawer over); the server enforces the same line with
    // authorize(FINANCE_ROLES). Identity can resolve a beat after first paint on a cold
    // tab, so "not yet known" is treated as neither allowed nor denied — the page shows
    // its loading state instead of flashing an access error or firing a request that 403s.
    const roleKnown = !!user?.role;
    const caps = roleCaps(user?.role as UserRole | undefined);
    const canViewFinance = caps.viewFinance;
    const canViewReports = caps.viewReports;
    const [searchParams, setSearchParams] = useSearchParams();
    const [month, setMonth] = useState(parseInt(searchParams.get('month') || '', 10) || new Date().getMonth() + 1);
    const [year, setYear] = useState(parseInt(searchParams.get('year') || '', 10) || new Date().getFullYear());
    // For Monthly view: separate start month/year for 12-month period
    const [periodStartMonth, setPeriodStartMonth] = useState(1);
    const [periodStartYear, setPeriodStartYear] = useState(new Date().getFullYear());
    // For Yearly view: year range
    const [yearRangeStart, setYearRangeStart] = useState(new Date().getFullYear() - 4);
    const [yearRangeEnd, setYearRangeEnd] = useState(new Date().getFullYear());
    // `?view=` round-trips like month/year/day (it used to be read once, unvalidated,
    // and never written back, so a tab was lost on reload or Back: FE-F5-15d).
    const viewParam = searchParams.get('view');
    const viewMode: ViewMode = isViewMode(viewParam) ? viewParam : VIEW_MODES.DAILY;
    const setViewMode = (mode: ViewMode) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (mode === VIEW_MODES.DAILY) next.delete('view');
            else next.set('view', mode);
            return next;
        }, { replace: true });
    };

    // Non-admins can't reach the admin-only tabs — if one is selected via a deep link
    // (?view=breakdown / ?view=commissions), coerce it to Daily for rendering. Derived
    // (not a setState-in-effect) so it's recomputed every render: an admin whose identity
    // resolves a beat after first paint snaps straight to their tab with no bounce.
    const effectiveViewMode: ViewMode =
        !canViewReports && isAdminOnlyView(viewMode) ? VIEW_MODES.DAILY : viewMode;

    // Statistics for the selected month — the headline read. `isFetching` drives the
    // refresh spinner; `keepPreviousData` keeps the last month on screen during a
    // month change instead of flashing the full-screen spinner.
    const {
        data: statisticsData,
        isFetching: loading,
        isError,
        error: statsError,
        refetch: refetchStatistics,
    } = useQuery({
        ...statisticsQuery(month, year),
        placeholderData: keepPreviousData,
        // The custom tabs (Commissions / Breakdown) own their own queries and never
        // read the monthly stats — don't fetch them while one of those tabs is open.
        enabled: roleKnown && canViewFinance && !isCustomView(effectiveViewMode),
    });
    const statistics: StatisticsData | null = statisticsData ?? null;
    const error = isError ? httpErrorMessage(statsError, 'Failed to fetch statistics') : null;

    // 12-month rollup — only fetched in Monthly view (cleared between fetches, so no
    // keepPreviousData here).
    const { data: yearlyData = null, isFetching: loadingYearly, refetch: refetchYearly } = useQuery({
        ...yearlyStatisticsQuery(periodStartMonth, periodStartYear),
        enabled: effectiveViewMode === VIEW_MODES.MONTHLY,
    });

    // Multi-year rollup — only fetched in Yearly view.
    const { data: multiYearData = null, isFetching: loadingMultiYear, refetch: refetchMultiYear } = useQuery({
        ...multiYearStatisticsQuery(yearRangeStart, yearRangeEnd),
        enabled: effectiveViewMode === VIEW_MODES.YEARLY,
    });

    // Refresh re-reads whatever the open view shows: in Monthly/Yearly that is the
    // rollup behind the chart too, not just the month (FE-F5-15c).
    const refreshAll = () => {
        void refetchStatistics();
        if (effectiveViewMode === VIEW_MODES.MONTHLY) void refetchYearly();
        if (effectiveViewMode === VIEW_MODES.YEARLY) void refetchMultiYear();
    };

    // Modal open-state lives in the URL (?day=YYYY-MM-DD) so browser back/forward
    // and deep links re-open it; the full row is looked up from the loaded month.
    const selectedDay = searchParams.get('day');
    const dayMonth = selectedDay ? parseInt(selectedDay.slice(5, 7), 10) : NaN;
    const dayYear = selectedDay ? parseInt(selectedDay.slice(0, 4), 10) : NaN;
    const dayIsInLoadedMonth = dayMonth === month && dayYear === year;
    const selectedDayRow = selectedDay
        ? statistics?.dailyData.find(d => d.Day === selectedDay) ?? null
        : null;
    // Once the day's own month is loaded, open the modal even if that day has no row in
    // dailyData (a day with no invoices AND no expenses simply isn't in the result set) —
    // the modal renders its own "no invoices" state. DailyInvoicesModal accepts the bare
    // date string for exactly this case; only the per-day expense/cash figures, which
    // live on the row, are then unavailable.
    const selectedDate: DailyData | string | null =
        selectedDayRow ?? (selectedDay && statistics && dayIsInLoadedMonth ? selectedDay : null);

    // A ?day= deep link can name a day OUTSIDE the month currently loaded — a shared link
    // carrying only ?day= lands on today's month, so the lookup above found nothing and
    // the modal silently never opened. Adopt the day's own month/year; the URL effect
    // below then writes them back, and the refetched month resolves the row.
    //
    // Keyed adjust-during-render (not an effect, matching the pattern used elsewhere in
    // the app) and keyed on the ?day VALUE, so it fires once per deep link — navigating
    // the month picker with the modal open never yanks the month back.
    const [seededDeepLinkDay, setSeededDeepLinkDay] = useState<string | null>(null);
    if (selectedDay && selectedDay !== seededDeepLinkDay) {
        setSeededDeepLinkDay(selectedDay);
        if (dayMonth && dayYear && (dayMonth !== month || dayYear !== year)) {
            setMonth(dayMonth);
            setYear(dayYear);
        }
    }

    // Keep month/year in the URL (preserving any open ?day modal param).
    useEffect(() => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('month', month.toString());
            next.set('year', year.toString());
            return next;
        }, { replace: true });
    }, [month, year, setSearchParams]);

    // Chart reference - single chart for Grand Total (USD)
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<Chart | null>(null);
    const revenueTrendChartRef = chartRef;
    const revenueTrendChartInstance = chartInstance;

    // Month names
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Calculate end month/year for the 12-month period
    const getPeriodEnd = () => {
        let endMonth = periodStartMonth + 11;
        let endYear = periodStartYear;
        if (endMonth > 12) {
            endMonth -= 12;
            endYear += 1;
        }
        return { endMonth, endYear };
    };

    // Chart label for a daily row: "d/m" on the clinic's calendar day.
    const dayLabel = (day: string | undefined): string => {
        if (!day) return '';
        const date = parseLocalDate(day);
        return `${date.getDate()}/${date.getMonth() + 1}`;
    };

    // Helper: Aggregate for monthly view (show all months of the year)
    const aggregateByMonth = (dailyData: DailyData[]): ChartDataItem[] => {
        // Starts at null and only becomes a number once a convertible day contributes,
        // so a month with no exchange rate stays a gap rather than plotting as zero.
        const months: Record<number, { grandTotal: number | null; month: number }> = {};
        dailyData.forEach(day => {
            if (!day.Day) return;
            // Date-only strings parse as UTC midnight through `new Date()`; read with
            // local getters that is the previous day west of UTC (FE-F5-15b).
            const date = parseLocalDate(day.Day);
            const monthKey = date.getMonth();
            if (!months[monthKey]) {
                months[monthKey] = { grandTotal: null, month: monthKey };
            }
            if (day.GrandTotal != null) {
                months[monthKey].grandTotal = (months[monthKey].grandTotal ?? 0) + day.GrandTotal;
            }
        });

        return Object.values(months)
            .sort((a, b) => a.month - b.month)
            .map(m => ({
                label: monthNames[m.month],
                grandTotal: m.grandTotal
            }));
    };

    // Create/update chart - Grand Total (USD) only
    useEffect(() => {
        if (!statistics || !statistics.dailyData) return;
        if (!revenueTrendChartRef.current) return;

        // Wait for yearly data to load before rendering monthly view
        if (effectiveViewMode === VIEW_MODES.MONTHLY && loadingYearly) {
            return;
        }

        // Wait for multi-year data to load before rendering yearly view
        if (effectiveViewMode === VIEW_MODES.YEARLY && loadingMultiYear) {
            return;
        }

        const ctx = revenueTrendChartRef.current.getContext('2d');
        if (!ctx) return;

        // Destroy previous chart
        if (revenueTrendChartInstance.current) {
            revenueTrendChartInstance.current.destroy();
        }

        let chartData: ChartDataItem[];
        let chartTitle = 'Grand Total (USD)';

        // Aggregate data based on view mode
        switch (effectiveViewMode) {
            case VIEW_MODES.DAILY:
                chartData = statistics.dailyData.map(day => ({
                    label: dayLabel(day.Day),
                    grandTotal: day.GrandTotal ?? null
                }));
                chartTitle = 'Daily Grand Total (USD)';
                break;
            case VIEW_MODES.MONTHLY:
                // Use yearlyData if available (fetched from dedicated API)
                if (yearlyData && yearlyData.monthlyData && yearlyData.monthlyData.length > 0) {
                    const { endMonth, endYear } = getPeriodEnd();
                    chartData = yearlyData.monthlyData.map(m => ({
                        label: `${monthNames[m.Month - 1].substring(0, 3)} ${m.Year}`,
                        grandTotal: m.GrandTotal ?? null
                    }));
                    chartTitle = `Monthly Revenue: ${monthNames[periodStartMonth - 1]} ${periodStartYear} - ${monthNames[endMonth - 1]} ${endYear}`;
                } else {
                    // Fallback to aggregating current month's daily data
                    chartData = aggregateByMonth(statistics.dailyData);
                    chartTitle = 'Monthly Grand Total (USD)';
                }
                break;
            case VIEW_MODES.YEARLY:
                // Use multiYearData if available (fetched from dedicated API)
                if (multiYearData && multiYearData.yearlyData && multiYearData.yearlyData.length > 0) {
                    chartData = multiYearData.yearlyData.map(y => ({
                        label: y.Year.toString(),
                        grandTotal: y.GrandTotal ?? null
                    }));
                    chartTitle = `Yearly Revenue: ${yearRangeStart} - ${yearRangeEnd}`;
                } else {
                    // Fallback to single data point from current month's data. Stays null
                    // (a gap) unless at least one day was actually convertible.
                    const yearlyTotal = statistics.dailyData.reduce<number | null>(
                        (sum, day) => (day.GrandTotal == null ? sum : (sum ?? 0) + day.GrandTotal),
                        null
                    );
                    chartData = [{ label: `${monthNames[month-1]} ${year}`, grandTotal: yearlyTotal }];
                    chartTitle = `Yearly Total (USD) - ${year}`;
                }
                break;
            default:
                chartData = statistics.dailyData.map(day => ({
                    label: dayLabel(day.Day),
                    grandTotal: day.GrandTotal ?? null
                }));
        }

        const labels = chartData.map(d => d.label);
        const grandTotals = chartData.map(d => d.grandTotal);
        // Chart.js renders to canvas — CSS vars must be resolved to hex first.
        const successGreen = getComputedStyle(document.documentElement)
            .getPropertyValue('--success-green').trim() || '#22c55e';
        const chartColors = getChartThemeColors();

        revenueTrendChartInstance.current = new Chart(ctx, {
            type: effectiveViewMode === VIEW_MODES.YEARLY ? 'bar' : 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Grand Total (USD)',
                    data: grandTotals,
                    borderColor: successGreen,
                    backgroundColor: effectiveViewMode === VIEW_MODES.YEARLY
                        ? `${successGreen}cc`
                        : `${successGreen}1a`,
                    tension: 0.3,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: effectiveViewMode === VIEW_MODES.DAILY ? 4 : 6,
                    pointBackgroundColor: successGreen,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 10,
                        right: 20,
                        bottom: 10,
                        left: 10
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: chartTitle,
                        color: chartColors.title,
                        font: { size: 16, weight: 'bold' },
                        padding: { top: 10, bottom: 20 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `$${formatNumber(context.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: chartColors.ticks,
                            callback: (value) => '$' + formatNumber(value as number)
                        },
                        grid: { color: chartColors.grid }
                    },
                    x: {
                        ticks: { color: chartColors.ticks },
                        grid: { display: false }
                    }
                }
            }
        });

        // Cleanup
        return () => {
            if (revenueTrendChartInstance.current) {
                revenueTrendChartInstance.current.destroy();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statistics, effectiveViewMode, month, year, yearlyData, loadingYearly, multiYearData, loadingMultiYear, yearRangeStart, yearRangeEnd, resolvedTheme]);

    // Navigation handlers
    const handlePrevMonth = () => {
        if (month === 1) {
            setMonth(12);
            setYear(year - 1);
        } else {
            setMonth(month - 1);
        }
    };

    const handleNextMonth = () => {
        if (month === 12) {
            setMonth(1);
            setYear(year + 1);
        } else {
            setMonth(month + 1);
        }
    };

    // Open/close the daily-invoices modal via the URL so browser navigation works.
    const openDayModal = (day: DailyData) => {
        const dayStr = day.Day;
        if (!dayStr) return;
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('day', dayStr);
            return next;
        });
    };

    const closeDayModal = () => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('day');
            return next;
        }, { replace: true });
    };

    // Format currency
    const formatCurrency = (amount: number | null | undefined, currency: string = 'IQD'): string => {
        return formatCurrencyUtil(amount || 0, currency);
    };

    // CONVERTED figures only (grand totals). null means "no exchange rate has ever been
    // recorded", which has to read as unknown — formatCurrency's `|| 0` would print a
    // confident "0 USD" for a month that may have taken millions of dinars.
    const formatConverted = (amount: number | null | undefined, currency: string = 'USD'): string => {
        return amount == null ? '—' : formatCurrencyUtil(amount, currency);
    };

    // Format date
    const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return '';
        const date = parseLocalDate(dateString);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    };

    // Handle print
    const handlePrint = () => {
        window.print();
    };

    // Clinical staff have no business in the clinic's books. Rendered after every hook
    // so the hook order stays stable; the queries above are already disabled for them.
    if (roleKnown && !canViewFinance) {
        return (
            <div className={styles.statisticsContainer}>
                <div className={styles.errorState}>
                    <i className="fas fa-lock" aria-hidden="true"></i>
                    <p>Financial statistics are restricted to admin and front-desk staff.</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className={styles.statisticsContainer}>
                {/* Header: page title + a persistent, page-level tab bar. Living above
                    every conditional element (month nav, cards, table), the tabs keep
                    the same position in every view — switching tabs never moves them. */}
                <div className={styles.pageHeader}>
                    <div className={styles.pageTitle}>
                        <h1>
                            <i className="fas fa-chart-bar" aria-hidden="true"></i>
                            Financial Statistics
                        </h1>
                    </div>
                    <div className={styles.viewTabs} role="tablist" aria-label="Statistics views">
                        {Object.values(VIEW_MODES)
                            .filter((value) => canViewReports || !isAdminOnlyView(value))
                            .map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="tab"
                                    aria-selected={effectiveViewMode === value}
                                    className={`${styles.viewTab} ${effectiveViewMode === value ? styles.viewTabActive : ''}`}
                                    onClick={() => setViewMode(value)}
                                >
                                    <i className={`fas ${TAB_META[value].icon}`} aria-hidden="true"></i>
                                    <span>{TAB_META[value].label}</span>
                                </button>
                            ))}
                    </div>
                </div>

                {/* The self-contained tabs own everything below the tab bar (their own
                    From/To navigator + query). The time-based tabs share the month nav,
                    summary cards, trend chart, and daily table that follow. */}
                {effectiveViewMode === VIEW_MODES.COMMISSIONS ? (
                    <div className={`${styles.chartCard} ${styles.chartCardFull}`}>
                        <DoctorCommissionsView />
                    </div>
                ) : effectiveViewMode === VIEW_MODES.BREAKDOWN ? (
                    <div className={`${styles.chartCard} ${styles.chartCardFull}`}>
                        <RevenueBreakdownView />
                    </div>
                ) : (
                <>
            {/* Controls (month nav) */}
            <div className={styles.controlsSection}>
                <div className={styles.dateSelector}>
                    <button onClick={handlePrevMonth} className={styles.btnNav} title="Previous Month">
                        <i className="fas fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <div className={styles.dateDisplay}>
                        <select
                            value={month}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setMonth(parseInt(e.target.value, 10))}
                            className={styles.formSelect}
                            aria-label="Month"
                        >
                            {monthNames.map((name, index) => (
                                <option key={index + 1} value={index + 1}>{name}</option>
                            ))}
                        </select>
                        <YearInput
                            value={year}
                            min={MIN_YEAR}
                            max={MAX_YEAR}
                            onCommit={setYear}
                            ariaLabel="Year"
                            className={styles.formInput}
                        />
                    </div>
                    <button onClick={handleNextMonth} className={styles.btnNav} title="Next Month">
                        <i className="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>
                </div>
                <div className={styles.actions}>
                    <button onClick={refreshAll} className={styles.btnAction} disabled={loading}>
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} aria-hidden="true"></i> Refresh
                    </button>
                    <button onClick={handlePrint} className={styles.btnAction}>
                        <i className="fas fa-print" aria-hidden="true"></i> Print
                    </button>
                </div>
            </div>

            {loading && !statistics ? (
                <div className={styles.loadingState}>
                    <div className={styles.spinner}></div>
                    <p>Loading statistics...</p>
                </div>
            ) : error && !statistics ? (
                <div className={styles.errorState}>
                    <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                    <p>{error}</p>
                    <button className={styles.btnRetry} onClick={() => refetchStatistics()}>Try Again</button>
                </div>
            ) : statistics ? (
                <>
                    {/* Summary Cards — month-scoped totals (admin-only) */}
                    {canViewReports && (
                    <div className={styles.summaryCards}>
                        <div className={`${styles.summaryCard} ${styles.revenue}`}>
                            <div className={styles.cardHeader}>
                                <i className="fas fa-money-bill-wave" aria-hidden="true"></i>
                                <h3>Total Revenue (Month)</h3>
                            </div>
                            <div className={styles.cardContent}>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>IQD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.totalRevenue.IQD)}</span>
                                </div>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>USD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.totalRevenue.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>

                        <div className={`${styles.summaryCard} ${styles.expenses}`}>
                            <div className={styles.cardHeader}>
                                <i className="fas fa-receipt" aria-hidden="true"></i>
                                <h3>Total Expenses (Month)</h3>
                            </div>
                            <div className={styles.cardContent}>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>IQD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.totalExpenses.IQD)}</span>
                                </div>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>USD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.totalExpenses.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>

                        <div className={`${styles.summaryCard} ${styles.profit}`}>
                            <div className={styles.cardHeader}>
                                <i className="fas fa-chart-line" aria-hidden="true"></i>
                                <h3>Net Profit (Month)</h3>
                            </div>
                            <div className={styles.cardContent}>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>IQD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.netProfit.IQD)}</span>
                                </div>
                                <div className={styles.amountRow}>
                                    <span className={styles.currency}>USD</span>
                                    <span className={styles.amount}>{formatCurrency(statistics.summary.netProfit.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* Trend chart */}
                    <div className={`${styles.chartsSection} ${styles.chartsSectionSingle}`}>
                        <div className={`${styles.chartCard} ${styles.chartCardFull}`}>
                            {/* Period Selector for Monthly View */}
                            {effectiveViewMode === VIEW_MODES.MONTHLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt" aria-hidden="true"></i>
                                        <span>12-Month Period:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="period-start-month">From</label>
                                            <select
                                                id="period-start-month"
                                                value={periodStartMonth}
                                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPeriodStartMonth(parseInt(e.target.value, 10))}
                                                className={styles.formSelect}
                                            >
                                                {monthNames.map((name, index) => (
                                                    <option key={index + 1} value={index + 1}>{name}</option>
                                                ))}
                                            </select>
                                            <YearInput
                                                value={periodStartYear}
                                                min={MIN_YEAR}
                                                max={MAX_YEAR}
                                                onCommit={setPeriodStartYear}
                                                ariaLabel="Start year"
                                                className={styles.formInput}
                                            />
                                        </div>
                                        <div className={styles.periodSelectorArrow}>
                                            <i className="fas fa-arrow-right" aria-hidden="true"></i>
                                        </div>
                                        <div className={styles.periodSelectorField}>
                                            <span>To</span>
                                            <span className={styles.periodEndDisplay}>
                                                {monthNames[getPeriodEnd().endMonth - 1]} {getPeriodEnd().endYear}
                                            </span>
                                        </div>
                                    </div>
                                    {loadingYearly && (
                                        <div className={styles.periodSelectorLoading}>
                                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading...
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Year Range Selector for Yearly View */}
                            {effectiveViewMode === VIEW_MODES.YEARLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt" aria-hidden="true"></i>
                                        <span>Year Range:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="year-range-start">From</label>
                                            <YearInput
                                                id="year-range-start"
                                                value={yearRangeStart}
                                                min={MIN_YEAR}
                                                max={yearRangeEnd}
                                                onCommit={setYearRangeStart}
                                                className={styles.formInput}
                                            />
                                        </div>
                                        <div className={styles.periodSelectorArrow}>
                                            <i className="fas fa-arrow-right" aria-hidden="true"></i>
                                        </div>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="year-range-end">To</label>
                                            <YearInput
                                                id="year-range-end"
                                                value={yearRangeEnd}
                                                min={yearRangeStart}
                                                max={MAX_YEAR}
                                                onCommit={setYearRangeEnd}
                                                className={styles.formInput}
                                            />
                                        </div>
                                    </div>
                                    {loadingMultiYear && (
                                        <div className={styles.periodSelectorLoading}>
                                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading...
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className={`${styles.chartContainer} ${styles.chartContainerLarge}`}>
                                <canvas ref={revenueTrendChartRef}></canvas>
                            </div>
                        </div>
                    </div>

                    {/* Daily Data Table */}
                    <div className={styles.tableSection}>
                        <h3>Daily Breakdown</h3>
                        <p className={styles.tableNote}>
                            <i className="fas fa-info-circle" aria-hidden="true"></i>
                            Per-day rows show daily expenses only. Monthly expenses (rent, utilities, subscriptions) are counted in the MONTH TOTAL, not on any single day.
                        </p>
                        {statistics.exchangeRate != null ? (
                            <p className={styles.tableNote}>
                                <i className="fas fa-exchange-alt" aria-hidden="true"></i>
                                Each day converts at its own recorded rate; days with none use 1 USD = {statistics.exchangeRate.toLocaleString('en-US')} IQD.
                            </p>
                        ) : (
                            <p className={styles.tableNote}>
                                <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                                No exchange rate has been recorded yet, so IQD and USD can&apos;t be combined — the Grand Total columns show &quot;—&quot;. Every IQD and USD figure below is exact. Add a rate in Settings → Exchange Rates.
                            </p>
                        )}
                        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a region that scrolls sideways must be focusable, or a keyboard user cannot reach its right-hand columns */}
                        <div className={styles.tableWrapper} role="region" aria-label="Daily breakdown" tabIndex={0}>
                            <table className={styles.dataTable}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>IQD Revenue</th>
                                        <th>IQD Expenses</th>
                                        <th>IQD Net</th>
                                        <th>USD Revenue</th>
                                        <th>USD Expenses</th>
                                        <th>USD Net</th>
                                        <th>Grand Total (USD)</th>
                                        <th className={styles.expectedCashColumn}>Expected Cash IQD</th>
                                        <th className={styles.expectedCashColumn}>Expected Cash USD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {statistics.dailyData.map((day, index) => (
                                        <tr
                                            key={index}
                                            className={styles.clickableRow}
                                            onClick={() => openDayModal(day)}
                                            title="Click to view daily invoices"
                                        >
                                            {/* The row's click is a mouse shortcut; this button is the
                                                keyboard and screen-reader way in. A bare <tr onClick>
                                                has no tab stop and no key handler (FE-F25-6). */}
                                            <td data-label="Date">
                                                <button
                                                    type="button"
                                                    className={styles.dayButton}
                                                    onClick={(e) => { e.stopPropagation(); openDayModal(day); }}
                                                    aria-label={`View invoices for ${formatDate(day.Day)}`}
                                                >
                                                    {formatDate(day.Day)}
                                                </button>
                                            </td>
                                            <td data-label="IQD Revenue" className={styles.amountCell}>{formatCurrency(day.SumIQD)}</td>
                                            <td data-label="IQD Expenses" className={`${styles.amountCell} ${styles.negative}`}>{formatCurrency(Math.abs(day.ExpensesIQD || 0))}</td>
                                            <td data-label="IQD Net" className={styles.amountCell}>{formatCurrency(day.FinalIQDSum)}</td>
                                            <td data-label="USD Revenue" className={styles.amountCell}>{formatCurrency(day.SumUSD, 'USD')}</td>
                                            <td data-label="USD Expenses" className={`${styles.amountCell} ${styles.negative}`}>{formatCurrency(Math.abs(day.ExpensesUSD || 0), 'USD')}</td>
                                            <td data-label="USD Net" className={styles.amountCell}>{formatCurrency(day.FinalUSDSum, 'USD')}</td>
                                            <td data-label="Grand Total" className={`${styles.amountCell} ${styles.grandTotal}`}>{formatConverted(day.GrandTotal)}</td>
                                            <td data-label="Expected Cash IQD" className={`${styles.amountCell} ${styles.expectedCashColumn} ${styles.expectedCashIqd}`}>{formatCurrency(day.ExpectedCashIQD)}</td>
                                            <td data-label="Expected Cash USD" className={`${styles.amountCell} ${styles.expectedCashColumn} ${styles.expectedCashUsd}`}>{formatCurrency(day.ExpectedCashUSD, 'USD')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {canViewReports && (
                                <tfoot>
                                    <tr className={styles.totalRow}>
                                        <td data-label="Period"><strong>MONTH TOTAL</strong></td>
                                        <td data-label="IQD Revenue" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.totalRevenue.IQD)}</strong></td>
                                        <td data-label="IQD Expenses" className={`${styles.amountCell} ${styles.negative}`}><strong>{formatCurrency(statistics.summary.totalExpenses.IQD)}</strong></td>
                                        <td data-label="IQD Net" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.netProfit.IQD)}</strong></td>
                                        <td data-label="USD Revenue" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.totalRevenue.USD, 'USD')}</strong></td>
                                        <td data-label="USD Expenses" className={`${styles.amountCell} ${styles.negative}`}><strong>{formatCurrency(statistics.summary.totalExpenses.USD, 'USD')}</strong></td>
                                        <td data-label="USD Net" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.netProfit.USD, 'USD')}</strong></td>
                                        <td data-label="Grand Total" className={`${styles.amountCell} ${styles.grandTotal}`}><strong>{formatConverted(statistics.summary.grandTotal.USD)}</strong></td>
                                        <td data-label="Cash Box Note" className={`${styles.amountCell} ${styles.expectedCashColumn}`} colSpan={2}><em>(Daily Expenses Only)</em></td>
                                    </tr>
                                </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                </>
                ) : null}
                </>
                )}
            </div>

            {/* Daily Invoices Modal */}
            {selectedDate && (
                <DailyInvoicesModal
                    selectedDate={selectedDate}
                    onClose={closeDayModal}
                />
            )}
        </>
    );
};

export default StatisticsComponent;
