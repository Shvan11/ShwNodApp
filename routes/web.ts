/**
 * Web Routes
 * Single-SPA Configuration: All routes serve the same HTML file
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';
import { log } from '../utils/logger.js';

const router = Router();

// ==============================
// SINGLE-SPA CATCH-ALL ROUTE
// ==============================

/**
 * Unified React Application Architecture
 *
 * All routes serve the same index.html file.
 * React Router handles all client-side routing.
 * Single unified React app with BrowserRouter.
 *
 * Benefits:
 * - No page reloads - instant navigation
 * - Shared state across apps
 * - Single persistent WebSocket connection
 * - Optimized bundle loading
 * - Native app-like experience
 */
function serveSingleSPA(res: Response): void {
  const spaFile = path.join(process.cwd(), './dist/index.html');
  res.sendFile(spaFile, (err) => {
    if (!err) return;

    // The browser aborted the request mid-send (page refresh / navigation / proxy
    // drop). Not a server fault — the socket is already gone, so there's nothing to
    // send and nothing to fix. Debug-level, never error, and don't touch the dead
    // response (writing a 500 to an aborted socket just throws).
    if ((err as NodeJS.ErrnoException).code === 'ECONNABORTED') {
      log.debug('[SPA] index.html send aborted by client', { error: (err as Error).message });
      return;
    }

    // A genuine failure to serve the shell (e.g. dist/index.html missing). Only
    // send a 500 if the response hasn't started — once headers are out (mid-stream
    // failure) we can't change the status.
    log.error('[SPA] Failed to serve index.html', { error: (err as Error).message });
    if (!res.headersSent) {
      res.status(500).send('Application failed to load. Please try again.');
    }
  });
}

// ==============================
// UNIFIED REACT APP ROUTES
// ==============================
//
// ALL routes serve index.html - client-side routing takes over
//
// Application routes (BrowserRouter):
//   - /dashboard               → Dashboard
//   - /patient/*               → Patient Portal (nested routes)
//   - /patient-management      → Patient Search & Grid
//   - /appointments            → Daily Appointments
//   - /calendar                → Calendar View
//   - /send                    → WhatsApp Send
//   - /auth                    → WhatsApp Auth
//   - /aligner/*               → Aligner Management (nested routes)
//   - /expenses                → Expenses
//   - /settings/*              → Settings (nested routes)
//   - /templates/*             → Templates (nested routes)
//   - /statistics              → Financial Statistics
//
// React Router handles all nested routing within the unified app
// No page reloads - all navigation is instant

// Static-asset extensions that must NEVER fall through to index.html. When a
// hashed build chunk is missing (a stale tab after a redeploy, or a transient
// fetch failure where express.static didn't serve it), returning index.html
// hands the browser `text/html` for a `.js`/`.css` request. The browser then
// refuses to execute it ("Expected a JavaScript module… got text/html") and the
// dynamic import crashes the page via the ErrorBoundary. A real 404 instead
// lets the client's reload-on-preloadError recovery (see App.tsx) kick in.
const ASSET_EXT =
  /\.(?:js|mjs|cjs|css|map|json|wasm|woff2?|ttf|eot|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i;

function looksLikeAsset(reqPath: string): boolean {
  return (
    reqPath.startsWith('/assets/') ||
    // Dolphin patient images are served by the `/DolImgs` static mount and use
    // non-standard extensions (`.iNN`, `.ZZZ`) that ASSET_EXT doesn't list. A
    // request reaching this catch-all means the file is missing on disk, so it
    // must 404 — not fall through to the SPA shell (a 500 in dev with no build,
    // or a 200 text/html body served as a JPEG in prod).
    reqPath.startsWith('/DolImgs/') ||
    ASSET_EXT.test(reqPath)
  );
}

// Catch-all route - serves index.html for ALL routes
// Note: Express 5 requires named wildcard parameters (use /*splat instead of *)
router.get('/*splat', (req: Request, res: Response): void => {
  // Asset request that reached the catch-all = the file isn't on disk. Return a
  // clean 404 rather than poisoning the browser's module loader with HTML.
  if (looksLikeAsset(req.path)) {
    res.status(404).type('txt').send('Not found');
    return;
  }
  serveSingleSPA(res);
});

export default router;
