/**
 * AlignerLayout - Layout wrapper for aligner section with persistent mode toggle
 */
import { Outlet, useLocation } from 'react-router-dom';

// Aligner section CSS - shared/common styles remain global
import '../../css/components/aligner-common.css';
import '../../css/components/aligner-set-card.css';
import '../../css/components/aligner-drawer-form.css';

// CSS Module for layout-specific styles
import styles from './AlignerLayout.module.css';
import AlignerModeToggle from '../components/react/AlignerModeToggle';

type AlignerMode = 'doctors' | 'search' | 'all-sets';

/**
 * Layout component for aligner section
 * Renders the mode toggle once at the layout level so it doesn't re-render on navigation
 */
function AlignerLayout() {
  const location = useLocation();

  // Determine active mode based on current route
  const getActiveMode = (): AlignerMode => {
    if (location.pathname.includes('/search')) {
      return 'search';
    } else if (location.pathname.includes('/all-sets')) {
      return 'all-sets';
    } else {
      return 'doctors';
    }
  };

  return (
    <div className={styles.container}>
      <AlignerModeToggle activeMode={getActiveMode()} styles={styles} />
      <Outlet />
    </div>
  );
}

export default AlignerLayout;
