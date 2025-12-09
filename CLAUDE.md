# CLAUDE.md

## Project Overview

**Shwan Orthodontics Management System** - Enterprise orthodontic practice management platform built with Node.js, Express, and React 19.

### Core Features
- **Patient Management**: Registration, demographics, photo/x-ray imaging, WebCeph/Dolphin integration
- **Orthodontic Treatment**: Interactive dental chart (Palmer notation), wire tracking, visits, appliances
- **Aligner Management**: Doctor/partner registration, set lifecycle, batch management, Google Drive PDF storage
- **Appointments**: Monthly/weekly calendar, daily dashboard, real-time check-in workflow
- **Multi-Channel Messaging**: WhatsApp (Web.js), SMS (Twilio), Telegram, bulk reminders
- **Financial**: Multi-currency payments, invoices, receipts, expense tracking
- **Templates**: GrapesJS visual designer for receipts/invoices/prescriptions

### Tech Stack
- **Backend**: Node.js, Express 5, SQL Server (Tedious), WebSocket
- **Frontend**: React 19, React Router v7 (Data Router), Vite
- **External**: WhatsApp Web.js, Twilio, Telegram Bot API, Google Drive, WebCeph

### Application Scale
| Metric | Count |
|--------|-------|
| API Endpoints | ~173 |
| React Components | 91 |
| CSS Files | 56 (~32,756 lines) |
| Frontend Routes | 31 |
| Route Loaders | 7 |
| Backend Service Categories | 16 |
| Custom Hooks | 8 |
| Database Tables | 25+ |

---

## Commands

```bash
# Development
npm run dev              # Vite (5173) + Express (3001)
npm run dev:server       # Express only (3001)
npm run dev:client       # Vite only (5173)

# Production
npm run build            # Build to /dist
npm start                # Serve from /dist (3000)

# Windows Service
npm run service:install
npm run service:uninstall
```

---

## Architecture

### Backend Structure
```
index.js                 # Entry point, server setup, graceful shutdown
/config/                 # Environment config, database, SSL
/routes/api/             # 20 modular route files
/services/
  /business/             # Service layer (Patient, Appointment, Aligner, etc.)
  /database/queries/     # 14 query modules
  /messaging/            # WhatsApp, SMS, Telegram, WebSocket events
  /sync/                 # SQL Server ↔ Supabase sync engine
/middleware/             # Auth, CORS, timeout, upload
/utils/                  # Logger, WebSocket server, path resolver
```

### Frontend Structure
```
/public/js/
  App.jsx                # Root component with RouterProvider
  /router/
    routes.config.jsx    # 31 routes in 5 phases
    loaders.js           # 7 route loaders with caching
  /layouts/              # RootLayout, AlignerLayout
  /routes/               # 8 route components
  /components/react/     # 63 React components
  /contexts/             # GlobalStateContext, ToastContext
  /hooks/                # 8 custom hooks
  /services/             # WebSocket singleton, HTTP client
```

### CSS Structure
```
/public/css/
  /base/       # 5 files: variables, reset, typography, rtl-support, utilities
  /layout/     # 2 files: universal-header, sidebar-navigation
  /components/ # 25 files
  /pages/      # 24 files
```

**CSS Guidelines**: See `css-styling-guidelines.skill.md` for comprehensive documentation.

---

## Critical Patterns

### Navigation - React Router ONLY

**NEVER use `window.location.href` for internal routes.**

```javascript
// CORRECT
import { useNavigate, Link } from 'react-router-dom';
const navigate = useNavigate();
navigate('/patient/123/works');

// WRONG - causes full page reload
window.location.href = '/patient/123/works';
```

**Exceptions for window.location.href:**
- External URLs
- System protocols (`explorer:`, `csimaging:`)
- Security logout
- Route loader 401 redirects

### Toast Notifications

Use `ToastContext` for all user feedback. **Never use `alert()`**.

