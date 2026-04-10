/**
 * SalesTrendChart Component
 * Chart.js line chart showing Revenue and Profit trends over time.
 * Follows the same useRef + useEffect pattern as StatisticsComponent.
 */
import React, { useRef, useEffect } from 'react';
import Chart from 'chart.js/auto';
import type { SalesSummaryRow } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';

interface SalesTrendChartProps {
  data: SalesSummaryRow[];
}

/**
 * Format an ISO date string as DD/MM.
 */
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const SalesTrendChart: React.FC<SalesTrendChartProps> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Destroy previous chart instance
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const labels = data.map((row) => formatShortDate(row.SaleDate));
    const revenueData = data.map((row) => row.Revenue);
    const profitData = data.map((row) => row.Profit);

    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Revenue (IQD)',
            data: revenueData,
            borderColor: 'rgb(37, 99, 235)',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            tension: 0.3,
            fill: true,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: 'rgb(37, 99, 235)',
            pointHoverRadius: 6,
          },
          {
            label: 'Profit (IQD)',
            data: profitData,
            borderColor: 'rgb(5, 150, 105)',
            backgroundColor: 'rgba(5, 150, 105, 0.1)',
            tension: 0.3,
            fill: true,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: 'rgb(5, 150, 105)',
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 16,
            },
          },
          title: {
            display: true,
            text: 'Sales Trend',
            font: { size: 16, weight: 'bold' },
            padding: { top: 10, bottom: 20 },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${formatNumber(context.parsed.y)} IQD`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => formatNumber(value as number),
            },
            grid: { color: 'rgba(0, 0, 0, 0.05)' },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [data]);

  if (data.length === 0) {
    return null;
  }

  return (
    <div style={{ position: 'relative', height: '350px', width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
};

export default React.memo(SalesTrendChart);
