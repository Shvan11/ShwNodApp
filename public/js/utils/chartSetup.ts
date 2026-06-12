/**
 * Shared Chart.js setup — registers ONLY the pieces the app's three charts
 * actually use (line + bar): StatisticsComponent's revenue trend (line/bar by
 * view mode), and Stand's SalesTrendChart (filled line) + TopItemsChart
 * (horizontal bar).
 *
 * Import the default `Chart` from HERE instead of `'chart.js/auto'`. `/auto`
 * registers every controller/element/scale (radar, polar, pie, doughnut,
 * scatter, bubble, ArcElement, radial/time/log scales) via `registerables`,
 * which Rollup cannot tree-shake — so the lazy `vendor-charts` chunk carries the
 * whole library. Registering an explicit subset lets Rollup drop the unused
 * chart types from that chunk.
 *
 * Adding a new chart type? Register its controller/element/scale below, or it
 * throws at runtime ("'<x>' is not a registered controller/element/scale").
 */
import {
  Chart,
  // controllers
  LineController,
  BarController,
  // elements
  LineElement,
  PointElement,
  BarElement,
  // scales
  CategoryScale,
  LinearScale,
  // plugins
  Filler, // line `fill: true`
  Legend,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  BarController,
  LineElement,
  PointElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Title,
  Tooltip
);

export { Chart };
export default Chart;
