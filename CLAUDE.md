# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Shwan Orthodontics Management System** is a comprehensive, enterprise-grade orthodontic practice management platform built with Node.js, Express, and React 19. This application handles the complete patient lifecycle from registration through treatment completion, with advanced features for aligner management, multi-channel patient communication, and financial tracking.

### Core Capabilities

**Patient Management**: Complete patient lifecycle including registration, demographic data, contact management, treatment history, photo/x-ray imaging with time-point organization, and WebCeph integration for cephalometric analysis.

**Orthodontic Treatment**: Interactive dental chart (Palmer notation), wire tracking (upper/lower arch), visit recording with treatment notes, appliance/bracket tracking, treatment planning, progress monitoring with photo milestones, CS Imaging integration, and Dolphin Imaging integration with automatic patient folder configuration.

**Aligner Management**: Comprehensive aligner case management including doctor/partner registration, aligner set lifecycle tracking, batch management, payment tracking, activity logging, doctor communication with notes, and PDF case plan storage via Google Drive integration.

**Appointment System**: Monthly/weekly calendar views, daily appointment dashboard, real-time check-in workflow (Scheduled → Present → Seated → Dismissed), appointment types/categories, and WebSocket-powered live updates.

**Multi-Channel Messaging**: WhatsApp integration (Web.js) with QR authentication, SMS via Twilio, Telegram bot integration, bulk appointment reminders, message status tracking (sent/delivered/read), media sending (photos/x-rays/receipts), and circuit breaker pattern for resilience.

**Financial Management**: Multi-currency payment processing with exchange rates, invoice generation, receipt printing, payment history tracking, outstanding balance calculations, treatment cost management, and daily financial reports.

**Expense Tracking**: Expense recording with categories/subcategories, multi-currency support, date range filtering, category-based analysis, and expense totals reporting.

**Document Templates**: Visual template designer powered by GrapesJS, custom receipt/invoice/prescription templates, drag-and-drop editor, HTML/CSS editing, and template preview.

**Real-Time Features**: WebSocket-based live updates for appointments, messaging status, patient data sync, connection health monitoring, and progress indicators for batch operations.

**System Administration**: Role-based access control (Admin/Secretary/Doctor/Staff), employee management, database configuration and backup, system health monitoring, and application lifecycle control.

### Technology Stack

- **Backend**: Node.js, Express, SQL Server (Tedious), WebSocket, Multer (file uploads)
- **Frontend**: React 19, React Router v7, Vite, GrapesJS, Chart libraries
- **External Services**: WhatsApp Web.js, Twilio SMS, Telegram Bot API, Google OAuth/Drive, WebCeph
- **Architecture**: Single-page application (SPA), RESTful API, real-time WebSocket communication, connection pooling, circuit breaker pattern

### Application Scale

- **150+ Features** across 18 major categories
- **100+ API Endpoints** for comprehensive data operations
- **40+ React Components** for modular UI
- **45 CSS Files** (~25,576 lines) with custom design system
- **31 Frontend Routes** with Data Router loaders (5 phases)
- **7 Route Loaders** with smart caching for optimized data fetching
- **18+ Backend API Routes** with organized query modules
- **20+ Database Tables** for complete data modeling

### Navigation Patterns

**This application uses React Router v7 for all internal navigation. NEVER use `window.location.href` for internal routes.**

**Internal Navigation** - Use React Router exclusively:
- `useNavigate()` hook for programmatic navigation
- `<Link>` component for declarative navigation
- Route loaders for auth checks and data prefetching
- Native scroll restoration (automatic via React Router)

**External Navigation** - Use `window.location.href` ONLY for:
- External URLs (third-party websites, imaging systems)
- System protocol handlers (`explorer:`, `csimaging:`, etc.)
- Security logout (clearing React state intentionally)
- Route loader 401 redirects (established auth pattern)

**Example (Correct):**
```javascript
import { useNavigate } from 'react-router-dom';

function MyComponent() {
  const navigate = useNavigate();

  return (
    <button onClick={() => navigate('/patient/123/works')}>
      View Patient
    </button>
  );
}
```

