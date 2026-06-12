/**
 * TopItemsChart Component
 * Chart.js horizontal bar chart showing the top-selling items by quantity.
 * Follows the same useRef + useEffect pattern as StatisticsComponent.
 */
import React, { useRef, useEffect } from 'react';
import Chart from '../../utils/chartSetup';
import type { TopItemRow } from '../../hooks/useStand';
import { formatNumber } from '../../utils/formatters';
import { getChartThemeColors } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';

interface TopItemsChartProps {
  data: TopItemRow[];
}

const TopItemsChart: React.FC<TopItemsChartProps> = ({ data }) => {
  const { resolvedTheme } = useTheme();
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

    const chartColors = getChartThemeColors();
    const labels = data.map((row) => row.item_name);
    const quantities = data.map((row) => row.TotalQuantity);

    // Generate a gradient-like colour palette for the bars
    const barColors = data.map((_, index) => {
      const hue = 210 + index * 25; // Shift hue across blue-purple range
      return `hsla(${hue % 360}, 65%, 55%, 0.85)`;
    });

    const borderColors = data.map((_, index) => {
      const hue = 210 + index * 25;
      return `hsla(${hue % 360}, 65%, 45%, 1)`;
    });

    chartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Quantity Sold',
            data: quantities,
            backgroundColor: barColors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false,
          },
          title: {
            display: true,
            text: 'Top Selling Items',
            font: { size: 16, weight: 'bold' },
            padding: { top: 10, bottom: 20 },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const row = data[context.dataIndex];
                return [
                  `Qty: ${formatNumber(row.TotalQuantity)}`,
                  `Revenue: ${formatNumber(row.TotalRevenue)} IQD`,
                  `Profit: ${formatNumber(row.total_profit)} IQD`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              color: chartColors.ticks,
              callback: (value) => formatNumber(value as number),
            },
            grid: { color: chartColors.grid },
          },
          y: {
            grid: { display: false },
            ticks: {
              color: chartColors.ticks,
              font: { size: 12 },
            },
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
  }, [data, resolvedTheme]);

  if (data.length === 0) {
    return null;
  }

  return (
    <div style={{ position: 'relative', height: `${Math.max(250, data.length * 40 + 80)}px`, width: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
};

export default React.memo(TopItemsChart);
