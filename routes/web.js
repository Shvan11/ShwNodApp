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
  // Messaging pages
  { url: '/send-message', file: '/views/messaging/send-message.html' },
  { url: '/send', file: '/views/messaging/send.html' },
  { url: '/auth', file: '/views/messaging/auth.html' },
 
  // Patient pages
  { url: '/search', file: '/views/patient/search.html' },
  
  // Appointment pages
  { url: '/appointments.html', file: '/views/appointments.html' },
  { url: '/appointments', file: '/views/appointments.html' },
  { url: '/simplified', file: '/views/appointments/simplified.html' },
  
  // Handle legacy URLs with new paths
  { url: '/wa', file: '/views/messaging/send-message.html' } // Replace old /wa route
];

// ==============================
// ROUTE HANDLERS
// ==============================

// Serve the main page at root
router.get('/', (_, res) => {
    res.sendFile(path.join(process.cwd(), './public/index.html'));
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
  res.sendFile(path.join(process.cwd(), './public/views/patient/react-shell-refactored.html'));
});

router.get('/patient/:patientId', (req, res) => {
  res.sendFile(path.join(process.cwd(), './public/views/patient/react-shell-refactored.html'));
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