**Example (Incorrect):**
```javascript
// ❌ WRONG - Causes full page reload, loses React state, bypasses route loaders
<button onClick={() => window.location.href = '/patient/123/works'}>
  View Patient
</button>
```

**Benefits of using React Router navigation:**
- ⚡ Instant transitions (no page reload)
- 🔄 Automatic scroll restoration
- 📦 Route loader caching works correctly
- 🔌 WebSocket connections remain stable
- 🎯 Browser back/forward work seamlessly

## MCP Servers

This project uses Model Context Protocol (MCP) servers to enable AI-assisted development:

- **MSSQL MCP Server** (`@wener/mssql-mcp`) - Provides direct database access for schema exploration, queries, and data analysis
- **React MCP Server** - Assists with React component development

Configuration is in `.mcp.json`. See `docs/mcp-mssql-setup.md` for MSSQL MCP server usage.

## Core Commands

### Development
- **Development Mode**: `npm run dev` - Runs Vite dev server (port 5173) + Express API (port 3001)
- **Backend Only**: `npm run dev:server` - Express server only (port 3001)
- **Frontend Only**: `npm run dev:client` - Vite dev server only (port 5173)

### Production
- **Build Application**: `npm run build` - Builds optimized production bundle to `/dist`
- **Start Production**: `npm start` or `node index.js` - Serves built app from `/dist` (port 3000)
- **Preview Build**: `npm run preview` - Preview production build locally

### Windows Service
- **Install as Service**: `npm run service:install`
- **Uninstall Service**: `npm run service:uninstall`

### Testing
- **Run Tests**: No test framework configured yet

## Architecture Overview

### Backend Structure
- **Entry Point**: `index.js` - Main server with enhanced startup, health monitoring, and graceful shutdown
- **Configuration**: Environment-based config in `/config/` with database and service credentials
- **Database**: SQL Server via Tedious with connection pooling (`services/database/ConnectionPool.js`)
- **Messaging Services**: 
  - WhatsApp Web.js client with persistent authentication (`services/messaging/whatsapp.js`)
  - SMS via Twilio (`services/messaging/sms.js`)
  - Telegram Bot API (`services/messaging/telegram.js`)
- **State Management**: Centralized state manager (`services/state/StateManager.js`) with message state tracking
- **WebSocket**: Real-time communication for messaging status updates and patient loading events

### Key Services
- **ResourceManager**: Handles application lifecycle and cleanup
- **HealthCheck**: Application monitoring and status endpoints
- **TransactionManager**: Database transaction handling with rollback capability
- **QR Code Generation**: For WhatsApp authentication and patient records

### Frontend Structure
- **Architecture**: **Modern React Single-Page Application with Data Router** ✨
  - **Framework**: React 19 with React Router v7 Data Router (createBrowserRouter)
  - **Entry Point**: Single HTML file (`/public/index.html`) - loads once, never reloads
  - **Routing**: React Router v7 Data Router with route loaders, actions, and error boundaries
  - **State**: React Context API for shared state management
  - **Loading**: ESM imports from CDN (esm.sh) for core libraries, Vite bundling for application code
  - **Build Tool**: Vite for fast development and optimized production builds

- **Application Structure** (`/public/js/`):
  - `App.jsx` - Main application component with RouterProvider
  - `router/routes.config.jsx` - **Centralized route configuration** (31 routes)
  - `router/loaders.js` - Route loaders for optimized data fetching
  - `layouts/` - Layout components (RootLayout, AlignerLayout)
  - `routes/` - Route components for each section of the application
  - `components/react/` - Reusable React components
  - `components/error-boundaries/` - Error boundary components
  - `services/` - Shared utilities (WebSocket, API client, storage)
  - `hooks/` - Custom React hooks for shared logic

- **Routing Architecture** (`/public/js/router/`):
  - `routes.config.jsx` - **Single source of truth for all routes**
  - `loaders.js` - Route loaders with caching and error handling
  - **31 Routes Organized in 5 Phases**:
    - **Phase 1**: Simple routes (Dashboard, Statistics, Expenses, PatientManagement, TestCompiler)
    - **Phase 2**: Settings & Templates with loaders (3 nested routes)
    - **Phase 3**: Aligner Management with layout wrapper (6 nested routes)
    - **Phase 4**: Patient Portal with comprehensive loader (14 nested pages via wildcard routing)
    - **Phase 5**: Messaging & Appointments (5 WebSocket-heavy routes, no loaders)

