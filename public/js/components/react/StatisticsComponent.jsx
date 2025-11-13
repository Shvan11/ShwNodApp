import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Chart from 'chart.js/auto';
import UniversalHeader from './UniversalHeader.jsx';
import DailyInvoicesModal from './DailyInvoicesModal.jsx';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters.js';

const StatisticsComponent = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [statistics, setStatistics] = useState(null);
    const [month, setMonth] = useState(parseInt(searchParams.get('month')) || new Date().getMonth() + 1);
    const [year, setYear] = useState(parseInt(searchParams.get('year')) || new Date().getFullYear());
    const [exchangeRate, setExchangeRate] = useState(1450);
    const [selectedDate, setSelectedDate] = useState(null);

    // Chart references
    const revenueTrendChartRef = React.useRef(null);
    const revenueDistributionChartRef = React.useRef(null);
    const revenueTrendChartInstance = React.useRef(null);
    const revenueDistributionChartInstance = React.useRef(null);

    // Month names
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Fetch statistics data
    const fetchStatistics = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/statistics?month=${month}&year=${year}&exchangeRate=${exchangeRate}`);
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch statistics');
            }

            setStatistics(data);
            setSearchParams({ month: month.toString(), year: year.toString() });
        } catch (err) {
            setError(err.message);
            console.error('Error fetching statistics:', err);
        } finally {
            setLoading(false);
        }
    }, [month, year, exchangeRate, setSearchParams]);

    // Load data on mount and when month/year changes
    useEffect(() => {
        fetchStatistics();
    }, [fetchStatistics]);

    // Create/update charts
    useEffect(() => {
        if (!statistics || !statistics.dailyData) return;

        // Revenue Trend Chart
        if (revenueTrendChartRef.current) {
            const ctx = revenueTrendChartRef.current.getContext('2d');

            // Destroy previous chart
            if (revenueTrendChartInstance.current) {
                revenueTrendChartInstance.current.destroy();
            }

            const labels = statistics.dailyData.map(day => {
                const date = new Date(day.Day);
                return `${date.getDate()}/${date.getMonth() + 1}`;
            });

            const iqdData = statistics.dailyData.map(day => day.FinalIQDSum || 0);
            const usdData = statistics.dailyData.map(day => (day.FinalUSDSum || 0) * exchangeRate);

            revenueTrendChartInstance.current = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'IQD Revenue',
                            data: iqdData,
                            borderColor: 'rgb(75, 192, 192)',
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            tension: 0.1
                        },
                        {
                            label: 'USD Revenue (in IQD)',
                            data: usdData,
                            borderColor: 'rgb(54, 162, 235)',
                            backgroundColor: 'rgba(54, 162, 235, 0.2)',
                            tension: 0.1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        title: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return formatNumber(value) + ' IQD';
                                }
                            }
                        }
                    }
                }
            });
        }

        // Revenue Distribution Chart
        if (revenueDistributionChartRef.current) {
            const ctx = revenueDistributionChartRef.current.getContext('2d');

            // Destroy previous chart
            if (revenueDistributionChartInstance.current) {
                revenueDistributionChartInstance.current.destroy();
            }

            revenueDistributionChartInstance.current = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['IQD Revenue', 'USD Revenue'],
                    datasets: [{
                        data: [
                            statistics.summary.totalRevenue.IQD,
                            statistics.summary.totalRevenue.USD * exchangeRate
                        ],
                        backgroundColor: [
                            'rgba(75, 192, 192, 0.8)',
                            'rgba(54, 162, 235, 0.8)'
                        ],
                        borderColor: [
                            'rgb(75, 192, 192)',
                            'rgb(54, 162, 235)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    return label + ': ' + formatNumber(value) + ' IQD';
                                }
                            }
                        }
                    }
                }
            });
        }

        // Cleanup function
        return () => {
            if (revenueTrendChartInstance.current) {
                revenueTrendChartInstance.current.destroy();
            }
            if (revenueDistributionChartInstance.current) {
                revenueDistributionChartInstance.current.destroy();
            }
        };
    }, [statistics, exchangeRate]);

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
    const formatCurrency = (amount, currency = 'IQD') => {
        return formatCurrencyUtil(amount, currency);
    };

    // Format date
    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    };

    // Handle print
    const handlePrint = () => {
        window.print();
    };

    if (loading && !statistics) {
        return (
            <div className="statistics-container">
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading statistics...</p>
                </div>
            </div>
        );
    }

    if (error && !statistics) {
        return (
            <div className="statistics-container">
                <div className="error-state">
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>{error}</p>
                    <button className="btn-retry" onClick={fetchStatistics}>Try Again</button>
                </div>
            </div>
        );
    }

    return (
        <>
            <UniversalHeader />
            <div className="statistics-container">
                {/* Page Title */}
                <div className="page-title">
                    <h1>
                        <i className="fas fa-chart-bar"></i>
                        Financial Statistics
                    </h1>
                </div>

            {/* Controls */}
            <div className="controls-section">
                <div className="date-selector">
                    <button onClick={handlePrevMonth} className="btn-nav" title="Previous Month">
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="date-display">
                        <select
                            value={month}
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            className="form-select"
                        >
                            {monthNames.map((name, index) => (
                                <option key={index + 1} value={index + 1}>{name}</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            min="2000"
                            max="2100"
                            className="form-input"
                        />
                    </div>
                    <button onClick={handleNextMonth} className="btn-nav" title="Next Month">
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div className="actions">
                    <button onClick={fetchStatistics} className="btn-action" disabled={loading}>
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i> Refresh
                    </button>
                    <button onClick={handlePrint} className="btn-action">
                        <i className="fas fa-print"></i> Print
                    </button>
                </div>
            </div>

            {statistics && (
                <>
                    {/* Summary Cards - Monthly Totals Only */}
                    <div className="summary-cards">
                        <div className="summary-card revenue">
                            <div className="card-header">
                                <i className="fas fa-money-bill-wave"></i>
                                <h3>Total Revenue (Month)</h3>
                            </div>
                            <div className="card-content">
                                <div className="amount-row">
                                    <span className="currency">IQD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.totalRevenue.IQD)}</span>
                                </div>
                                <div className="amount-row">
                                    <span className="currency">USD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.totalRevenue.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>

                        <div className="summary-card expenses">
                            <div className="card-header">
                                <i className="fas fa-receipt"></i>
                                <h3>Total Expenses (Month)</h3>
                            </div>
                            <div className="card-content">
                                <div className="amount-row">
                                    <span className="currency">IQD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.totalExpenses.IQD)}</span>
                                </div>
                                <div className="amount-row">
                                    <span className="currency">USD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.totalExpenses.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>

                        <div className="summary-card profit">
                            <div className="card-header">
                                <i className="fas fa-chart-line"></i>
                                <h3>Net Profit (Month)</h3>
                            </div>
                            <div className="card-content">
                                <div className="amount-row">
                                    <span className="currency">IQD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.netProfit.IQD)}</span>
                                </div>
                                <div className="amount-row">
                                    <span className="currency">USD</span>
                                    <span className="amount">{formatCurrency(statistics.summary.netProfit.USD, 'USD')}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="charts-section">
                        <div className="chart-card">
                            <h3>Daily Revenue Trend</h3>
                            <div className="chart-container">
                                <canvas ref={revenueTrendChartRef}></canvas>
                            </div>
                        </div>
                        <div className="chart-card">
                            <h3>Revenue Distribution</h3>
                            <div className="chart-container">
                                <canvas ref={revenueDistributionChartRef}></canvas>
                            </div>
                        </div>
                    </div>

                    {/* Daily Data Table */}
                    <div className="table-section">
                        <h3>Daily Breakdown</h3>
                        <div className="table-wrapper">
                            <table className="data-table">
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
                                        <th className="qasa-column">Qasa IQD</th>
                                        <th className="qasa-column">Qasa USD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {statistics.dailyData.map((day, index) => (
                                        <tr
                                            key={index}
                                            className="clickable-row"
                                            onClick={() => setSelectedDate(day)}
                                            title="Click to view daily invoices"
                                        >
                                            <td>{formatDate(day.Day)}</td>
                                            <td className="amount-cell">{formatCurrency(day.SumIQD)}</td>
                                            <td className="amount-cell negative">{formatCurrency(Math.abs(day.ExpensesIQD || 0))}</td>
                                            <td className="amount-cell">{formatCurrency(day.FinalIQDSum)}</td>
                                            <td className="amount-cell">{formatCurrency(day.SumUSD, 'USD')}</td>
                                            <td className="amount-cell negative">{formatCurrency(Math.abs(day.ExpensesUSD || 0), 'USD')}</td>
                                            <td className="amount-cell">{formatCurrency(day.FinalUSDSum, 'USD')}</td>
                                            <td className="amount-cell grand-total">{formatCurrency(day.GrandTotal, 'USD')}</td>
                                            <td className="amount-cell qasa-column qasa-iqd">{formatCurrency(day.QasaIQD)}</td>
                                            <td className="amount-cell qasa-column qasa-usd">{formatCurrency(day.QasaUSD, 'USD')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="total-row">
                                        <td><strong>MONTH TOTAL</strong></td>
                                        <td className="amount-cell"><strong>{formatCurrency(statistics.summary.totalRevenue.IQD)}</strong></td>
                                        <td className="amount-cell negative"><strong>{formatCurrency(statistics.summary.totalExpenses.IQD)}</strong></td>
                                        <td className="amount-cell"><strong>{formatCurrency(statistics.summary.netProfit.IQD)}</strong></td>
                                        <td className="amount-cell"><strong>{formatCurrency(statistics.summary.totalRevenue.USD, 'USD')}</strong></td>
                                        <td className="amount-cell negative"><strong>{formatCurrency(statistics.summary.totalExpenses.USD, 'USD')}</strong></td>
                                        <td className="amount-cell"><strong>{formatCurrency(statistics.summary.netProfit.USD, 'USD')}</strong></td>
                                        <td className="amount-cell grand-total"><strong>{formatCurrency(statistics.summary.grandTotal.USD, 'USD')}</strong></td>
                                        <td className="amount-cell qasa-column" colSpan="2"><em>(Daily Values Only)</em></td>
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
