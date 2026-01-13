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
- **Backend**: Node.js, Express 5.1, **TypeScript 5.9**, SQL Server (Tedious 18), WebSocket (ws 8)
- **Frontend**: React 19.2, **TypeScript 5.9**, React Router v7.9 (Data Router), Vite 7.2, CSS Modules
- **External**: WhatsApp Web.js, Twilio, Telegram Bot API, Google Drive, WebCeph

### Application Scale
| Metric | Count |
|--------|-------|
| React Components (TSX) | 118 |
| CSS Module Files | 57 |
| Frontend Routes | 31 |
| Route Loaders | 7 |
| Backend Route Files | 31 |
| Backend Service Files | 62 |
| Database Query Modules | 17 |
| Custom Hooks | 8 |
| Contexts | 3 |
| Type Definition Files | 8 |

---

## Commands

```bash
# Development
npm run dev              # Vite (5173) + Express (3001) concurrent
npm run dev:server       # Express only (3001)
npm run dev:client       # Vite only (5173)

# Production
npm run build            # Build client + server
npm run build:client     # Vite build to /dist
npm run build:server     # TypeScript build to /dist-server
npm start                # Serve from /dist-server (3000)

# Type Checking
npm run typecheck            # Check backend types
npm run typecheck:frontend   # Check frontend types
npm run typecheck:all        # Check both

# CSS Modules
npm run css:types        # Generate CSS module type declarations
npm run css:types:watch  # Watch mode for CSS types

# Linting & Formatting
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format all
npm run format:check     # Prettier check

# Windows Service
npm run service:install
npm run service:uninstall

# Auth Scripts
npm run auth:setup              # Initial auth setup
npm run auth:create-admin       # Create admin user
npm run auth:emergency-reset    # Reset admin password
npm run auth:migrate-roles      # Migrate to two-tier roles
```

---

## Architecture

### Backend Structure
```
index.ts                 # Entry point, server setup, graceful shutdown

/config/                 # 3 files
  config.ts              # Environment configuration
  database.ts            # Database connection config
  ssl.ts                 # SSL certificate config

/routes/                 # 31 total route files
  /api/                  # 23 modular API route files
    index.ts             # Route aggregator
    patient.routes.ts    # Patient CRUD operations
    appointment.routes.ts # Appointment management
    work.routes.ts       # Work/treatment tracking
    payment.routes.ts    # Payment processing
    visit.routes.ts      # Visit records
    aligner.routes.ts    # Aligner management
    whatsapp.routes.ts   # WhatsApp integration
    messaging.routes.ts  # Multi-channel messaging
    expense.routes.ts    # Expense tracking
    reports.routes.ts    # Report generation
    settings.routes.ts   # Application settings
    media.routes.ts      # Media file handling
    video.routes.ts      # Video content
    dolphin.routes.ts    # Dolphin integration
    lookup.routes.ts     # Lookup tables
    lookup-admin.routes.ts # Admin lookup management
    health.routes.ts     # Health checks
    holiday.routes.ts    # Holiday management
    cost-preset.routes.ts # Cost presets
    employee.routes.ts   # Employee management
    staff.routes.ts      # Staff operations
    utility.routes.ts    # Utility endpoints
  # Root-level routes (8 files)
  admin.ts               # Admin dashboard
  auth.ts                # Authentication
  calendar.ts            # Calendar operations
  email-api.ts           # Email integration
  sync-webhook.ts        # Sync webhooks
  template-api.ts        # Template management
  user-management.ts     # User CRUD
  web.ts                 # Static file serving

/services/               # 62 files across 15 subdirectories
  /business/             # 8 business logic services
    PatientService.ts
    AppointmentService.ts
    AlignerService.ts
    AlignerPdfService.ts
    WorkService.ts
    PaymentService.ts
    MessagingService.ts
    FinancialReportService.ts
  /database/             # Database layer
    index.ts             # Database exports
    ConnectionPool.ts    # Connection pooling
    /queries/            # 17 query modules
      patient-queries.ts
      appointment-queries.ts
      work-queries.ts
      visit-queries.ts
      payment-queries.ts
      expense-queries.ts
      aligner-queries.ts
      alert-queries.ts
      timepoint-queries.ts
      template-queries.ts
      messaging-queries.ts
      options-queries.ts
      lookup-admin-queries.ts
      holiday-queries.ts
      cost-preset-queries.ts
      dolphin-queries.ts
      video-queries.ts
  /messaging/            # 9 messaging files
    index.ts
    whatsapp.ts          # WhatsApp Web.js client
    whatsapp-api.ts      # WhatsApp API variant
    sms.ts               # Twilio SMS
    telegram.ts          # Telegram bot
    websocket-events.ts  # WebSocket event constants
    schemas.ts           # Message schemas
    MessageSession.ts    # Session management
    MessageSessionManager.ts
  /sync/                 # 4 sync engine files
    sync-engine.ts
    queue-processor.ts
    reverse-sync-poller.ts
    unified-sync-processor.ts
  /authentication/       # 1 file
    google.ts            # Google OAuth
  /config/               # 3 files
    index.ts
    DatabaseConfigService.ts
    EnvironmentManager.ts
  /core/                 # 3 files
    index.ts
    Logger.ts
    ResourceManager.ts
  /email/                # 1 file
    email-service.ts
  /google-drive/         # 2 files
    drive-upload.ts
    google-drive-client.ts
  /imaging/              # 2 files
    index.ts
    qrcode.ts
  /monitoring/           # 2 files
    index.ts
    HealthCheck.ts
  /pdf/                  # 2 files
    aligner-label-generator.ts
    appointment-pdf-generator.ts
  /state/                # 4 files
    index.ts
    StateManager.ts
    messageState.ts
    stateEvents.ts
  /templates/            # 1 file
    receipt-service.ts
  /webceph/              # 1 file
    webceph-service.ts

/middleware/             # 5 files
  index.ts
  auth.ts
  timeout.ts
  upload.ts
  time-based-auth.ts

/utils/                  # 7 files
  logger.ts              # Winston logger
  websocket.ts           # WebSocket server
  path-resolver.ts       # Cross-platform paths
  phoneFormatter.ts      # Phone number formatting
  filename-converter.ts  # Filename utilities
  youtube-validator.ts   # YouTube URL validation
  error-response.ts      # Error response helpers

/types/                  # 8 type definition files
  index.ts               # Re-exports all types
  api.types.ts           # API request/response types
  config.types.ts        # Configuration types
  database.types.ts      # Database entity types
  services.types.ts      # Service layer types
  websocket.types.ts     # WebSocket event types
  express-session.d.ts   # Express session augmentation
  modules.d.ts           # Module declarations
```

