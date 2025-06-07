# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js/Express web application for **Shwan Orthodontics** - a dental practice management system with multi-channel messaging capabilities (WhatsApp, SMS, Telegram). The application manages patient records, appointments, treatment photos, payments, and provides automated messaging for appointment reminders.

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
- `PORT` - Server port (defaults to 80)

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

## Development Notes

- Uses ES modules (`"type": "module"` in package.json)
- No formal test framework currently configured
- Graceful shutdown handling for all services
- Circuit breaker pattern for messaging resilience
- Connection pooling for database operations
- File system integration for patient image storage over network paths