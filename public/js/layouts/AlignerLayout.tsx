/**
 * AlignerLayout - Layout wrapper for aligner section with persistent mode toggle
 */
import { Outlet, useLocation } from 'react-router-dom';

// Aligner section CSS - shared/common styles remain global
import '../../css/components/aligner-common.css';

// CSS Module for layout-specific styles
import styles from './AlignerLayout.module.css';
import AlignerModeToggle, { type AlignerMode } from '../components/react/AlignerModeToggle';

/**
 * Layout component for aligner section
 * Renders the mode toggle once at the layout level so it doesn't re-render on navigation
 */
function AlignerLayout() {
  const location = useLocation();

  // Determine active mode based on current route
  const getActiveMode = (): AlignerMode => {
    if (location.pathname.includes('/archform-match')) {
      return 'archform-match';
    } else if (location.pathname.includes('/search')) {
      return 'search';
    } else if (location.pathname.includes('/all-sets')) {
      return 'all-sets';
    } else {
      return 'doctors';
    }
  };

  const activeMode = getActiveMode();

  // All-sets locks the shell to the viewport so the table's internal scroller
  // is the only vertical scrollbar (page + table both scrolling = double bar).
  const viewportLocked = activeMode === 'all-sets';
  const containerClass = viewportLocked
    ? `${styles.container} ${styles.containerViewportLocked}`
    : styles.container;

  return (
    <div className={containerClass}>
      <AlignerModeToggle activeMode={activeMode} sticky={!viewportLocked} />
      <Outlet />
    </div>
  );
}

export default AlignerLayout;
