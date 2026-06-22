import React, { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Chart from '../../utils/chartSetup';
import DailyInvoicesModal from './DailyInvoicesModal';
import DoctorCommissionsView from './DoctorCommissionsView';
import RevenueBreakdownView from './RevenueBreakdownView';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters';
import { getChartThemeColors } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import { httpErrorMessage } from '@/core/http';
import {
    statisticsQuery,
    yearlyStatisticsQuery,
    multiYearStatisticsQuery,
} from '@/query/queries';
import styles from './StatisticsComponent.module.css';

// Types
interface DailyData {
    Day: string;
    GrandTotal?: number;
    SumIQD?: number;
    SumUSD?: number;
    ExpensesIQD?: number;
    ExpensesUSD?: number;
    FinalIQDSum?: number;
    FinalUSDSum?: number;
    QasaIQD?: number;
    QasaUSD?: number;
}

interface CurrencyTotals {
    IQD: number;
    USD: number;
}

interface SummaryData {
    totalRevenue: CurrencyTotals;
    totalExpenses: CurrencyTotals;
    netProfit: CurrencyTotals;
    grandTotal: CurrencyTotals;
}

interface StatisticsData {
    success: boolean;
    error?: string;
    dailyData: DailyData[];
    summary: SummaryData;
}

interface MonthlyDataItem {
    Month: number;
    Year: number;
    GrandTotal?: number;
}

interface YearlyDataItem {
    Year: number;
    GrandTotal?: number;
}

interface YearlyData {
    success: boolean;
    error?: string;
    monthlyData: MonthlyDataItem[];
}

interface MultiYearData {
    success: boolean;
    error?: string;
    yearlyData: YearlyDataItem[];
}

interface ChartDataItem {
    label: string;
    grandTotal: number;
}

// View mode constants
const VIEW_MODES = { DAILY: 'daily', MONTHLY: 'monthly', YEARLY: 'yearly', COMMISSIONS: 'commissions', BREAKDOWN: 'breakdown' } as const;
type ViewMode = typeof VIEW_MODES[keyof typeof VIEW_MODES];

// Self-contained tabs that own their own date-range picker + query and so hide the
// month-nav, summary cards, and daily table the time-based views share.
const isCustomView = (mode: ViewMode): boolean =>
    mode === VIEW_MODES.COMMISSIONS || mode === VIEW_MODES.BREAKDOWN;

// Tabs that expose per-doctor earnings / revenue breakdowns — admin-only.
const isAdminOnlyView = (mode: ViewMode): boolean =>
    mode === VIEW_MODES.COMMISSIONS || mode === VIEW_MODES.BREAKDOWN;

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
    const { user } = useGlobalState();
    const isAdmin = user?.role === 'admin';
    const [searchParams, setSearchParams] = useSearchParams();
    const [month, setMonth] = useState(parseInt(searchParams.get('month') || '') || new Date().getMonth() + 1);
    const [year, setYear] = useState(parseInt(searchParams.get('year') || '') || new Date().getFullYear());
    // For Monthly view: separate start month/year for 12-month period
    const [periodStartMonth, setPeriodStartMonth] = useState(1);
    const [periodStartYear, setPeriodStartYear] = useState(new Date().getFullYear());
    // For Yearly view: year range
    const [yearRangeStart, setYearRangeStart] = useState(new Date().getFullYear() - 4);
    const [yearRangeEnd, setYearRangeEnd] = useState(new Date().getFullYear());
    const [exchangeRate] = useState(1450);
    const [viewMode, setViewMode] = useState<ViewMode>((searchParams.get('view') as ViewMode) || VIEW_MODES.DAILY);

    // Non-admins can't reach the admin-only tabs — if one is selected via a deep link
    // (?view=breakdown / ?view=commissions), coerce it to Daily for rendering. Derived
    // (not a setState-in-effect) so it's recomputed every render: an admin whose identity
    // resolves a beat after first paint snaps straight to their tab with no bounce.
    const effectiveViewMode: ViewMode =
        !isAdmin && isAdminOnlyView(viewMode) ? VIEW_MODES.DAILY : viewMode;

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
        ...statisticsQuery(month, year, exchangeRate),
        placeholderData: keepPreviousData,
        // The custom tabs (Commissions / Breakdown) own their own queries and never
        // read the monthly stats — don't fetch them while one of those tabs is open.
        enabled: !isCustomView(effectiveViewMode),
    });
    const statistics = (statisticsData ?? null) as StatisticsData | null;
    const error = isError ? httpErrorMessage(statsError, 'Failed to fetch statistics') : null;

    // 12-month rollup — only fetched in Monthly view (cleared between fetches, so no
    // keepPreviousData here).
    const { data: yearlyDataRaw, isFetching: loadingYearly } = useQuery({
        ...yearlyStatisticsQuery(periodStartMonth, periodStartYear, exchangeRate),
        enabled: effectiveViewMode === VIEW_MODES.MONTHLY,
    });
    const yearlyData = (yearlyDataRaw ?? null) as YearlyData | null;

    // Multi-year rollup — only fetched in Yearly view.
    const { data: multiYearDataRaw, isFetching: loadingMultiYear } = useQuery({
        ...multiYearStatisticsQuery(yearRangeStart, yearRangeEnd, exchangeRate),
        enabled: effectiveViewMode === VIEW_MODES.YEARLY,
    });
    const multiYearData = (multiYearDataRaw ?? null) as MultiYearData | null;

    // Modal open-state lives in the URL (?day=YYYY-MM-DD) so browser back/forward
    // and deep links re-open it; the full row is looked up from the loaded month.
    const selectedDay = searchParams.get('day');
    const selectedDate = selectedDay
        ? statistics?.dailyData.find(d => d.Day === selectedDay) ?? null
        : null;

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

    // Helper: Aggregate for monthly view (show all months of the year)
    const aggregateByMonth = (dailyData: DailyData[]): ChartDataItem[] => {
        const months: Record<number, { grandTotal: number; month: number }> = {};
        dailyData.forEach(day => {
            const date = new Date(day.Day);
            const monthKey = date.getMonth();
            if (!months[monthKey]) {
                months[monthKey] = { grandTotal: 0, month: monthKey };
            }
            months[monthKey].grandTotal += day.GrandTotal || 0;
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
                    label: `${new Date(day.Day).getDate()}/${new Date(day.Day).getMonth() + 1}`,
                    grandTotal: day.GrandTotal || 0
                }));
                chartTitle = 'Daily Grand Total (USD)';
                break;
            case VIEW_MODES.MONTHLY:
                // Use yearlyData if available (fetched from dedicated API)
                if (yearlyData && yearlyData.monthlyData && yearlyData.monthlyData.length > 0) {
                    const { endMonth, endYear } = getPeriodEnd();
                    chartData = yearlyData.monthlyData.map(m => ({
                        label: `${monthNames[m.Month - 1].substring(0, 3)} ${m.Year}`,
                        grandTotal: m.GrandTotal || 0
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
                        grandTotal: y.GrandTotal || 0
                    }));
                    chartTitle = `Yearly Revenue: ${yearRangeStart} - ${yearRangeEnd}`;
                } else {
                    // Fallback to single data point from current month's data
                    const yearlyTotal = statistics.dailyData.reduce((sum, day) => sum + (day.GrandTotal || 0), 0);
                    chartData = [{ label: `${monthNames[month-1]} ${year}`, grandTotal: yearlyTotal }];
                    chartTitle = `Yearly Total (USD) - ${year}`;
                }
                break;
            default:
                chartData = statistics.dailyData.map(day => ({
                    label: `${new Date(day.Day).getDate()}/${new Date(day.Day).getMonth() + 1}`,
                    grandTotal: day.GrandTotal || 0
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
    }, [statistics, exchangeRate, effectiveViewMode, month, year, yearlyData, loadingYearly, multiYearData, loadingMultiYear, yearRangeStart, yearRangeEnd, resolvedTheme]);

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
    const formatCurrency = (amount: number | undefined, currency: string = 'IQD'): string => {
        return formatCurrencyUtil(amount || 0, currency);
    };

    // Format date
    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    };

    // Handle print
    const handlePrint = () => {
        window.print();
    };

    return (
        <>
            <div className={styles.statisticsContainer}>
                {/* Header: page title + a persistent, page-level tab bar. Living above
                    every conditional element (month nav, cards, table), the tabs keep
                    the same position in every view — switching tabs never moves them. */}
                <div className={styles.pageHeader}>
                    <div className={styles.pageTitle}>
                        <h1>
                            <i className="fas fa-chart-bar"></i>
                            Financial Statistics
                        </h1>
                    </div>
                    <div className={styles.viewTabs} role="tablist" aria-label="Statistics views">
                        {Object.values(VIEW_MODES)
                            .filter((value) => isAdmin || !isAdminOnlyView(value))
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
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className={styles.dateDisplay}>
                        <select
                            value={month}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setMonth(parseInt(e.target.value))}
                            className={styles.formSelect}
                        >
                            {monthNames.map((name, index) => (
                                <option key={index + 1} value={index + 1}>{name}</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            value={year}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setYear(parseInt(e.target.value))}
                            min="2000"
                            max="2100"
                            className={styles.formInput}
                        />
                    </div>
                    <button onClick={handleNextMonth} className={styles.btnNav} title="Next Month">
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div className={styles.actions}>
                    <button onClick={() => refetchStatistics()} className={styles.btnAction} disabled={loading}>
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i> Refresh
                    </button>
                    <button onClick={handlePrint} className={styles.btnAction}>
                        <i className="fas fa-print"></i> Print
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
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>{error}</p>
                    <button className={styles.btnRetry} onClick={() => refetchStatistics()}>Try Again</button>
                </div>
            ) : statistics ? (
                <>
                    {/* Summary Cards — month-scoped totals */}
                    <div className={styles.summaryCards}>
                        <div className={`${styles.summaryCard} ${styles.revenue}`}>
                            <div className={styles.cardHeader}>
                                <i className="fas fa-money-bill-wave"></i>
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
                                <i className="fas fa-receipt"></i>
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
                                <i className="fas fa-chart-line"></i>
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

                    {/* Trend chart */}
                    <div className={`${styles.chartsSection} ${styles.chartsSectionSingle}`}>
                        <div className={`${styles.chartCard} ${styles.chartCardFull}`}>
                            {/* Period Selector for Monthly View */}
                            {effectiveViewMode === VIEW_MODES.MONTHLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt"></i>
                                        <span>12-Month Period:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="period-start-month">From</label>
                                            <select
                                                id="period-start-month"
                                                value={periodStartMonth}
                                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPeriodStartMonth(parseInt(e.target.value))}
                                                className={styles.formSelect}
                                            >
                                                {monthNames.map((name, index) => (
                                                    <option key={index + 1} value={index + 1}>{name}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                value={periodStartYear}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setPeriodStartYear(parseInt(e.target.value))}
                                                min="2000"
                                                max="2100"
                                                className={styles.formInput}
                                            />
                                        </div>
                                        <div className={styles.periodSelectorArrow}>
                                            <i className="fas fa-arrow-right"></i>
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
                                            <i className="fas fa-spinner fa-spin"></i> Loading...
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Year Range Selector for Yearly View */}
                            {effectiveViewMode === VIEW_MODES.YEARLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt"></i>
                                        <span>Year Range:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="year-range-start">From</label>
                                            <input
                                                id="year-range-start"
                                                type="number"
                                                value={yearRangeStart}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                                    const newStart = parseInt(e.target.value);
                                                    if (newStart <= yearRangeEnd && newStart >= 2000) {
                                                        setYearRangeStart(newStart);
                                                    }
                                                }}
                                                min="2000"
                                                max={yearRangeEnd}
                                                className={styles.formInput}
                                            />
                                        </div>
                                        <div className={styles.periodSelectorArrow}>
                                            <i className="fas fa-arrow-right"></i>
                                        </div>
                                        <div className={styles.periodSelectorField}>
                                            <label htmlFor="year-range-end">To</label>
                                            <input
                                                id="year-range-end"
                                                type="number"
                                                value={yearRangeEnd}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                                    const newEnd = parseInt(e.target.value);
                                                    if (newEnd >= yearRangeStart && newEnd <= 2100) {
                                                        setYearRangeEnd(newEnd);
                                                    }
                                                }}
                                                min={yearRangeStart}
                                                max="2100"
                                                className={styles.formInput}
                                            />
                                        </div>
                                    </div>
                                    {loadingMultiYear && (
                                        <div className={styles.periodSelectorLoading}>
                                            <i className="fas fa-spinner fa-spin"></i> Loading...
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
                        <div className={styles.tableWrapper}>
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
                                        <th className={styles.qasaColumn}>Qasa IQD</th>
                                        <th className={styles.qasaColumn}>Qasa USD</th>
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
                                            <td data-label="Date">{formatDate(day.Day)}</td>
                                            <td data-label="IQD Revenue" className={styles.amountCell}>{formatCurrency(day.SumIQD)}</td>
                                            <td data-label="IQD Expenses" className={`${styles.amountCell} ${styles.negative}`}>{formatCurrency(Math.abs(day.ExpensesIQD || 0))}</td>
                                            <td data-label="IQD Net" className={styles.amountCell}>{formatCurrency(day.FinalIQDSum)}</td>
                                            <td data-label="USD Revenue" className={styles.amountCell}>{formatCurrency(day.SumUSD, 'USD')}</td>
                                            <td data-label="USD Expenses" className={`${styles.amountCell} ${styles.negative}`}>{formatCurrency(Math.abs(day.ExpensesUSD || 0), 'USD')}</td>
                                            <td data-label="USD Net" className={styles.amountCell}>{formatCurrency(day.FinalUSDSum, 'USD')}</td>
                                            <td data-label="Grand Total" className={`${styles.amountCell} ${styles.grandTotal}`}>{formatCurrency(day.GrandTotal, 'USD')}</td>
                                            <td data-label="Qasa IQD" className={`${styles.amountCell} ${styles.qasaColumn} ${styles.qasaIqd}`}>{formatCurrency(day.QasaIQD)}</td>
                                            <td data-label="Qasa USD" className={`${styles.amountCell} ${styles.qasaColumn} ${styles.qasaUsd}`}>{formatCurrency(day.QasaUSD, 'USD')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className={styles.totalRow}>
                                        <td data-label="Period"><strong>MONTH TOTAL</strong></td>
                                        <td data-label="IQD Revenue" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.totalRevenue.IQD)}</strong></td>
                                        <td data-label="IQD Expenses" className={`${styles.amountCell} ${styles.negative}`}><strong>{formatCurrency(statistics.summary.totalExpenses.IQD)}</strong></td>
                                        <td data-label="IQD Net" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.netProfit.IQD)}</strong></td>
                                        <td data-label="USD Revenue" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.totalRevenue.USD, 'USD')}</strong></td>
                                        <td data-label="USD Expenses" className={`${styles.amountCell} ${styles.negative}`}><strong>{formatCurrency(statistics.summary.totalExpenses.USD, 'USD')}</strong></td>
                                        <td data-label="USD Net" className={styles.amountCell}><strong>{formatCurrency(statistics.summary.netProfit.USD, 'USD')}</strong></td>
                                        <td data-label="Grand Total" className={`${styles.amountCell} ${styles.grandTotal}`}><strong>{formatCurrency(statistics.summary.grandTotal.USD, 'USD')}</strong></td>
                                        <td data-label="Cash Box Note" className={`${styles.amountCell} ${styles.qasaColumn}`} colSpan={2}><em>(Daily Values Only)</em></td>
                                    </tr>
                                </tfoot>
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
