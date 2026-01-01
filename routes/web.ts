/**
 * Web Routes
 * Single-SPA Configuration: All routes serve the same HTML file
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';

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
    if (err) {
      console.error('[SPA] Failed to serve index.html:', err);
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

// Catch-all route - serves index.html for ALL routes
// Note: Express 5 requires named wildcard parameters (use /*splat instead of *)
router.get('/*splat', (_req: Request, res: Response): void => {
  serveSingleSPA(res);
});

export default router;