```javascript
import { useToast } from '../contexts/ToastContext.jsx';
const toast = useToast();

toast.success('Saved!');
toast.error('Failed');
toast.warning('Check input');
toast.info('Processing...');

// Non-React: window.toast?.success('Done!');
```

### Winston Logging

**Never use `console.log()` in production.** Use Winston:

```javascript
import { log } from '../utils/logger.js';

log.info('Completed', { userId: 123 });
log.error('Failed', { error: err.message });
log.warn('Warning', { current: 95 });
log.debug('Debug info', { key: 'value' });
```

### WebSocket Events

Universal naming convention:
- Connection: `connection_established`, `connection_lost`, `heartbeat_ping/pong`
- Appointments: `appointments_updated`, `request_appointments`
- Patient: `patient_loaded`, `patient_unloaded`
- WhatsApp: `whatsapp_client_ready`, `whatsapp_qr_updated`, `whatsapp_message_status`

Constants in `services/messaging/websocket-events.js`.

---

## Environment Variables

**Required:**
```
DB_SERVER, DB_INSTANCE, DB_USER, DB_PASSWORD
MACHINE_PATH    # File system path for patient images
PORT            # 3001 dev, 3000 prod
```

**Optional Services:**
```
TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NAME
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

**Sync (Supabase):**
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
REVERSE_SYNC_ENABLED, REVERSE_SYNC_INTERVAL_MINUTES
```

---

## Key API Endpoints

```
# Patient
GET /api/getinfos?code={patientId}
GET /api/gettimepoints?code={patientId}
GET /api/getpayments?code={patientId}

# Messaging
GET /api/wa/send?date={date}
GET /api/wa/status

# Health
GET /health/basic
GET /api/health/detailed
```

---

## Database

SQL Server via Tedious with connection pooling (max 10 connections).

Key tables: `tblpatients`, `tblappointments`, `tblwork`, `tblVisits`, `tblWires`, `tblInvoice`, `tblExpenses`, `tblUsers`

Query modules in `/services/database/queries/`.

---

## Route Loaders

7 loaders with 5-minute sessionStorage caching:
1. `patientShellLoader` - Patient + work + timepoints
2. `patientManagementLoader` - Filter data
3. `dailyAppointmentsLoader` - Initial appointments
4. `templateListLoader` / `templateDesignerLoader` - Templates
5. `alignerDoctorsLoader` / `alignerPatientWorkLoader` - Aligner data

---

## Testing Credentials

```
Username: Admin
Password: Yarmok11
```

```bash
# Login and test
curl -c /tmp/cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Yarmok11"}'

curl -b /tmp/cookies.txt http://localhost:3001/api/admin/lookups/tables
```

---

## MCP Servers

- **MSSQL MCP Server** (`@wener/mssql-mcp`) - Database queries
- **React MCP Server** - React development

Config in `.mcp.json`. See `docs/mcp-mssql-setup.md`.

---

## Development Notes

- ES Modules (`"type": "module"`)
- Graceful shutdown for all services
- Circuit breaker pattern for messaging
- Cross-platform paths (Windows/WSL auto-conversion)
- RTL support for Kurdish/Arabic

---

## Design System Quick Reference

Use variables from `/public/css/base/variables.css`:

```css
/* Colors */
--primary-color: #007bff
--success-color: #28a745
--error-color: #dc3545
--warning-color: #ffc107

/* Spacing */
--spacing-sm: 0.5rem   /* 8px */
--spacing-md: 1rem     /* 16px */
--spacing-lg: 1.5rem   /* 24px */

/* Z-index */
--z-index-modal: 1040
--z-index-tooltip: 1060

/* Breakpoints */
--breakpoint-md: 768px
--breakpoint-lg: 1024px
```

**CSS Rules:**
- NO inline styles (except dynamic values)
- NO `!important` (except print/accessibility)
- Use CSS variables from variables.css
- Mobile-first responsive design
- BEM-like naming

Full guidelines: `css-styling-guidelines.skill.md`
