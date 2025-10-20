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
- **Static Files**: `/public/` contains HTML views, CSS, JavaScript, and assets
- **Modular JS**: Component-based frontend with services layer (`/public/js/services/`)
- **Views**: Separate HTML files for different features (patient details, messaging, appointments)

## Environment Variables Required

Essential for database connectivity:
- `DB_SERVER`, `DB_INSTANCE`, `DB_USER`, `DB_PASSWORD`
- `MACHINE_PATH` - File system path for patient images
- `PORT` - Server port (defaults to platform-specific: Windows=80, WSL/Ubuntu=3000)

Cross-platform configuration:
- `PLATFORM_TYPE` - Force platform type: 'windows' or 'wsl' (optional, auto-detects if not set)

Optional service integrations:
- `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NAME`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `QR_HOST_URL`

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

### Platform Override
Force platform detection by setting:
```bash
export PLATFORM_TYPE=wsl    # Force WSL mode (port 3000)
export PLATFORM_TYPE=windows # Force Windows mode (port 80)
```

### Port Configuration
The application automatically selects the appropriate default port based on the platform:
- **Windows**: Port 80 (standard HTTP port)
- **WSL/Ubuntu**: Port 3000 (development-friendly port)

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