- **Route Loaders** (`/public/js/router/loaders.js`):
  - `apiLoader()` - Base loader with 401 handling and sessionStorage caching
  - `templateListLoader()` - Pre-fetch template list
  - `templateDesignerLoader()` - Pre-fetch template for editing
  - `alignerDoctorsLoader()` - Pre-fetch doctors list
  - `alignerPatientWorkLoader()` - Pre-fetch patient + work details
  - `patientShellLoader()` - **Most complex**: Pre-fetch patient, work, timepoints in parallel

- **Layout Components** (`/public/js/layouts/`):
  - `RootLayout.jsx` - Wraps all routes with GlobalStateProvider, ToastProvider, UniversalHeader
  - `AlignerLayout.jsx` - Aligner-specific layout with mode toggle and <Outlet />

- **Error Boundaries** (`/public/js/components/error-boundaries/`):
  - `GlobalErrorBoundary.jsx` - App-level error catching
  - `RouteErrorBoundary.jsx` - Route-level error catching with recovery
  - `RouteError.jsx` - User-friendly error pages (404, 401, 500)

- **Route Components** (`/public/js/routes/`):
  - `Dashboard.jsx` - Navigation hub and landing page
  - `PatientManagement.jsx` - Patient search and grid view
  - `Expenses.jsx` - Expense management
  - `Statistics.jsx` - Financial statistics and reports
  - `WhatsAppSend.jsx` - WhatsApp messaging
  - `WhatsAppAuth.jsx` - WhatsApp authentication
  - `DailyAppointments.jsx` - Daily appointments view
  - `Calendar.jsx` - Monthly calendar view
  - `CompilerTest.jsx` - Template compiler test page

- **React Components** (`/public/js/components/react/`):
  - `UniversalHeader.jsx` - Persistent header with patient search
  - `PatientShell.jsx` - Patient portal wrapper with sidebar navigation (handles 14 pages)
  - `SettingsComponent.jsx` - Settings interface with tabs
  - `PaymentModal.jsx` - Payment processing modal
  - `EditPatientComponent.jsx` - Patient information editor
  - And many more specialized components

- **Services Layer** (`/public/js/services/`):
  - `websocket.js` - **WebSocket singleton** for real-time updates
  - `http.js` - HTTP client for API requests
  - `storage.js` - Local storage utilities

- **Hooks** (`/public/js/hooks/`): Custom hooks for shared logic (WebSocket sync, message status, etc.)

- **Context Providers** (`/public/js/contexts/`):
  - `GlobalStateContext.jsx` - Global state for **WebSocket singleton**, patient data, appointments
  - `ToastContext.jsx` - **Unified toast notification system** (replaces all alert() calls)

### Toast Notification System

The application uses a **unified toast notification system** to provide modern, non-blocking user feedback throughout the entire application. This system completely replaces traditional `alert()` dialogs.

**Implementation:**
- **Context Provider**: `ToastContext.jsx` - Global toast management
- **CSS Styles**: `public/css/components/toast.css` - Modern, responsive toast styles
- **Global Integration**: Wrapped in `App.jsx` via `<ToastProvider>` for app-wide access
- **Non-React Support**: Global `window.toast` object for use in non-React code

**Usage in React Components:**
```javascript
import { useToast } from '../contexts/ToastContext.jsx';

function MyComponent() {
  const toast = useToast();

  // Success notification (green, 3s duration)
  toast.success('Operation completed successfully!');

  // Error notification (red, 4s duration)
  toast.error('Something went wrong!');

  // Warning notification (orange, 3.5s duration)
  toast.warning('Please check your input');

  // Info notification (blue, 3s duration)
  toast.info('Here is some information');

  // Custom duration
  toast.success('Custom message', 5000); // 5 seconds
}
```

**Usage in Non-React JavaScript:**
```javascript
// Available globally after ToastProvider mounts
window.toast?.success('Operation completed!');
window.toast?.error('Error occurred!');
window.toast?.warning('Warning message!');
window.toast?.info('Info message!');
```