### Frontend Structure
```
/public/js/
  App.tsx                # Root component with RouterProvider

  /router/
    routes.config.tsx    # 31 routes in 5 categories
    loaders.ts           # 7 route loaders with caching

  /layouts/              # 2 layout components
    RootLayout.tsx       # Main application wrapper
    AlignerLayout.tsx    # Aligner section wrapper

  /routes/               # 9 route components
    Dashboard.tsx
    DailyAppointments.tsx
    Calendar.tsx
    PatientManagement.tsx
    Statistics.tsx
    Expenses.tsx
    Videos.tsx
    WhatsAppAuth.tsx
    WhatsAppSend.tsx

  /pages/                # 7 page components
    Diagnosis.tsx
    statistics.tsx
    /aligner/
      DoctorsList.tsx
      PatientsList.tsx
      PatientSets.tsx
      SearchPatient.tsx
      AllSetsList.tsx

  /components/           # 100 component files
    /react/              # 64 main components
    /react/appointments/ # 8 appointment components
    /error-boundaries/   # 4 error boundary components
    /expenses/           # 6 expense components
    /templates/          # 7 template components
    /whatsapp-auth/      # 6 WhatsApp auth components
    /whatsapp-send/      # 5 WhatsApp send components

  /contexts/             # 3 context providers
    GlobalStateContext.tsx
    PrintQueueContext.tsx
    ToastContext.tsx

  /hooks/                # 8 custom hooks
    useAppointments.ts
    useDateManager.ts
    useExpenses.ts
    useMessageCount.ts
    useMessageStatus.ts
    useWebSocketSync.ts
    useWhatsAppAuth.ts
    useWhatsAppWebSocket.ts

  /services/             # 3 service files
    websocket.ts         # WebSocket singleton
    websocket-connection-manager.ts
    appointment.ts

  /utils/                # 4 utility files
    formatters.ts        # Date/currency/text formatting
    whatsapp-api-client.ts
    whatsapp-send-constants.ts
    whatsapp-validation.ts

  /core/                 # 7 core utility files
    dom.ts               # DOM manipulation
    events.ts            # Event handling
    fileSystemAccess.ts  # File System Access API
    http.ts              # HTTP client
    iniParser.ts         # INI file parser
    storage.ts           # Storage utilities
    utils.ts             # General utilities

  /config/               # 2 config files
    environment.ts
    workTypeConfig.ts

  /constants/            # 1 constants file
    websocket-events.ts
```

### CSS Structure

**Component styles use CSS Modules** (`.module.css`) for scoped styling:
```
/public/js/
  components/react/*.module.css      # 36 component modules
  components/react/appointments/     # 8 appointment modules
  components/templates/              # 2 template modules
  routes/                            # 5 route modules
  pages/                             # 1 page module
  pages/aligner/                     # 4 aligner page modules
  layouts/                           # 1 layout module

/public/css/                         # Global styles (20 files)
  /base/                             # 5 foundation files
    variables.css                    # CSS custom properties
    reset.css                        # CSS reset
    typography.css                   # Typography system
    rtl-support.css                  # RTL language support
    utilities.css                    # Utility classes
  /layout/                           # 2 layout files
    universal-header.css
    sidebar-navigation.css
  /components/                       # 13 shared component styles
    buttons.css
    inputs.css
    modal.css
    cards.css
    toast.css
    lookup-editor.css
    appointment-calendar.css
    calendar-holidays.css
    work-card.css
    route-error.css
    aligner-common.css
    aligner-drawer-form.css
    aligner-set-card.css
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
- **`tsconfig.build.json`** - Production build

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
  "skipLibCheck": true,
  "isolatedModules": true
}
```

