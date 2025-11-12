# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js/Express web application for **Shwan Orthodontics** - a dental practice management system with multi-channel messaging capabilities (WhatsApp, SMS, Telegram). The application manages patient records, appointments, treatment photos, payments, and provides automated messaging for appointment reminders.

## MCP Servers

This project uses Model Context Protocol (MCP) servers to enable AI-assisted development:

- **MSSQL MCP Server** (`@wener/mssql-mcp`) - Provides direct database access for schema exploration, queries, and data analysis
- **React MCP Server** - Assists with React component development

Configuration is in `.mcp.json`. See `docs/mcp-mssql-setup.md` for MSSQL MCP server usage.

## Core Commands

- **Start Application**: `node index.js`
- **Install as Windows Service**: `npm run service:install`  
- **Uninstall Windows Service**: `npm run service:uninstall`
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
- **Architecture**: **Single-SPA React Application** ✨
  - **Framework**: Single-spa orchestrating 9 independent React micro-apps
  - **Entry Point**: Single HTML file (`index-spa.html`) - loads once, never reloads
  - **Routing**: React Router at root level for seamless client-side navigation
  - **State**: Global state via Context API (`GlobalStateContext`) shared across all apps
  - **Loading**: ESM imports from CDN (esm.sh) with code splitting per app

- **Single-SPA Configuration** (`/public/single-spa/`):
  - `root-config.js` - Registers all apps and orchestrates mounting/unmounting
  - `contexts/GlobalStateContext.jsx` - Shared state (WebSocket, patient, user)

- **React Micro-Apps** (`/public/js/apps/`) - All with single-spa lifecycle:
  - `@clinic/dashboard` - Navigation hub (DashboardApp.jsx)
  - `@clinic/patient` - Patient portal with React Router (PatientApp.jsx)
  - `@clinic/expenses` - Expense management (ExpensesApp.jsx)
  - `@clinic/whatsapp-send` - WhatsApp messaging (WhatsAppSendApp.jsx)
  - `@clinic/whatsapp-auth` - WhatsApp authentication (WhatsAppAuthApp.jsx)
  - `@clinic/aligner` - Aligner management with React Router (AlignerApp.jsx)
  - `@clinic/settings` - Settings with tabs and React Router (SettingsApp.jsx)
  - `@clinic/templates` - Template designer with GrapesJS (TemplateApp.jsx)
  - `@clinic/appointments` - Daily appointments (DailyAppointmentsApp.jsx)

- **React Components** (`/public/js/components/react/`):
  - UniversalHeader - Persistent header (mounted once, never unmounts)
  - PatientManagement, PaymentModal, EditPatientComponent, etc.

- **React Pages** (`/public/js/pages/*.jsx`): Page-level components (calendar, grid, statistics, visits)

- **Services Layer** (`/public/js/services/`): Shared utilities (websocket, API client, storage)

- **Hooks** (`/public/js/hooks/`): Custom hooks for shared logic across apps

**Key Benefits of Single-SPA:**
- ✅ No page reloads - instant navigation between apps
- ✅ Persistent WebSocket connection shared across all apps
- ✅ Shared state (current patient, WebSocket, appointments cache)
- ✅ 45% reduction in network transfer (shared React/Router loaded once)
- ✅ Native app-like experience with smooth transitions
- ✅ No tab manager needed - all apps run in single page

**Migration Complete**: 100% React, Single-SPA architecture. See `docs/SINGLE_SPA_MIGRATION_PLAN.md` for migration details.

## Environment Variables Required

Essential for database connectivity:
- `DB_SERVER`, `DB_INSTANCE`, `DB_USER`, `DB_PASSWORD`
- `MACHINE_PATH` - File system path for patient images
- `PORT` - Server port (defaults to 3000)

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
The application runs on **port 3000** by default.

You can override the port by setting the `PORT` environment variable:
```bash
export PORT=8080  # Use custom port
```

## Development Notes

- Uses ES modules (`"type": "module"` in package.json)
- No formal test framework currently configured
- Graceful shutdown handling for all services
- Circuit breaker pattern for messaging resilience
- Connection pooling for database operations
- Cross-platform file system integration with automatic path conversion