**Toast Types:**
- **Success** (✓) - Green, for successful operations (saves, deletes, updates)
- **Error** (✕) - Red, for errors and failures
- **Warning** (⚠) - Orange, for validation warnings and user constraints
- **Info** (ℹ) - Blue, for informational messages

**Features:**
- ✅ Auto-dismiss with configurable duration
- ✅ Manual close button
- ✅ Smooth slide-in/slide-out animations
- ✅ Stacked notifications (multiple toasts simultaneously)
- ✅ Non-blocking (doesn't interrupt user workflow)
- ✅ Fully responsive (mobile, tablet, desktop)
- ✅ RTL support for Kurdish/Arabic languages
- ✅ Accessible (ARIA labels, keyboard support)

**Migration from alert():**
All `alert()` calls have been replaced with appropriate toast notifications throughout the application. The global `window.toast` object ensures backward compatibility for non-React code.

**Key Features:**
- ✅ **Data Router Architecture**: Route loaders eliminate loading flashes (33% faster on patient pages)
- ✅ **No page reloads**: Instant navigation between routes
- ✅ **Route Loaders**: Pre-fetch static data before rendering (patient info, settings, work details)
- ✅ **Native Scroll Restoration**: Automatic scroll position management
- ✅ **Two-Level Error Handling**: Global + route-level error boundaries with recovery options
- ✅ **Persistent WebSocket Singleton**: Real-time updates for appointments, messaging, patient data
- ✅ **Smart Caching**: 5-minute sessionStorage cache for static data with automatic invalidation
- ✅ **Hybrid Data Strategy**: Loaders for static/cacheable data, components for real-time/WebSocket data
- ✅ **Layout Wrappers**: Persistent UI elements (headers, mode toggles) with <Outlet /> pattern
- ✅ **Lazy Loading**: Code splitting with React.lazy() for optimal bundle sizes
- ✅ **CDN-loaded core libraries**: React, Router from CDN for optimal caching
- ✅ **Vite build system**: Fast development and optimized production builds
- ✅ **Native app-like experience**: Smooth transitions, no loading flashes
- ✅ **React Context API**: State sharing across components
- ✅ **Server-side rendering ready**: All routes served from Express

## Environment Variables Required

Essential for database connectivity:
- `DB_SERVER`, `DB_INSTANCE`, `DB_USER`, `DB_PASSWORD`
- `MACHINE_PATH` - File system path for patient images
- `PORT` - Server port (3001 in development via `.env.development`, 3000 in production by default)

Optional service integrations:
- `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NAME`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `QR_HOST_URL`

Sync system configuration (Supabase):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `REVERSE_SYNC_ENABLED` - Enable/disable reverse sync (default: true)
- `REVERSE_SYNC_INTERVAL_MINUTES` - Polling interval (default: 60 minutes)
- `REVERSE_SYNC_LOOKBACK_HOURS` - Startup lookback window (default: 24 hours)
- `REVERSE_SYNC_MAX_RECORDS` - Max records per poll (default: 500)

See `docs/REVERSE_SYNC_CONFIGURATION.md` for detailed sync configuration guide.

## Key API Patterns

### Patient Data
- Patient info: `GET /api/getinfos?code={patientId}`
- Time points: `GET /api/gettimepoints?code={patientId}`
- Payments: `GET /api/getpayments?code={patientId}`

### Messaging System
- WhatsApp send: `GET /api/wa/send?date={date}`
- WhatsApp status: `GET /api/wa/status`
- Message updates: `GET /api/update` (polling-based status)

### Health Monitoring
- Basic health: `GET /health/basic`
- Detailed health: `GET /api/health/detailed`

## Database Queries Structure

Located in `/services/database/queries/`:
- **Patient queries**: Patient info, payments, visit history
- **Messaging queries**: Message status tracking with circuit breaker pattern
- **Appointment queries**: Scheduling and notification data
- **Visit queries**: Treatment records and wire tracking

## Windows Service Management

The application can run as a Windows service using `node-windows`. Service scripts are in `/utils/windows-service/` with CLI management tools.

## WebSocket Events

The application uses a **universal naming convention** for WebSocket events to ensure consistency across frontend and backend communication. 

### Universal Event Categories:

**Connection Events:**
- `connection_established` / `connection_lost` / `connection_error`
- `heartbeat_ping` / `heartbeat_pong` - Connection health monitoring

**Appointment System:**
- `appointments_updated` / `appointments_data` - Appointment updates
- `request_appointments` - Client requests appointment data

**Patient Management:**
- `patient_loaded` / `patient_unloaded` - Patient screen management  
- `patient_data` / `request_patient` - Patient data exchange

**WhatsApp Messaging:**
- `whatsapp_client_ready` / `whatsapp_qr_updated` - Client status
- `whatsapp_message_status` / `whatsapp_message_batch_status` - Message tracking
- `whatsapp_initial_state_response` - Initial state for status clients

**System Events:**
- `system_error` / `data_updated` / `broadcast_message` - General system events

### Clean Implementation:
All WebSocket events use the universal naming convention exclusively. No legacy events are supported, ensuring clean and consistent code throughout the application.

**Key Files:**
- `services/messaging/websocket-events.js` - Universal event constants
- `docs/websocket-events.md` - Complete documentation

## Cross-Platform Path Configuration

The application now supports both Windows and WSL environments with automatic path conversion:

### Automatic Detection
- **WSL**: Detected when running on Linux with `WSL_DISTRO_NAME` environment variable
- **Windows**: Detected when running on Windows (`win32` platform)

### Path Examples
- **Windows UNC**: `\\\\server\\share\\folder` → `/mnt/server/share/folder` (WSL)
- **Windows Drive**: `C:\\folder` → `/mnt/c/folder` (WSL)
- **WSL Mount**: `/mnt/server/share/folder` → `\\\\server\\share\\folder` (Windows)

### Environment Configuration
Set `MACHINE_PATH` to your network path:
- **Windows**: `\\\\your-server\\clinic1` or `C:\\clinic1`
- **WSL**: `/mnt/your-server/clinic1` or `/mnt/c/clinic1`

### Port Configuration

The application uses environment-specific port configuration:

**Development Mode** (`npm run dev`):
- Backend (Express): **Port 3001**
- Frontend (Vite): **Port 5173**
- Configuration: `.env.development` sets `PORT=3001`
- Vite proxies API requests to `http://localhost:3001`

**Production Mode** (`npm start`):
- Backend (Express): **Port 3000** (default)
- No Vite - Express serves built files from `/dist`
- Configuration: Falls back to default port 3000 if `PORT` is not set in `.env`

**Custom Port Override**:
You can override the port by setting the `PORT` environment variable:
```bash
# Development
export PORT=8080  # Add to .env.development

# Production
export PORT=8080  # Add to .env or set in environment
```

**Configuration Files**:
- `.env` - Production settings (shared configuration)
- `.env.development` - Development-specific overrides (PORT=3001, VITE_DEV_PORT=5173)
- `config/config.js` - Loads environment-specific files based on NODE_ENV

## Development Notes

- Uses ES modules (`"type": "module"` in package.json)
- No formal test framework currently configured
- Graceful shutdown handling for all services
- Circuit breaker pattern for messaging resilience
- Connection pooling for database operations
- Cross-platform file system integration with automatic path conversion

---

## CSS Styling Guidelines

**CRITICAL**: This project uses a custom CSS architecture with strict guidelines. See `css-styling-guidelines.skill.md` for comprehensive documentation.

### Absolute Rules - NEVER VIOLATE

#### ❌ NO Inline Styles

**NEVER use inline styles in JSX/HTML** except for these rare exceptions:

**✅ ONLY Allowed Exceptions:**
1. **Dynamic runtime values** that cannot be predetermined:
   ```javascript
   // ✅ ALLOWED: Value calculated at runtime
   style={{ height: `${calculatedHeight}px`, top: `${position.y}px` }}
   ```

2. **Dynamic positioning** for tooltips, popovers, drag-drop:
   ```javascript
   // ✅ ALLOWED: Mouse-based positioning
   style={{ position: 'absolute', left: mouseX, top: mouseY }}
   ```

**❌ FORBIDDEN: Static styles**
```javascript
// ❌ WRONG: This should be a CSS class
style={{ padding: '20px', background: '#f8f9fa', borderRadius: '8px' }}

// ✅ CORRECT: Use CSS class from appropriate file
className="card-container"
```

#### ❌ NO !important Declarations

**NEVER use `!important` in CSS** except for these specific cases:

**✅ ONLY Allowed Exceptions:**
1. **Print styles** (forcing layouts for printing)
   ```css
   @media print {
     .no-print { display: none !important; }
   }
   ```

2. **Accessibility overrides** (user preferences must take precedence)
   ```css
   @media (prefers-reduced-motion: reduce) {
     * { animation: none !important; }
   }
   ```

3. **Third-party library overrides** (only when no alternative exists - must be documented)
   ```css
   /* Document why !important is needed */
   .photoswipe-override {
     z-index: var(--z-index-modal) !important; /* Override PhotoSwipe default */
   }
   ```

**❌ FORBIDDEN: Using !important for convenience**
```css
/* ❌ WRONG: Lazy override */
.text-red { color: red !important; }

/* ✅ CORRECT: Increase specificity properly */
.error-message .text-red { color: var(--error-color); }
```

### CSS Architecture

**File Structure** (`/public/css/`):
```
├── main.css                    # Entry point - imports all modules
├── base/
│   ├── variables.css           # Design tokens (ALWAYS use these)
│   ├── reset.css               # CSS reset/normalize
│   ├── typography.css          # Font styles
│   └── rtl-support.css         # RTL language support (Kurdish/Arabic)
├── components/                 # Reusable component styles (18 files)
│   ├── buttons.css
│   ├── universal-header.css
│   ├── sidebar-navigation.css
│   └── [15 more files...]
└── pages/                      # Page-specific styles (22 files)
    ├── dashboard.css
    ├── patient-shell.css
    └── [20 more files...]
```

**Where to Add New Styles:**

1. **Reusable component** → `/css/components/{component-name}.css`
2. **Page-specific** → `/css/pages/{page-name}.css`
3. **Base styles** (typography, button variants) → `/css/base/{category}.css`
4. **Utility classes** → `/css/main.css`

### Design System - ALWAYS Use These Variables

**From `/public/css/base/variables.css`:**

**Colors** (NEVER hardcode colors):
```css
--primary-color: #007bff
--secondary-color: #4CAF50
--accent-color: #55608f
--success-color: #28a745
--error-color: #dc3545
--warning-color: #ffc107
--info-color: #17a2b8
--background-primary: #ffffff
--background-secondary: #f8f9fa
--text-primary: #212529
--text-secondary: #6c757d
--border-color: #dee2e6

/* ❌ WRONG */
.card { background: #f8f9fa; }

/* ✅ CORRECT */
.card { background: var(--background-secondary); }
```

**Spacing** (NEVER hardcode pixel values):
```css
--spacing-xs: 0.25rem   /* 4px */
--spacing-sm: 0.5rem    /* 8px */
--spacing-md: 1rem      /* 16px */
--spacing-lg: 1.5rem    /* 24px */
--spacing-xl: 2rem      /* 32px */
--spacing-xxl: 3rem     /* 48px */

/* ❌ WRONG */
.card { padding: 20px; margin-bottom: 16px; }

/* ✅ CORRECT */
.card {
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
}
```

**Border Radius**:
```css
--radius-sm: 0.125rem   /* 2px */
--radius-md: 0.25rem    /* 4px */
--radius-lg: 0.5rem     /* 8px */
--radius-xl: 1rem       /* 16px */
--radius-full: 9999px   /* Fully rounded */
```

**Shadows**:
```css
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl
```

**Typography**:
```css
--font-primary: system-ui, -apple-system, BlinkMacSystemFont...
--font-size-xs: 0.75rem    /* 12px */
--font-size-sm: 0.875rem   /* 14px */
--font-size-base: 1rem     /* 16px */
--font-size-lg: 1.125rem   /* 18px */
--font-size-xl: 1.25rem    /* 20px */
--font-size-2xl: 1.5rem    /* 24px */
--font-size-3xl: 1.875rem  /* 30px */
```

**Z-Index Layers** (prevents z-index conflicts):
```css
--z-index-dropdown: 1000
--z-index-sticky: 1020
--z-index-fixed: 1030
--z-index-modal: 1040
--z-index-popover: 1050
--z-index-tooltip: 1060

/* ❌ WRONG */
.modal { z-index: 9999; }

/* ✅ CORRECT */
.modal { z-index: var(--z-index-modal); }
```

### Naming Conventions

**Use BEM-like methodology:**

```css
/* Component block */
.patient-card { }

/* Element within block */
.patient-card__header { }
.patient-card__body { }
.patient-card__footer { }

/* Modifier for state/variant */
.patient-card--highlighted { }
.patient-card--disabled { }
```

**State classes:**
- `.active` - Currently active item
- `.disabled` - Disabled state
- `.loading` - Loading state
- `.error` - Error state
- `.success` - Success state
- `.hidden` - Hidden state

### Responsive Design - Mobile-First

**ALWAYS write mobile-first styles:**

```css
/* ✅ CORRECT: Mobile-first */
.container {
  padding: var(--spacing-sm);  /* Mobile: small padding */
}

@media (min-width: 768px) {
  .container {
    padding: var(--spacing-lg);  /* Tablet+: larger padding */
  }
}

@media (min-width: 1024px) {
  .container {
    padding: var(--spacing-xl);  /* Desktop: extra padding */
  }
}
```

**Breakpoints** (from variables.css):
```css
--breakpoint-xs: 375px   /* Small phones */
--breakpoint-sm: 480px   /* Phones */
--breakpoint-md: 768px   /* Tablets */
--breakpoint-lg: 1024px  /* Desktops */
--breakpoint-xl: 1400px  /* Large screens */
```

**Common media queries:**
```css
@media (max-width: 1024px) { /* Tablet and below */ }
@media (max-width: 768px) { /* Phone and below */ }
@media (max-width: 480px) { /* Small phones */ }
@media (orientation: landscape) { /* Landscape mode */ }
@media (hover: none) and (pointer: coarse) { /* Touch devices */ }
```

### RTL (Right-to-Left) Support

**The project has full RTL support for Kurdish/Arabic languages.**

**Use logical properties:**

```css
/* ❌ AVOID: Directional properties */
.card {
  margin-left: var(--spacing-md);
  text-align: left;
}

/* ✅ PREFER: Logical properties */
.card {
  margin-inline-start: var(--spacing-md);
  text-align: start;
}

/* OR use RTL selector: */
.card {
  margin-left: var(--spacing-md);
}

[dir="rtl"] .card {
  margin-left: 0;
  margin-right: var(--spacing-md);
}
```

### Best Practices Checklist

**Before writing any styles:**

- [ ] Check if a class already exists (search CSS files first)
- [ ] Use CSS variables for colors, spacing, typography
- [ ] Add styles to the appropriate file (component/page/base)
- [ ] Follow BEM-like naming conventions
- [ ] NO inline styles (except dynamic runtime values)
- [ ] NO !important (except print/accessibility)
- [ ] Write mobile-first responsive CSS
- [ ] Consider RTL support for text-heavy components
- [ ] Test on multiple screen sizes (375px, 768px, 1024px+)

### Common Patterns

**Button:**
```css
/* In /css/components/buttons.css */
.btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}
```

**Card:**
```css
/* In /css/components/ or /css/pages/ */
.card {
  background: var(--background-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
}

.card__header {
  margin-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: var(--spacing-md);
}
```

**Modal:**
```css
/* In /css/components/modal.css */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content {
  background: var(--background-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xl);
  max-width: 600px;
  width: 90%;
  box-shadow: var(--shadow-xl);
}
```

### Quick Reference

**For comprehensive CSS guidelines**, see `css-styling-guidelines.skill.md`.

**Key design system file**: `/public/css/base/variables.css`

**Key rules:**
1. ✅ CSS classes only - No inline styles except dynamic values
2. ✅ No !important - Except print/accessibility
3. ✅ CSS variables always - From variables.css
4. ✅ Mobile-first responsive - Start small, scale up
5. ✅ BEM-like naming - Consistent, semantic class names
6. ✅ Appropriate file location - Components, pages, or base
7. ✅ RTL support - Use logical properties or RTL selectors