### Path Aliases

**Backend (`tsconfig.json`):**
```json
{
  "@config/*": ["./config/*"],
  "@services/*": ["./services/*"],
  "@routes/*": ["./routes/*"],
  "@utils/*": ["./utils/*"],
  "@middleware/*": ["./middleware/*"],
  "@types/*": ["./types/*"]
}
```

**Frontend (`tsconfig.frontend.json`):**
```json
{
  "@/*": ["./*"],
  "@components/*": ["./components/*"],
  "@services/*": ["./services/*"],
  "@hooks/*": ["./hooks/*"],
  "@contexts/*": ["./contexts/*"],
  "@types/*": ["./types/*"]
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

## Route Loaders

7 loaders with 5-minute sessionStorage caching:

| Loader | Purpose | Route |
|--------|---------|-------|
| `patientShellLoader` | Patient + work + timepoints | `/patient/:personId/*` |
| `patientManagementLoader` | Filter data (work types, keywords, tags) | `/patient-management` |
| `dailyAppointmentsLoader` | Initial appointments for date | `/appointments` |
| `templateListLoader` | Template list | `/templates` |
| `templateDesignerLoader` | Template for editing | `/templates/designer/:id` |
| `alignerDoctorsLoader` | Doctor list | `/aligner` |
| `alignerPatientWorkLoader` | Patient + work details | `/aligner/patient/:workId` |

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
GET    /api/patients/:personId/info
GET    /api/patients/:personId
GET    /api/patients/:personId/timepoints
GET    /api/patients/:personId/timepoints/:tp/images
GET    /api/patients/:personId/gallery/:tp
GET    /api/patients/:personId/alerts
GET    /api/patients/:personId/has-appointment
GET    /api/patients/search?q=...
GET    /api/patients/phones
GET    /api/patients/tag-options

# Appointments
GET    /api/getDailyAppointments?AppsDate={date}
POST   /api/appointments
PUT    /api/appointments/:id
DELETE /api/appointments/:id

# Work
GET    /api/getworkdetails?workId={id}
GET    /api/getworktypes
GET    /api/getworkkeywords

# Messaging
GET    /api/wa/send?date={date}
GET    /api/wa/status

# Templates
GET    /api/templates
GET    /api/templates/:id
POST   /api/templates
PUT    /api/templates/:id

# Health
GET    /health/basic
GET    /api/health/detailed

# Auth
POST   /api/auth/login
GET    /api/auth/verify
POST   /api/auth/logout
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

**Key Tables:**
- `tblpatients` - Patient demographics
- `tblappointments` - Appointment scheduling
- `tblwork` - Treatment work records
- `tblVisits` - Visit history
- `tblWires` - Wire tracking
- `tblInvoice` - Invoice records
- `tblExpenses` - Expense tracking
- `tblUsers` - User accounts
- `tblAlignerDoctors` - Aligner doctors
- `tblAlignerSets` - Aligner set lifecycle

Query modules in `/services/database/queries/` (17 `.ts` files).

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

- **Full TypeScript** - Both backend and frontend with strict mode
- ES Modules (`"type": "module"`)
- Graceful shutdown for all services
- Circuit breaker pattern for messaging
- Cross-platform paths (Windows/WSL auto-conversion)
- RTL support for Kurdish/Arabic
- Vite 7.2 handles `.tsx` compilation for frontend
- `tsx` for backend development (hot reload)
- React Compiler (babel-plugin-react-compiler) enabled
- ESLint 9 + Prettier for code quality

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

---

## Key Dependencies

**Backend:**
- `express@5.1.0` - Web framework
- `tedious@18.6.1` - SQL Server client
- `ws@8.18.3` - WebSocket server
- `winston@3.18.3` - Logging
- `whatsapp-web.js@1.34.2` - WhatsApp client
- `twilio@5.10.5` - SMS service
- `node-telegram-bot-api@0.66.0` - Telegram bot
- `googleapis@166.0.0` - Google Drive API
- `pdfkit@0.17.2` - PDF generation
- `multer@2.0.2` - File uploads

**Frontend:**
- `react@19.2.0` - UI framework
- `react-router-dom@7.9.6` - Routing
- `grapesjs@0.22.13` - Visual template editor
- `chart.js@4.5.1` - Charts
- `react-select@5.10.2` - Select components
- `photoswipe@5.4.4` - Image gallery
- `date-fns@4.1.0` - Date utilities
- `classnames@2.5.1` - Class name utilities

**Dev:**
- `typescript@5.9.3` - TypeScript compiler
- `vite@7.2.2` - Build tool
- `tsx@4.21.0` - TypeScript execution
- `eslint@9.39.2` - Linting
- `prettier@3.7.4` - Formatting
