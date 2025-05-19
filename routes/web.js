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
  { url: '/report', file: '/views/messaging/report.html' },
  
  // Patient pages
  { url: '/patient-lookup', file: '/views/patient/lookup.html' },
  { url: '/patient-details', file: '/views/patient/details.html' },
  { url: '/canvas', file: '/views/patient/canvas.html' },
  { url: '/visits-summary', file: '/views/patient/visits-summary.html' },
  { url: '/payments', file: '/views/patient/payments.html' },
  { url: '/grid', file: '/views/patient/grid.html' },
  { url: '/add-visit', file: '/views/patient/add-visit.html' },
  { url: '/search', file: '/views/patient/search.html' },
  { url: '/send-message', file: '/views/messaging/send-message.html' },

  
  // Other pages
  { url: '/xrays', file: '/views/xrays.html' },
  
  // Handle legacy URLs with new paths
  { url: '/wa', file: '/views/messaging/send-message.html' }, // Replace old /wa route
  { url: '/wareport', file: '/views/messaging/report.html' }  // Replace old /wareport route
];

// ==============================
// ROUTE HANDLERS
// ==============================

// Serve the main page at root
router.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/index.html'));
});

// Apply all page rewrites
pageRewrites.forEach(({ url, file }) => {
  router.get(url, (req, res) => {
    // Forward query parameters
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

// Legacy routes kept for backward compatibility
router.get('/clear', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/clear.html'));
});

// Export the router
export default router;
