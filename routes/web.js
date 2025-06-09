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
  
  // Patient pages
  { url: '/details', file: '/views/patient/details.html' },
  { url: '/canvas', file: '/views/patient/canvas.html' },
  { url: '/visits-summary', file: '/views/patient/visits-summary.html' },
  { url: '/payments', file: '/views/patient/payments.html' },
  { url: '/grid', file: '/views/patient/grid.html' },
  { url: '/add-visit', file: '/views/patient/add-visit.html' },
  { url: '/search', file: '/views/patient/search.html' },
  
  // Appointment pages
  { url: '/appointments.html', file: '/views/appointments.html' },
  { url: '/appointments', file: '/views/appointments.html' },
  { url: '/simplified', file: '/views/appointments/simplified.html' },
  
  // X-ray pages
  { url: '/xrays.html', file: '/views/xrays.html' },
  { url: '/xrays', file: '/views/xrays.html' },
  
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
