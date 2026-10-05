/**
 * AlignerLayout - Layout wrapper for aligner section with persistent mode toggle
 */
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { alignerFeaturesQuery } from '@/query/queries';

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
  // Archform tab only where an Archform path is set (owner decision, FE-F18-4). While
  // the read is pending the tab stays hidden rather than flashing in and out.
  const { data: features } = useQuery(alignerFeaturesQuery());

  // The list route on screen. A patient's sets page and Announcements are reached
  // from several lists, so they mark none — they used to claim "Browse by Doctor"
  // even when the user came from Search or All Sets (FE-F18-14).
  const getActiveMode = (): AlignerMode | null => {
    const path = location.pathname.replace(/\/+$/, '');
    if (path === '/aligner/archform-match') return 'archform-match';
    if (path === '/aligner/search') return 'search';
    if (path === '/aligner/all-sets') return 'all-sets';
    if (path === '/aligner' || /^\/aligner\/doctor\/[^/]+$/.test(path)) return 'doctors';
    return null;
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
      <AlignerModeToggle activeMode={activeMode} sticky={!viewportLocked} showArchform={features?.archform ?? false} />
      <Outlet />
    </div>
  );
}

export default AlignerLayout;
