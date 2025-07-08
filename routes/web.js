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
 * Serve file with environment-aware fallback (production prefers dist, development prefers public)
 * @param {Object} res - Express response object
 * @param {string} filePath - Relative file path from project root
 * @param {string} errorMessage - Custom error message if file not found
 */
function serveWithFallback(res, filePath, errorMessage = 'File not found') {
  const builtFile = path.join(process.cwd(), `./dist${filePath}`);
  const sourceFile = path.join(process.cwd(), `./public${filePath}`);
  
  const isProduction = process.env.NODE_ENV === 'production';
  const primaryFile = isProduction ? builtFile : sourceFile;
  const fallbackFile = isProduction ? sourceFile : builtFile;
  
  res.sendFile(primaryFile, (err) => {
    if (err) {
      res.sendFile(fallbackFile, (fallbackErr) => {
        if (fallbackErr) {
          res.status(404).send(errorMessage);
        }
      });
    }
  });
}

// ==============================
// PAGE ROUTING CONFIGURATION
// ==============================

// Define clean URL mappings to actual file paths
const pageRewrites = [
  // Main application pages
  { url: '/dashboard', file: '/views/dashboard.html' },
  { url: '/calendar', file: '/views/appointments/calendar.html' },
  { url: '/appointments', file: '/views/appointments/daily-appointments.html' },
  
  // Patient pages - clean URLs
  { url: '/search', file: '/views/patient/search.html' },
  
  // Patient pages - direct paths (for compatibility)
  { url: '/views/patient/search.html', file: '/views/patient/search.html' },
  { url: '/views/patient/add-patient.html', file: '/views/patient/add-patient.html' },
  { url: '/views/patient/grid_.html', file: '/views/patient/grid_.html' },
  
  // Messaging pages - clean URLs
  { url: '/send-message', file: '/views/messaging/send-message.html' },
  { url: '/send', file: '/views/messaging/send.html' },
  { url: '/auth', file: '/views/messaging/auth.html' },
  
  // Messaging pages - direct paths (for compatibility)
  { url: '/views/messaging/send-message.html', file: '/views/messaging/send-message.html' },
  { url: '/views/messaging/send.html', file: '/views/messaging/send.html' },
  { url: '/views/messaging/auth.html', file: '/views/messaging/auth.html' },
  
  // Legacy appointment pages (backward compatibility)
  { url: '/appointments.html', file: '/views/appointments.html' },
  { url: '/daily-appointments', file: '/views/appointments/daily-appointments.html' },
  { url: '/appointments/daily-appointments.html', file: '/views/appointments/daily-appointments.html' },
  
  // Legacy messaging URLs
  { url: '/wa', file: '/views/messaging/send-message.html' }
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
        serveWithFallback(res, '/views/patient/react-shell.html', 'Patient shell not found');
    } else {
        res.status(400).send('Patient code required');
    }
});

// Patient pages with clean URLs (use numeric patient IDs only)
router.get('/patient/:id(\\d+)', (req, res) => {
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

// React Shell route for patient pages (using refactored components) - numeric IDs only
router.get('/patient/:patientId(\\d+)/*', (_, res) => {
  serveWithFallback(res, '/views/patient/react-shell.html', 'Patient shell not found');
});

router.get('/patient/:patientId(\\d+)', (_, res) => {
  serveWithFallback(res, '/views/patient/react-shell.html', 'Patient shell not found');
});

// Apply all page rewrites
pageRewrites.forEach(({ url, file }) => {
  router.get(url, (_, res) => {
    serveWithFallback(res, file, 'Page not found');
  });
});

// Handle .html extension for compatibility with old links
router.get('/:page.html', (req, res, next) => {
  const page = req.params.page;
  const rewrite = pageRewrites.find(r => r.url === `/${page}`);
  
  if (rewrite) {
    // Use environment-aware file serving with custom fallback to next()
    const builtFile = path.join(process.cwd(), `./dist${rewrite.file}`);
    const sourceFile = path.join(process.cwd(), `./public${rewrite.file}`);
    
    const isProduction = process.env.NODE_ENV === 'production';
    const primaryFile = isProduction ? builtFile : sourceFile;
    const fallbackFile = isProduction ? sourceFile : builtFile;
    
    res.sendFile(primaryFile, (err) => {
      if (err) {
        res.sendFile(fallbackFile, (fallbackErr) => {
          if (fallbackErr) {
            next(); // Continue to static file handling
          }
        });
      }
    });
  } else {
    next(); // Continue to static file handling
  }
});

// ==============================
// ROUTE SUMMARY
// ==============================
// Clean URLs: /search, /appointments, /calendar, /send-message, /send, /auth, /dashboard
// Patient Routes: /patient/123, /patient/123/grid, /patient/123/compare, etc.
// Legacy Support: /appointments.html, /daily-appointments, /wa, etc.
// Direct Paths: /views/patient/search.html, /views/messaging/send.html, etc.
// Environment: Automatically serves built files in production, source files in development

// Export the router
export default router;
