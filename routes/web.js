// routes/web.js
// Single-SPA Configuration: All routes serve the same HTML file
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// ==============================
// SINGLE-SPA CATCH-ALL ROUTE
// ==============================

/**
 * Single-SPA Architecture
 *
 * All routes serve the same index-spa.html file.
 * React Router handles all client-side routing.
 * Single-SPA orchestrates micro-apps based on the current route.
 *
 * Benefits:
 * - No page reloads - instant navigation
 * - Shared state across apps
 * - Single persistent WebSocket connection
 * - Optimized bundle loading
 * - Native app-like experience
 */
function serveSingleSPA(res) {
  const spaFile = path.join(process.cwd(), './dist/index-spa.html');
  res.sendFile(spaFile, (err) => {
    if (err) {
      console.error('[SPA] Failed to serve index-spa.html:', err);
      res.status(500).send('Application failed to load. Please try again.');
    }
  });
}

// Legacy redirects (for backward compatibility)
router.get('/template-management', (_, res) => {
  res.redirect(301, '/templates');
});

router.get('/template-designer', (_, res) => {
  res.redirect(301, '/templates');
});

// ==============================
// SINGLE-SPA ROUTES
// ==============================
//
// ALL routes serve index-spa.html - client-side routing takes over
//
// Registered Apps (single-spa):
//   - @clinic/dashboard        → / or /dashboard
//   - @clinic/patient          → /patient/*
//   - @clinic/expenses         → /expenses
//   - @clinic/whatsapp-send    → /send
//   - @clinic/whatsapp-auth    → /auth
//   - @clinic/aligner          → /aligner/*
//   - @clinic/settings         → /settings/*
//   - @clinic/templates        → /templates/*
//   - @clinic/appointments     → /appointments
//
// React Router handles all nested routing within each app
// No page reloads - all navigation is instant

// Catch-all route - serves index-spa.html for ALL routes
router.get('*', (_, res) => {
  serveSingleSPA(res);
});

export default router;
