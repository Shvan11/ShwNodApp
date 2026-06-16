/**
 * NavigationProgress — global top progress bar shown during route navigation.
 *
 * The router runs with `v7_startTransition: true`, so Data Router keeps the
 * *previous* screen mounted while the next route's loader runs (and while its
 * lazy chunk downloads). That's good — no jarring fallback flash — but it also
 * means a click on a nav link gives NO visual feedback until the new screen
 * commits. This thin bar at the top of the viewport is that feedback.
 *
 * Pure CSS, no timers/state: the element only exists while a navigation is in
 * flight (`navigation.state !== 'idle'`), and its appear-animation holds it
 * invisible for the first ~160ms, so instant (cache-served) navigations never
 * flash a bar. It simply unmounts when the new screen commits.
 */
import { useNavigation } from 'react-router-dom';
import styles from './NavigationProgress.module.css';

export default function NavigationProgress() {
  const navigation = useNavigation();

  // 'loading' = a loader is running for the next route; 'submitting' = a form
  // action is in flight (followed by revalidation). Either way work is pending.
  if (navigation.state === 'idle') return null;

  return <div className={styles.bar} data-navigation-progress="" aria-hidden="true" />;
}
