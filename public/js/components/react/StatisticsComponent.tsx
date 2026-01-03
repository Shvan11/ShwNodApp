import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import Chart from 'chart.js/auto';
import DailyInvoicesModal from './DailyInvoicesModal';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters';
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
const VIEW_MODES = { DAILY: 'daily', MONTHLY: 'monthly', YEARLY: 'yearly' } as const;
type ViewMode = typeof VIEW_MODES[keyof typeof VIEW_MODES];

const StatisticsComponent = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statistics, setStatistics] = useState<StatisticsData | null>(null);
    const [yearlyData, setYearlyData] = useState<YearlyData | null>(null); // For monthly view - 12 months of data
    const [loadingYearly, setLoadingYearly] = useState(false); // Loading state for yearly data
    const [multiYearData, setMultiYearData] = useState<MultiYearData | null>(null); // For yearly view - multi-year data
    const [loadingMultiYear, setLoadingMultiYear] = useState(false); // Loading state for multi-year data
    const [month, setMonth] = useState(parseInt(searchParams.get('month') || '') || new Date().getMonth() + 1);
    const [year, setYear] = useState(parseInt(searchParams.get('year') || '') || new Date().getFullYear());
    // For Monthly view: separate start month/year for 12-month period
    const [periodStartMonth, setPeriodStartMonth] = useState(1);
    const [periodStartYear, setPeriodStartYear] = useState(new Date().getFullYear());
    // For Yearly view: year range
    const [yearRangeStart, setYearRangeStart] = useState(new Date().getFullYear() - 4);
    const [yearRangeEnd, setYearRangeEnd] = useState(new Date().getFullYear());
    const [exchangeRate, setExchangeRate] = useState(1450);
    const [selectedDate, setSelectedDate] = useState<DailyData | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>((searchParams.get('view') as ViewMode) || VIEW_MODES.DAILY);

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

    // Fetch statistics data
    const fetchStatistics = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/statistics?month=${month}&year=${year}&exchangeRate=${exchangeRate}`);
            const data: StatisticsData = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch statistics');
            }

            setStatistics(data);
            setSearchParams({ month: month.toString(), year: year.toString() });
        } catch (err) {
            setError((err as Error).message);
            console.error('Error fetching statistics:', err);
        } finally {
            setLoading(false);
        }
    }, [month, year, exchangeRate, setSearchParams]);

    // Fetch yearly data for monthly view (12-month period)
    const fetchYearlyData = useCallback(async () => {
        setLoadingYearly(true);
        try {
            const response = await fetch(`/api/statistics/yearly?startMonth=${periodStartMonth}&startYear=${periodStartYear}&exchangeRate=${exchangeRate}`);
            const data: YearlyData = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch yearly statistics');
            }

            setYearlyData(data);
        } catch (err) {
            console.error('[Statistics] Error fetching yearly statistics:', err);
            setYearlyData(null);
        } finally {
            setLoadingYearly(false);
        }
    }, [periodStartMonth, periodStartYear, exchangeRate]);

    // Fetch multi-year data for yearly view
    const fetchMultiYearData = useCallback(async () => {
        setLoadingMultiYear(true);
        try {
            const response = await fetch(`/api/statistics/multi-year?startYear=${yearRangeStart}&endYear=${yearRangeEnd}&exchangeRate=${exchangeRate}`);
            const data: MultiYearData = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch multi-year statistics');
            }

            setMultiYearData(data);
        } catch (err) {
            console.error('[Statistics] Error fetching multi-year statistics:', err);
            setMultiYearData(null);
        } finally {
            setLoadingMultiYear(false);
        }
    }, [yearRangeStart, yearRangeEnd, exchangeRate]);

    // Load data on mount and when month/year changes
    useEffect(() => {
        fetchStatistics();
    }, [fetchStatistics]);

    // Fetch yearly data when in monthly view or when period changes
    useEffect(() => {
        if (viewMode === VIEW_MODES.MONTHLY) {
            setYearlyData(null); // Clear previous data before fetching new
            fetchYearlyData();
        } else {
            // Clear yearly data when switching away from monthly view
            setYearlyData(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, periodStartMonth, periodStartYear, exchangeRate]);

    // Fetch multi-year data when in yearly view or when year range changes
    useEffect(() => {
        if (viewMode === VIEW_MODES.YEARLY) {
            setMultiYearData(null); // Clear previous data before fetching new
            fetchMultiYearData();
        } else {
            // Clear multi-year data when switching away from yearly view
            setMultiYearData(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, yearRangeStart, yearRangeEnd, exchangeRate]);

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
        if (viewMode === VIEW_MODES.MONTHLY && loadingYearly) {
            return;
        }

        // Wait for multi-year data to load before rendering yearly view
        if (viewMode === VIEW_MODES.YEARLY && loadingMultiYear) {
            return;
        }

        const ctx = revenueTrendChartRef.current.getContext('2d');
        if (!ctx) return;

        // Destroy previous chart
        if (revenueTrendChartInstance.current) {
            revenueTrendChartInstance.current.destroy();
        }

        let chartData: ChartDataItem[] = [];
        let chartTitle = 'Grand Total (USD)';

        // Aggregate data based on view mode
        switch (viewMode) {
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

        revenueTrendChartInstance.current = new Chart(ctx, {
            type: viewMode === VIEW_MODES.YEARLY ? 'bar' : 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Grand Total (USD)',
                    data: grandTotals,
                    borderColor: 'rgb(34, 197, 94)',
                    backgroundColor: viewMode === VIEW_MODES.YEARLY
                        ? 'rgba(34, 197, 94, 0.8)'
                        : 'rgba(34, 197, 94, 0.1)',
                    tension: 0.3,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: viewMode === VIEW_MODES.DAILY ? 4 : 6,
                    pointBackgroundColor: 'rgb(34, 197, 94)',
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
                            callback: (value) => '$' + formatNumber(value as number)
                        },
                        grid: { color: 'rgba(0, 0, 0, 0.05)' }
                    },
                    x: {
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
    }, [statistics, exchangeRate, viewMode, month, year, yearlyData, loadingYearly, multiYearData, loadingMultiYear, yearRangeStart, yearRangeEnd]);

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

    if (loading && !statistics) {
        return (
            <div className={styles.statisticsContainer}>
                <div className={styles.loadingState}>
                    <div className={styles.spinner}></div>
                    <p>Loading statistics...</p>
                </div>
            </div>
        );
    }

    if (error && !statistics) {
        return (
            <div className={styles.statisticsContainer}>
                <div className={styles.errorState}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>{error}</p>
                    <button className={styles.btnRetry} onClick={fetchStatistics}>Try Again</button>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className={styles.statisticsContainer}>
                {/* Page Title */}
                <div className={styles.pageTitle}>
                    <h1>
                        <i className="fas fa-chart-bar"></i>
                        Financial Statistics
                    </h1>
                </div>

            {/* Controls */}
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
                    <button onClick={fetchStatistics} className={styles.btnAction} disabled={loading}>
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i> Refresh
                    </button>
                    <button onClick={handlePrint} className={styles.btnAction}>
                        <i className="fas fa-print"></i> Print
                    </button>
                </div>
            </div>

            {statistics && (
                <>
                    {/* Summary Cards - Monthly Totals Only */}
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

                    {/* Chart - Grand Total (USD) */}
                    <div className={`${styles.chartsSection} ${styles.chartsSectionSingle}`}>
                        <div className={`${styles.chartCard} ${styles.chartCardFull}`}>
                            {/* View Mode Selector - Near the chart */}
                            <div className={styles.chartControls}>
                                <div className={styles.viewModeSelector}>
                                    {Object.entries(VIEW_MODES).map(([key, value]) => (
                                        <button
                                            key={value}
                                            className={`${styles.viewModeBtn} ${viewMode === value ? styles.active : ''}`}
                                            onClick={() => setViewMode(value)}
                                        >
                                            {key.charAt(0) + key.slice(1).toLowerCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Period Selector for Monthly View */}
                            {viewMode === VIEW_MODES.MONTHLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt"></i>
                                        <span>12-Month Period:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label>From</label>
                                            <select
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
                                            <label>To</label>
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
                            {viewMode === VIEW_MODES.YEARLY && (
                                <div className={styles.periodSelector}>
                                    <div className={styles.periodSelectorLabel}>
                                        <i className="fas fa-calendar-alt"></i>
                                        <span>Year Range:</span>
                                    </div>
                                    <div className={styles.periodSelectorControls}>
                                        <div className={styles.periodSelectorField}>
                                            <label>From</label>
                                            <input
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
                                            <label>To</label>
                                            <input
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
                                            onClick={() => setSelectedDate(day)}
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
            )}
            </div>

            {/* Daily Invoices Modal */}
            {selectedDate && (
                <DailyInvoicesModal
                    selectedDate={selectedDate}
                    onClose={() => setSelectedDate(null)}
                />
            )}
        </>
    );
};

export default StatisticsComponent;
