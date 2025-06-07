# WebSocket Events - Universal Naming Convention

This document describes the universal naming convention for WebSocket events used throughout the Shwan Orthodontics application.

## Overview

To ensure consistency and maintainability, all WebSocket events now follow a universal naming convention. The system supports both the new universal format and legacy events for backward compatibility.

## Event Naming Convention

### Pattern
- **Constants**: Use `SCREAMING_SNAKE_CASE` for event constants
- **Event Names**: Use `snake_case` for actual event names
- **Descriptive Names**: Events should clearly indicate their purpose

### Categories

#### Connection Events
- `connection_established` - WebSocket connection successfully established
- `connection_lost` - Connection lost or disconnected
- `connection_error` - Connection error occurred
- `connection_reconnecting` - Client is reconnecting
- `heartbeat_ping` - Heartbeat ping to maintain connection
- `heartbeat_pong` - Heartbeat pong response

#### Appointment System Events
- `appointments_updated` - Appointment data has been updated
- `request_appointments` - Request appointment data for specific date
- `appointments_data` - Appointment data response

#### Patient Management Events
- `patient_loaded` - Patient data loaded and displayed
- `patient_unloaded` - Patient data unloaded/cleared
- `request_patient` - Request patient data
- `patient_data` - Patient data response
- `patient_images_loaded` - Patient images loaded
- `patient_visit_updated` - Patient visit data updated

#### WhatsApp Messaging Events
- `whatsapp_client_ready` - WhatsApp client ready for messaging
- `whatsapp_client_initializing` - WhatsApp client initializing
- `whatsapp_client_disconnected` - WhatsApp client disconnected
- `whatsapp_qr_updated` - QR code updated for authentication
- `whatsapp_message_status` - Message status updated
- `whatsapp_message_batch_status` - Batch message status updates
- `whatsapp_sending_finished` - Message sending process finished
- `request_whatsapp_initial_state` - Request initial WhatsApp state
- `whatsapp_initial_state_response` - WhatsApp initial state response

#### System Events
- `system_error` - General system error
- `data_updated` - Data update completed
- `broadcast_message` - Broadcast message to all clients

## Implementation

### Backend (Server)

```javascript
import { WebSocketEvents, createStandardMessage } from '../services/messaging/websocket-events.js';

// Emit universal events
wsEmitter.emit(WebSocketEvents.PATIENT_LOADED, pid, screenID);

// Create standardized messages
const message = createStandardMessage(
  WebSocketEvents.APPOINTMENTS_UPDATED,
  { tableData: appointmentData },
  { date: dateParam }
);
```

### Frontend (Client)

```javascript
// Listen to universal events only
websocketService.on('patient_loaded', handlePatientLoaded);
websocketService.on('appointments_updated', handleAppointmentUpdate);
websocketService.on('whatsapp_client_ready', handleWhatsAppReady);
```

## Clean Universal Implementation

The application now uses **only** universal event naming conventions throughout. All legacy event support has been removed to ensure clean, consistent code.

## Event Data Structure

All events follow a standardized message structure:

```javascript
{
  type: 'event_name',          // Universal event name
  data: {                      // Event-specific data
    // ... event payload
  },
  timestamp: 1234567890,       // Unix timestamp
  id: 'msg_abc123_def456',     // Unique message ID
  // ... additional metadata
}
```

## Validation

Events are validated against predefined schemas:

```javascript
import { validateEventData } from '../services/messaging/websocket-events.js';

const validation = validateEventData(eventType, data);
if (!validation.valid) {
  console.warn('Invalid event data:', validation.errors);
}
```

## Best Practices

### For Developers

1. **Always use constants**: Use `WebSocketEvents.PATIENT_LOADED` instead of hardcoded strings
2. **Use universal events only**: All code uses the clean universal event naming convention
3. **Validate data**: Always validate event data structure
4. **Use createStandardMessage**: Use the helper function for consistent message format
5. **Log events**: Include event type in log messages for debugging

### Event Naming Guidelines

1. **Be descriptive**: `patient_loaded` is better than `data_ready`
2. **Use consistent patterns**: `noun_verb` for server events, `verb_noun` for client requests
3. **Group related events**: Use prefixes like `whatsapp_`, `patient_`, `appointment_`
4. **Avoid abbreviations**: Use `appointment` not `apt`

### Error Handling

```javascript
// Good
websocketService.on('system_error', (error) => {
  console.error('System error:', error);
  // Handle error appropriately
});

// Also handle connection errors
websocketService.on('connection_error', (error) => {
  console.error('Connection error:', error);
  // Attempt reconnection or show user notification
});
```

## Testing

When testing WebSocket events:

1. Test universal event names and data structure
2. Validate event data structure against schemas
3. Test error scenarios and edge cases
4. Test event timing and ordering
5. Verify cross-browser compatibility

## Monitoring

Events can be monitored using the built-in statistics:

```javascript
import { getEventsByCategory } from '../services/messaging/websocket-events.js';

// Get events by category for monitoring
const eventCategories = getEventsByCategory();
console.log('Available events:', eventCategories);
```

## Future Enhancements

1. **Event versioning**: Support for event schema versions
2. **Event analytics**: Built-in event tracking and metrics
3. **Event debugging**: Development tools for event inspection
4. **Event replay**: Ability to replay events for testing
5. **Event compression**: Optimize message size for performance

## Troubleshooting

### Common Issues

1. **Event not received**: Check if listening to correct universal event name
2. **Invalid data**: Verify event data structure matches expected schema
3. **Connection issues**: Check WebSocket connection status
4. **Event validation**: Ensure event types are valid universal events

### Debugging

```javascript
// Enable debug logging
websocketService.options.debug = true;

// Monitor all events
websocketService.on('message', (message) => {
  console.log('Raw message:', message);
});

// Validate event types
import { isValidEvent } from '../services/messaging/websocket-events.js';
console.log('Is valid event:', isValidEvent('patient_loaded'));
```

## Files Modified

- `services/messaging/websocket-events.js` - Universal event constants and utilities
- `services/messaging/schemas.js` - Updated to use universal events
- `utils/websocket.js` - Backend WebSocket handlers updated
- `public/js/services/websocket.js` - Frontend WebSocket service updated
- `public/js/pages/appointments.js` - Page updated to use universal events
- `routes/api.js` - API routes updated to emit universal events

This universal naming convention ensures consistency, maintainability, and clear communication patterns across the entire application. All legacy events have been removed for clean, modern code.