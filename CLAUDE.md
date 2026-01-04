# CLAUDE.md

## Project Overview

**Shwan Orthodontics Management System** - Enterprise orthodontic practice management platform built with Node.js, Express, React 19, and **TypeScript**.

### Core Features
- **Patient Management**: Registration, demographics, photo/x-ray imaging, WebCeph/Dolphin integration
- **Orthodontic Treatment**: Interactive dental chart (Palmer notation), wire tracking, visits, appliances
- **Aligner Management**: Doctor/partner registration, set lifecycle, batch management, Google Drive PDF storage
- **Appointments**: Monthly/weekly calendar, daily dashboard, real-time check-in workflow
- **Multi-Channel Messaging**: WhatsApp (Web.js), SMS (Twilio), Telegram, bulk reminders
- **Financial**: Multi-currency payments, invoices, receipts, expense tracking
- **Templates**: GrapesJS visual designer for receipts/invoices/prescriptions

### Tech Stack
- **Backend**: Node.js, Express 5, **TypeScript**, SQL Server (Tedious), WebSocket
- **Frontend**: React 19, **TypeScript**, React Router v7 (Data Router), Vite, CSS Modules
- **External**: WhatsApp Web.js, Twilio, Telegram Bot API, Google Drive, WebCeph

### Application Scale
| Metric | Count |
|--------|-------|
| API Endpoints | ~202 |
| React Components | 97 |
| CSS Module Files | ~70+ (component-scoped) |
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

# Type Checking
npm run typecheck            # Check backend types
npm run typecheck:frontend   # Check frontend types
npm run typecheck:all        # Check both

# Windows Service
npm run service:install
npm run service:uninstall
```

---

## Architecture

### Backend Structure
```
index.ts                 # Entry point, server setup, graceful shutdown
/config/                 # Environment config, database, SSL (.ts)
/routes/api/             # 21 modular route files (.ts)
/services/
  /business/             # Service layer (Patient, Appointment, Aligner, etc.) (.ts)
  /database/queries/     # 16 query modules (.ts)
  /messaging/            # WhatsApp, SMS, Telegram, WebSocket events (.ts)
  /sync/                 # SQL Server ↔ Supabase sync engine (.ts)
/middleware/             # Auth, CORS, timeout, upload (.ts)
/utils/                  # Logger, WebSocket server, path resolver (.ts)
/types/                  # Shared TypeScript type definitions
```

### Frontend Structure
```
/public/js/
  App.tsx                # Root component with RouterProvider
  /router/
    routes.config.tsx    # 31 routes in 5 phases
    loaders.ts           # 7 route loaders with caching
  /layouts/              # RootLayout, AlignerLayout (.tsx)
  /routes/               # 8 route components (.tsx)
  /components/react/     # 69 React components (.tsx)
  /contexts/             # GlobalStateContext, PrintQueueContext, ToastContext (.tsx)
  /hooks/                # 8 custom hooks (.ts)
  /services/             # WebSocket singleton, HTTP client (.ts)
  /utils/                # Formatters, API clients (.ts)
```

### Type Definitions
```
/types/
  index.ts               # Re-exports all types
  api.types.ts           # API request/response types
  config.types.ts        # Configuration types
  database.types.ts      # Database entity types
  services.types.ts      # Service layer types
  websocket.types.ts     # WebSocket event types
  express-session.d.ts   # Express session augmentation
```

### CSS Structure (CSS Modules)

**Component styles use CSS Modules** (`.module.css`) for scoped styling:
```
/public/js/components/react/
  ComponentName.tsx
  ComponentName.module.css    # Scoped styles for component

/public/css/
  /base/       # Global: variables, reset, typography, rtl-support, utilities
  /layout/     # Global: universal-header, sidebar-navigation
  /pages/      # Page-specific global styles (legacy)
```

**CSS Module Usage:**
```typescript
import styles from './ComponentName.module.css';

const Component = () => (
  <div className={styles.container}>
    <button className={styles.primaryButton}>Click</button>
  </div>
);
```

---

## TypeScript Configuration

### Dual Config Setup
- **`tsconfig.json`** - Backend (Node.js/Express)
- **`tsconfig.frontend.json`** - Frontend (React/Vite)

### Strict Mode Status
| Config | strict | noImplicitAny | Status |
|--------|--------|---------------|--------|
| Frontend | `true` | `true` | Full strict mode |
| Backend | `true` | `true` | Full strict mode |

### Key Compiler Options
```json
{
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "esModuleInterop": true,
  "skipLibCheck": true
}
```

### Type Import Conventions
```typescript
// Use type-only imports for types
import type { Patient, Appointment } from '../types';

// Regular imports for values
import { formatDate, formatCurrency } from '../utils/formatters';
```

---

## Critical Patterns

### Navigation - React Router ONLY

**NEVER use `window.location.href` for internal routes.**

```typescript
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

```typescript
import { useToast } from '../contexts/ToastContext';
const toast = useToast();

toast.success('Saved!');
toast.error('Failed');
toast.warning('Check input');
toast.info('Processing...');

// Non-React: window.toast?.success('Done!');
```

### Winston Logging

**Never use `console.log()` in production.** Use Winston:

```typescript
import { log } from '../utils/logger';

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

Constants in `services/messaging/websocket-events.ts`.

### React Component Typing

```typescript
// Props interface
interface PatientCardProps {
  patient: Patient;
  onSelect: (id: number) => void;
  isActive?: boolean;
}

// Functional component
const PatientCard: React.FC<PatientCardProps> = ({ patient, onSelect, isActive = false }) => {
  // ...
};

// Event handlers
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  // ...
};
```

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
# Patient (RESTful)
GET /api/patients/:personId/info
GET /api/patients/:personId
GET /api/patients/:personId/timepoints
GET /api/patients/:personId/timepoints/:tp/images
GET /api/patients/:personId/gallery/:tp
GET /api/patients/:personId/alerts
GET /api/patients/:personId/has-appointment
GET /api/patients/search?q=...
GET /api/patients/phones
GET /api/patients/tag-options

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

**Connection Details (from .mcp.json):**
- Server: `Clinic\DOLPHIN`
- Port: 1433
- User: `Staff`
- Password: `ortho2000`
- Database: `ShwanNew`

Key tables: `tblpatients`, `tblappointments`, `tblwork`, `tblVisits`, `tblWires`, `tblInvoice`, `tblExpenses`, `tblUsers`

Query modules in `/services/database/queries/` (all `.ts` files).

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

- **Full TypeScript** - Both backend and frontend
- ES Modules (`"type": "module"`)
- Graceful shutdown for all services
- Circuit breaker pattern for messaging
- Cross-platform paths (Windows/WSL auto-conversion)
- RTL support for Kurdish/Arabic
- Vite handles `.tsx` compilation for frontend
- `tsx` or `ts-node` for backend development

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

**CSS Modules Rules:**
- Use CSS Modules (`.module.css`) for component styles
- Import as `import styles from './Component.module.css'`
- Use `className={styles.className}` syntax
- Use `clsx` or template literals for conditional classes
- Global variables from `variables.css` work in modules
- NO inline styles (except dynamic values)
- NO `!important` (except print/accessibility)
- camelCase class names recommended (e.g., `.primaryButton`)
