// routes/web.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const router = express.Router();

// ==============================
// PAGE ROUTING CONFIGURATION
// ==============================

// Define clean URL mappings to actual file paths
const pageRewrites = [
  // Main application pages
  { url: '/dashboard', file: '/views/dashboard.html' },
  { url: '/calendar', file: '/views/appointments/calendar.html' },
  { url: '/appointments', file: '/views/appointments/daily-appointments.html' },
  
  // Patient pages
  { url: '/search', file: '/views/patient/search.html' },
  
  // Messaging pages
  { url: '/send-message', file: '/views/messaging/send-message.html' },
  { url: '/send', file: '/views/messaging/send.html' },
  { url: '/auth', file: '/views/messaging/auth.html' },
  
  // Legacy appointment pages (keep for backward compatibility)
  { url: '/appointments.html', file: '/views/appointments.html' },
  { url: '/daily-appointments', file: '/views/appointments/daily-appointments.html' },
  
  // Handle legacy URLs with new paths
  { url: '/wa', file: '/views/messaging/send-message.html' } // Replace old /wa route
];

// ==============================
// ROUTE HANDLERS
// ==============================

// Serve the main page at root
router.get('/', (_, res) => {
    res.sendFile(path.join(process.cwd(), './public/views/dashboard.html'));
});

// Patient page with query parameters
router.get('/patient', (req, res) => {
    const patientId = req.query.code;
    if (patientId) {
        // Serve the built version from dist
        res.sendFile(path.join(process.cwd(), './dist/views/patient/react-shell.html'));
    } else {
        res.status(400).send('Patient code required');
    }
});

// Patient pages with clean URLs
router.get('/patient/:id', (req, res) => {
    const patientId = req.params.id;
    const page = req.query.page || 'grid';
    res.redirect(`/views/patient/react-shell.html?code=${patientId}&page=${page}`);
});

// Redirect old standalone page URLs to React shell
router.get('/canvas', (req, res) => {
  const patientId = req.query.code;
  if (patientId) {
    res.redirect(`/patient/${patientId}/compare`);
  } else {
    res.status(400).send('Patient code required');
  }
});

router.get('/xrays', (req, res) => {
  const patientId = req.query.code;
  if (patientId) {
    res.redirect(`/patient/${patientId}/xrays`);
  } else {
    res.status(400).send('Patient code required');
  }
});

router.get('/visits-summary', (req, res) => {
  const patientId = req.query.PID;
  if (patientId) {
    res.redirect(`/patient/${patientId}/visits`);
  } else {
    res.status(400).send('Patient ID required');
  }
});

// React Shell route for patient pages (using refactored components)
router.get('/patient/:patientId/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), './public/views/patient/react-shell.html'));
});

router.get('/patient/:patientId', (req, res) => {
  res.sendFile(path.join(process.cwd(), './public/views/patient/react-shell.html'));
});

// Apply all page rewrites
pageRewrites.forEach(({ url, file }) => {
  router.get(url, (_, res) => {
    res.sendFile(path.join(process.cwd(), `./public${file}`));
  });
});

// Handle .html extension for compatibility with old links
router.get('/:page.html', (req, res, next) => {
  const page = req.params.page;
  const rewrite = pageRewrites.find(r => r.url === `/${page}`);
  
  if (rewrite) {
    res.sendFile(path.join(process.cwd(), `./public${rewrite.file}`));
  } else {
    next(); // Continue to static file handling
  }
});

// Legacy routes removed - clear.html file was missing

// Export the router
export default router;
