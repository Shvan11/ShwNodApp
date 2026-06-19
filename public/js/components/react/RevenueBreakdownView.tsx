import { useState, useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Chart from '../../utils/chartSetup';
import { getChartThemeColors } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';
import { revenueBreakdownQuery } from '@/query/queries';
import { httpErrorMessage } from '@/core/http';
import { formatNumber } from '../../utils/formatters';
import type { RevenueRow } from '@shared/contracts/reports.contract';
import styles from './RevenueBreakdownView.module.css';

// Current calendar month [first, last day] as local-wall-clock YYYY-MM-DD strings.
const pad2 = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthStart = (): string => {
    const now = new Date();
    return ymd(new Date(now.getFullYear(), now.getMonth(), 1));
};
const monthEnd = (): string => {
    const now = new Date();
    return ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};

// Cap the bar chart to the top earners (the table still lists everyone).
const TOP_N = 15;

interface BreakdownSectionProps {
    title: string;
    icon: string;
    nameLabel: string;
    rows: RevenueRow[];
    resolvedTheme: string;
}

/**
 * One breakdown dimension (work type or doctor): a horizontal bar chart of USD-equivalent
 * revenue (top earners first) above a full table with IQD/USD columns, the emphasized
 * USD-equivalent ranking column, and a totals footer. Owns its own Chart.js instance.
 */
const BreakdownSection = ({ title, icon, nameLabel, rows, resolvedTheme }: BreakdownSectionProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    const totals = rows.reduce(
        (acc, r) => ({
            iqd: acc.iqd + r.paid_iqd,
            usd: acc.usd + r.paid_usd,
            usdEq: acc.usdEq + r.usd_equivalent,
            works: acc.works + r.work_count,
        }),
        { iqd: 0, usd: 0, usdEq: 0, works: 0 }
    );

    useEffect(() => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        if (chartRef.current) chartRef.current.destroy();
        if (rows.length === 0) return;

        const top = rows.slice(0, TOP_N);
        const chartColors = getChartThemeColors();
        // Chart.js renders to canvas — resolve the CSS var to a usable color first.
        const accent = getComputedStyle(document.documentElement)
            .getPropertyValue('--primary-color').trim() || '#3b82f6';

        chartRef.current = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top.map((r) => r.name),
                datasets: [{
                    label: 'USD-equivalent',
                    data: top.map((r) => r.usd_equivalent),
                    backgroundColor: `${accent}cc`,
                    borderColor: accent,
                    borderWidth: 1,
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: 'y', // horizontal bars — labels can be long names
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (context) => `$${formatNumber(context.parsed.x)}` },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            color: chartColors.ticks,
                            callback: (value) => '$' + formatNumber(value as number),
                        },
                        grid: { color: chartColors.grid },
                    },
                    y: {
                        ticks: { color: chartColors.ticks },
                        grid: { display: false },
                    },
                },
            },
        });

        return () => {
            if (chartRef.current) chartRef.current.destroy();
        };
    }, [rows, resolvedTheme]);

    const barCount = Math.min(rows.length, TOP_N);
    const chartHeight = Math.max(180, barCount * 38 + 50);

    return (
        <section className={styles.section}>
            <div className={styles.sectionHeader}>
                <h3>
                    <i className={`fas ${icon}`} aria-hidden="true"></i> {title}
                </h3>
                <span className={styles.sectionTotal}>
                    ${formatNumber(totals.usdEq)} <small>USD-equiv</small>
                </span>
            </div>

            {rows.length === 0 ? (
                <p className={styles.message}>No revenue collected in this period.</p>
            ) : (
                <>
                    <div className={styles.chartWrapper} style={{ height: `${chartHeight}px` }}>
                        <canvas ref={canvasRef}></canvas>
                    </div>
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{nameLabel}</th>
                                    <th className={styles.num}>Collected IQD</th>
                                    <th className={styles.num}>Collected USD</th>
                                    <th className={styles.num}>USD-equiv</th>
                                    <th className={styles.num}>Works</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id}>
                                        <td data-label={nameLabel} className={styles.name}>{r.name}</td>
                                        <td data-label="Collected IQD" className={styles.num}>{formatNumber(r.paid_iqd)}</td>
                                        <td data-label="Collected USD" className={styles.num}>{formatNumber(r.paid_usd)}</td>
                                        <td data-label="USD-equiv" className={`${styles.num} ${styles.usdEq}`}>{formatNumber(r.usd_equivalent)}</td>
                                        <td data-label="Works" className={styles.num}>{r.work_count}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className={styles.totalRow}>
                                    <td data-label="Total"><strong>TOTAL</strong></td>
                                    <td className={styles.num}><strong>{formatNumber(totals.iqd)}</strong></td>
                                    <td className={styles.num}><strong>{formatNumber(totals.usd)}</strong></td>
                                    <td className={`${styles.num} ${styles.usdEq}`}><strong>{formatNumber(totals.usdEq)}</strong></td>
                                    <td className={styles.num}><strong>{formatNumber(totals.works)}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
};

/**
 * Statistics → Breakdown tab. For a From/To period (default: the current month), shows
 * which work types and which doctors brought in the most money. IQD and USD are collected
 * separately but ranked by a USD-equivalent total using the most recent real exchange rate
 * (echoed from the server, not the hardcoded statistics fallback). Self-contained: owns its
 * date-range state + query.
 */
const RevenueBreakdownView = () => {
    const { resolvedTheme } = useTheme();
    const [startDate, setStartDate] = useState(monthStart);
    const [endDate, setEndDate] = useState(monthEnd);

    const invalidRange = !!startDate && !!endDate && startDate > endDate;

    const { data, isFetching, isError, error } = useQuery({
        ...revenueBreakdownQuery(startDate, endDate),
        enabled: !invalidRange,
        placeholderData: keepPreviousData,
    });

    const byWorkType = data?.byWorkType ?? [];
    const byDoctor = data?.byDoctor ?? [];
    const exchangeRate = data?.exchangeRate ?? 0;

    return (
        <div className={styles.container}>
            <div className={styles.periodBar}>
                <div className={styles.periodField}>
                    <label htmlFor="breakdown-start">From</label>
                    <input
                        id="breakdown-start"
                        type="date"
                        value={startDate}
                        max={endDate || undefined}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <i className={`fas fa-arrow-right ${styles.arrow}`} aria-hidden="true"></i>
                <div className={styles.periodField}>
                    <label htmlFor="breakdown-end">To</label>
                    <input
                        id="breakdown-end"
                        type="date"
                        value={endDate}
                        min={startDate || undefined}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                {isFetching && !invalidRange && (
                    <i className={`fas fa-spinner fa-spin ${styles.spinner}`} aria-hidden="true"></i>
                )}
            </div>

            {exchangeRate > 0 && (
                <p className={styles.rateNote}>
                    <i className="fas fa-circle-info" aria-hidden="true"></i>{' '}
                    Ranked by USD-equivalent · 1 USD = {formatNumber(exchangeRate)} IQD (most recent rate)
                </p>
            )}

            {invalidRange ? (
                <p className={styles.message}>The start date must be on or before the end date.</p>
            ) : isError ? (
                <p className={styles.messageError}>
                    <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>{' '}
                    {httpErrorMessage(error, 'Failed to load revenue breakdown')}
                </p>
            ) : (
                <>
                    <BreakdownSection
                        title="Revenue by Work Type"
                        icon="fa-briefcase"
                        nameLabel="Work Type"
                        rows={byWorkType}
                        resolvedTheme={resolvedTheme}
                    />
                    <BreakdownSection
                        title="Revenue by Doctor"
                        icon="fa-user-md"
                        nameLabel="Doctor"
                        rows={byDoctor}
                        resolvedTheme={resolvedTheme}
                    />
                </>
            )}
        </div>
    );
};

export default RevenueBreakdownView;
