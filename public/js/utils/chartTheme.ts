/**
 * Theme-aware Chart.js colours.
 *
 * Chart.js paints to a <canvas>, so it can't consume `var(--token)` — the CSS
 * custom properties must be resolved to concrete colours first. Call this
 * inside the chart-building effect and add the active `resolvedTheme` to that
 * effect's dependency array so the chart is destroyed + rebuilt (with fresh
 * colours) whenever the theme flips between light and dark.
 */
export interface ChartThemeColors {
  /** Axis grid line colour (maps to --border). */
  grid: string;
  /** Axis tick label colour (maps to --text-secondary). */
  ticks: string;
  /** Legend label colour (maps to --text-secondary). */
  legend: string;
}

export function getChartThemeColors(): ChartThemeColors {
  const root = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    root.getPropertyValue(name).trim() || fallback;

  const grid = read('--border', '#dee2e6');
  const text = read('--text-secondary', '#6c757d');

  return { grid, ticks: text, legend: text };
}
