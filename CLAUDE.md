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
- **Architecture**: **Modern React Single-Page Application** ✨
  - **Framework**: React 19 with React Router for client-side routing
  - **Entry Point**: Single HTML file (`/public/index.html`) - loads once, never reloads
  - **Routing**: React Router v7 with nested routes for seamless navigation
  - **State**: React Context API for shared state management
  - **Loading**: ESM imports from CDN (esm.sh) for core libraries, Vite bundling for application code
  - **Build Tool**: Vite for fast development and optimized production builds

- **Application Structure** (`/public/js/`):
  - `App.jsx` - Main application component with routing configuration
  - `routes/` - Route components for each section of the application
  - `components/react/` - Reusable React components
  - `services/` - Shared utilities (WebSocket, API client, storage)
  - `hooks/` - Custom React hooks for shared logic

- **Route Components** (`/public/js/routes/`):
  - `Dashboard.jsx` - Navigation hub and landing page
  - `PatientRoutes.jsx` - Patient portal with nested routes
  - `PatientManagement.jsx` - Patient search and grid view
  - `Expenses.jsx` - Expense management
  - `WhatsAppSend.jsx` - WhatsApp messaging
  - `WhatsAppAuth.jsx` - WhatsApp authentication
  - `AlignerRoutes.jsx` - Aligner management with nested routes
  - `SettingsRoutes.jsx` - Settings with tabs and nested routes
  - `TemplateRoutes.jsx` - Template designer with GrapesJS
  - `DailyAppointments.jsx` - Daily appointments view
  - `Calendar.jsx` - Monthly calendar view
  - `Statistics.jsx` - Financial statistics and reports

- **React Components** (`/public/js/components/react/`):
  - `UniversalHeader.jsx` - Persistent header with patient search
  - `PatientShell.jsx` - Patient portal wrapper with sidebar navigation
  - `PaymentModal.jsx` - Payment processing modal
  - `EditPatientComponent.jsx` - Patient information editor
  - And many more specialized components

- **Services Layer** (`/public/js/services/`):
  - `websocket.js` - WebSocket client for real-time updates
  - `http.js` - HTTP client for API requests
  - `storage.js` - Local storage utilities

- **Hooks** (`/public/js/hooks/`): Custom hooks for shared logic (WebSocket sync, message status, etc.)

**Key Features:**
- ✅ No page reloads - instant navigation between routes
- ✅ Persistent WebSocket connection for real-time updates
- ✅ React Context API for state sharing across components
- ✅ CDN-loaded core libraries (React, Router) for optimal caching
- ✅ Vite for fast development and optimized production builds
- ✅ Native app-like experience with smooth transitions
- ✅ Server-side rendering ready (all routes served from Express)

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