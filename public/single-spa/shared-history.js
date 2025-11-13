/**
 * Shared History Object for Single-SPA + React Router
 *
 * This module creates a single history instance that is shared across
 * ALL micro-frontends in the application. This ensures:
 * - Consistent navigation across all apps
 * - Single source of truth for URL changes
 * - No router conflicts or race conditions
 * - All apps can use React Router hooks (useNavigate, useLocation, useParams)
 *
 * Usage:
 *   import { sharedHistory } from '/single-spa/shared-history.js';
 *
 *   <Router history={sharedHistory}>
 *     <YourComponent />
 *   </Router>
 */

import { createBrowserHistory } from 'history';

// Create ONE history instance for the entire application
export const sharedHistory = createBrowserHistory();

// Log navigation for debugging
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    sharedHistory.listen((update) => {
        console.log('[SharedHistory] Navigation:', {
            action: update.action,
            location: update.location.pathname + update.location.search
        });
    });
}

console.log('[SharedHistory] Initialized shared history instance');

export default sharedHistory;
