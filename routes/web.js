// routes/web.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// ==============================
// HELPER FUNCTIONS
// ==============================

/**
 * Serve file from dist directory (built files only)
 * Express server always serves from dist/
 * For development with HMR, use Vite dev server on port 5173
 */
function serveWithFallback(res, filePath, errorMessage = 'Page not found') {
  const builtFile = path.join(process.cwd(), `./dist${filePath}`);
  res.sendFile(builtFile, (err) => {
    if (err) {
      res.status(404).send(errorMessage);
    }
  });
}

// ==============================
// REACT ROUTER APPLICATIONS
// ==============================

// Patient Portal - React Router handles all /patient/* routes
router.get('/patient/*', (_, res) => {
  serveWithFallback(res, '/views/patient/react-shell.html', 'Patient portal not found');
});

// Aligner Management - React Router handles all /aligner/* routes
router.get('/aligner', (_, res) => {
  serveWithFallback(res, '/views/aligner.html', 'Aligner management not found');
});

router.get('/aligner/*', (_, res) => {
  serveWithFallback(res, '/views/aligner.html', 'Aligner management not found');
});

// ==============================
// STANDALONE PAGE ROUTES
// ==============================

// Root - Dashboard
router.get('/', (_, res) => {
  serveWithFallback(res, '/views/dashboard.html', 'Dashboard not found');
});

// Dashboard
router.get('/dashboard', (_, res) => {
  serveWithFallback(res, '/views/dashboard.html', 'Dashboard not found');
});

// Patient Management
router.get('/patient-management', (_, res) => {
  serveWithFallback(res, '/views/patient-management.html', 'Patient management not found');
});

// Appointments
router.get('/appointments', (_, res) => {
  serveWithFallback(res, '/views/appointments/daily-appointments.html', 'Appointments not found');
});

router.get('/daily-appointments', (_, res) => {
  serveWithFallback(res, '/views/appointments/daily-appointments.html', 'Appointments not found');
});

router.get('/calendar', (_, res) => {
  serveWithFallback(res, '/views/appointments/calendar.html', 'Calendar not found');
});

// Messaging
router.get('/send-message', (_, res) => {
  serveWithFallback(res, '/views/messaging/send-message.html', 'Send message not found');
});

router.get('/send', (_, res) => {
  serveWithFallback(res, '/views/messaging/send.html', 'Send page not found');
});

router.get('/auth', (_, res) => {
  serveWithFallback(res, '/views/messaging/auth.html', 'Auth page not found');
});

// Settings - React Router handles all /settings/* routes
router.get('/settings/*', (_, res) => {
  serveWithFallback(res, '/views/settings.html', 'Settings not found');
});

router.get('/settings', (_, res) => {
  serveWithFallback(res, '/views/settings.html', 'Settings not found');
});

// Expenses
router.get('/expenses', (_, res) => {
  serveWithFallback(res, '/views/expenses.html', 'Expenses not found');
});

// Statistics
router.get('/statistics', (_, res) => {
  serveWithFallback(res, '/views/statistics.html', 'Statistics not found');
});

// Template Management
router.get('/template-management', (_, res) => {
  serveWithFallback(res, '/views/template-management.html', 'Template management not found');
});

// Template Designer
router.get('/template-designer', (_, res) => {
  serveWithFallback(res, '/template-designer.html', 'Template designer not found');
});

// ==============================
// ROUTE SUMMARY
// ==============================
//
// React Router Apps (client-side routing):
//   - /patient/:patientId/:page     → Patient portal (works, grid, compare, xrays, visits, payments, etc.)
//   - /aligner/*                    → Aligner management (doctors, patients, sets, search)
//   - /settings/:tab                → Settings (general, database, alignerDoctors, messaging, system, security)
//
// Standalone Pages:
//   - /                             → Dashboard
//   - /dashboard                    → Dashboard
//   - /patient-management           → Patient list/search
//   - /appointments                 → Daily appointments
//   - /daily-appointments           → Daily appointments
//   - /calendar                     → Appointment calendar
//   - /send-message                 → WhatsApp messaging
//   - /send                         → Send page
//   - /auth                         → Authentication
//   - /expenses                     → Expense management
//   - /template-management          → Document template management
//   - /template-designer            → Template designer (visual editor)
//
// All routes serve from dist/ directory (production builds)
// Use Vite dev server on port 5173 for development with HMR

export default router;
