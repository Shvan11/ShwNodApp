# WebSocket Event Handling Analysis Report
## Shwan Orthodontics Application

**Date:** 2025-11-16
**Scope:** Frontend and Backend WebSocket event system analysis
**Status:** CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

The WebSocket event handling system has **multiple duplicate listener registrations** and **inconsistent event naming patterns** that create maintenance issues and potential race conditions. The analysis identifies:

- **3 Duplicate Listeners** for whatsapp_client_ready event
- **1 Duplicate Event Emission Loop** in backend periodic cleanup
- **Inconsistent WebSocket Implementation** (singleton vs raw WebSocket)
- **Event Routing Complexity** due to broadcast_message wrapper pattern
- **Memory Leak Risks** from improper listener cleanup

---

## Part 1: Frontend Event Listeners Analysis

### Listener Registration Map

#### 1. **GlobalStateContext.jsx** (Singleton WebSocket)
**File:** `/home/user/ShwNodApp/public/js/contexts/GlobalStateContext.jsx`

| Line | Event | Handler | Function |
|------|-------|---------|----------|
| 73 | `connected` | handleConnected | Sets isWebSocketConnected = true |
| 74 | `disconnected` | handleDisconnected | Sets isWebSocketConnected = false |
| 75 | `error` | handleError | Sets isWebSocketConnected = false |
| 76 | `connecting` | handleConnecting | Logs connection attempt |
| 77 | `whatsapp_client_ready` | handleWhatsAppReady | **Sets whatsappClientReady = true** |
| 78 | `whatsapp_qr_updated` | handleWhatsAppQR | **Sets whatsappQrCode** |

**Cleanup:** Lines 93-98 properly remove all listeners

---

#### 2. **useWhatsAppWebSocket.js** (Singleton WebSocket)
**File:** `/home/user/ShwNodApp/public/js/hooks/useWhatsAppWebSocket.js`

| Line | Event | Handler | Function |
|------|-------|---------|----------|
| 98 | `connecting` | handleConnecting | Sets connectionStatus = CONNECTING |
| 99 | `connected` | handleConnected | Sets connectionStatus = CONNECTED |
| 100 | `disconnected` | handleDisconnected | Sets connectionStatus = DISCONNECTED |
| 101 | `error` | handleError | Sets connectionStatus = ERROR |
| 102 | `whatsapp_client_ready` | handleClientReady | **Sets clientReady state** |
| 103 | `whatsapp_message_status` | handleMessageStatus | **Sets messageStatusUpdate** |
| 104 | `whatsapp_sending_started` | handleSendingStarted | **Sets sendingProgress** |
| 105 | `whatsapp_sending_progress` | handleSendingProgress | **Updates sendingProgress** |
| 106 | `whatsapp_sending_finished` | handleSendingFinished | **Marks as finished** |
| 107 | `whatsapp_initial_state_response` | handleInitialState | **Sets clientReady and progress** |

**Cleanup:** Lines 119-128 properly remove all listeners

**Issue:** `whatsapp_client_ready` listener causes **duplicate state updates** (also in GlobalStateContext)

---

#### 3. **useWebSocketSync.js** (Singleton WebSocket)
**File:** `/home/user/ShwNodApp/public/js/hooks/useWebSocketSync.js`

| Line | Event | Handler | Function |
|------|-------|---------|----------|
| 62 | `connected` | handleConnected | Sets connectionStatus = 'connected' |
| 63 | `disconnected` | handleDisconnected | Sets connectionStatus = 'disconnected' |
| 64 | `reconnecting` | handleReconnecting | Sets connectionStatus = 'reconnecting' |
| 65 | `error` | handleError | Sets connectionStatus = 'error' |
| 86 | `appointments_updated` | handleAppointmentsUpdated | **Calls onAppointmentsUpdated()** |

**Cleanup:** Lines 69-72 properly remove listeners

---

#### 4. **SendMessage.jsx** (Singleton WebSocket)
**File:** `/home/user/ShwNodApp/public/js/components/react/SendMessage.jsx`

| Line | Event | Handler | Function |
|------|-------|---------|----------|
| 59 | `whatsapp_client_ready` | handleClientReady | **Sets clientStatus.ready** |
| 66 | `whatsapp_initial_state_response` | handleInitialState | **Sets clientStatus** |

**Issue:** NO CLEANUP HANDLERS - listeners are never removed (lines 119-128 would be cleanup)

---

#### 5. **useWhatsAppAuth.js** (Raw WebSocket - NOT Singleton)
**File:** `/home/user/ShwNodApp/public/js/hooks/useWhatsAppAuth.js`

| Line | Implementation | Event | Handler | Function |
|------|-----------------|-------|---------|----------|
| 173 | Raw WebSocket | `onopen` | setupWebSocket | Manages connection lifecycle |
| 190-217 | onmessage handler | Parses type field | Handles by type switch | Processes specific events |
| 200 | Direct handler | `whatsapp_qr_updated` | handleQRUpdate | **Sets QR code** |
| 203 | Direct handler | `whatsapp_client_ready` | handleClientReady | **Sets auth state** |
| 206 | Direct handler | `whatsapp_initial_state_response` | handleInitialState | **Sets auth state** |

**Issue:** Different WebSocket implementation from other components (uses raw WebSocket, not singleton service)

---

## Part 2: Duplicate Listener Issues

### Issue #1: `whatsapp_client_ready` Event - Triple Registration

**Event:** `whatsapp_client_ready`
**Severity:** CRITICAL - Race condition risk

| Component | File | Line | State Updated | Problem |
|-----------|------|------|----------------|---------|
| GlobalStateContext | GlobalStateContext.jsx | 77 | whatsappClientReady | Primary state holder |
| useWhatsAppWebSocket | useWhatsAppWebSocket.js | 102 | clientReady | Duplicate update |
| SendMessage | SendMessage.jsx | 59 | clientStatus.ready | Duplicate update |

**Impact:**
- All three listeners fire simultaneously when backend emits `whatsapp_client_ready`
- State synchronization issues across different parts of app
- Difficult to debug which component made the state change
- Increased memory usage from multiple listeners

**Example Flow:**
```
Backend: whatsapp_client_ready event
    ↓
GlobalStateContext.handleWhatsAppReady() → sets whatsappClientReady = true
    ↓ (same event)
useWhatsAppWebSocket.handleClientReady() → sets clientReady = true
    ↓ (same event)
SendMessage.handleClientReady() → sets clientStatus.ready = true
```

**Result:** 3 separate state updates for 1 event

---

### Issue #2: `whatsapp_qr_updated` Event - Dual Registration

**Event:** `whatsapp_qr_updated`
**Severity:** HIGH - State sync issues

| Component | File | Line | State Updated | Problem |
|-----------|------|------|----------------|---------|
| GlobalStateContext | GlobalStateContext.jsx | 78 | whatsappQrCode | Via singleton service |
| useWhatsAppAuth | useWhatsAppAuth.js | 200 | qrCode | Via raw WebSocket |

**Impact:**
- useWhatsAppAuth doesn't use singleton, so events don't propagate to GlobalStateContext
- QR code state in AuthPage won't sync with GlobalState
- WhatsAppAuth and GlobalState have different QR codes at any given time
- Inconsistent UI representation

---

## Part 3: Backend Event Emission Analysis

### Backend Event Emitters

#### 1. **WhatsApp Service Event Broadcasting**
**File:** `/home/user/ShwNodApp/services/messaging/whatsapp.js`

| Line | Event Type | Emission Method | Event Name | Frequency | Issue |
|------|------------|-----------------|------------|-----------|-------|
| 733 | QR Update | broadcastToClients() | broadcast_message | Per QR | - |
| 741 | QR Update (fallback) | broadcastToClients() | broadcast_message | Per QR | DUPLICATE if both execute |
| 763 | Client Ready | broadcastToClients() | broadcast_message | Once | - |
| 817 | Message Status | broadcastToClients() | broadcast_message | Per message | - |
| 904 | Restart Status | wsEmitter.emit() | broadcast_message | Once | Mixed emission methods |
| 944 | Init Status | wsEmitter.emit() | broadcast_message | Once | Mixed emission methods |
| 1059 | Finish Status | wsEmitter.emit() | broadcast_message | Once | Mixed emission methods |

**Code Analysis - Lines 720-743:**
```javascript
if (this.wsEmitter) {
  // Convert QR string to data URL for client display
  try {
    const qrImageUrl = await qrcode.toDataURL(qr, {
      margin: 4,
      scale: 6,
      errorCorrectionLevel: 'M'
    });

    const message = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.QR_UPDATE,
      { qr: qrImageUrl, clientReady: false }
    );
    this.broadcastToClients(message);   // LINE 733
  } catch (error) {
    logger.whatsapp.error('Failed to convert QR code to data URL:', error);
    // Fallback: send raw QR string
    const message = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.QR_UPDATE,
      { qr, clientReady: false }
    );
    this.broadcastToClients(message);   // LINE 741 - FALLBACK
  }
}
```

**Issue:** If conversion succeeds, both line 733 AND line 741 execute (try sends, catch sends again)
**Actually NO:** Try-catch structure prevents both - only one executes.

---

#### 2. **WebSocket Server Global Event Handlers**
**File:** `/home/user/ShwNodApp/utils/websocket.js`

| Line Range | Event Name | Handler | Purpose |
|------------|------------|---------|---------|
| 821-848 | DATA_UPDATED | handleAppointmentUpdate | Broadcasts appointment changes |
| 853-912 | PATIENT_LOADED | handlePatientLoaded | Sends patient data to specific screen |
| 914-947 | PATIENT_UNLOADED | handlePatientUnloaded | Clears patient data |
| 953-989 | wa_message_update | (inline) | Buffers and batches message status updates |
| 992-1013 | broadcast_message | (inline) | Routes based on message.type field |

**Listener Setup:**
```javascript
emitter.on(WebSocketEvents.DATA_UPDATED, handleAppointmentUpdate);
emitter.on(WebSocketEvents.PATIENT_LOADED, handlePatientLoaded);
emitter.on(WebSocketEvents.PATIENT_UNLOADED, handlePatientUnloaded);
emitter.on('wa_message_update', ...);
emitter.on('broadcast_message', ...);
```

---

### Issue #3: Duplicate QR Viewer Registration Loop

**File:** `/home/user/ShwNodApp/utils/websocket.js`
**Lines:** 1054-1093

**Code:**
```javascript
// FIRST INTERVAL (Line 1054-1076)
setInterval(() => {
  const activeViewerIds = [];
  connectionManager.waStatusConnections.forEach(ws => {
    if (ws.qrViewerRegistered && ws.viewerId) {
      activeViewerIds.push(ws.viewerId);
    }
  });
  
  if (messageState && typeof messageState.verifyQRViewerCount === 'function') {
    messageState.verifyQRViewerCount(activeViewerIds);
  }
  
  const counts = connectionManager.getConnectionCounts();
  if (counts.waStatus > 0) {
    logger.websocket.debug('WebSocket health check', { 
      waStatusConnections: counts.waStatus, 
      qrViewersRegistered: activeViewerIds.length 
    });
  }
}, 60000);

// SECOND INTERVAL - IDENTICAL CODE (Line 1078-1093)
setInterval(() => {
  const activeViewerIds = [];
  connectionManager.waStatusConnections.forEach(ws => {
    if (ws.qrViewerRegistered && ws.viewerId) {
      activeViewerIds.push(ws.viewerId);
    }
  });
  
  if (messageState && typeof messageState.verifyQRViewerCount === 'function') {
    messageState.verifyQRViewerCount(activeViewerIds);
  }
  
  const counts = connectionManager.getConnectionCounts();
  // ... rest of code (but no logging in second one)
}, 60000);
```

**Issue:** 
- Same code runs every 60 seconds in TWO SEPARATE INTERVALS
- `messageState.verifyQRViewerCount()` called TWICE per minute
- Wastes CPU cycles
- Inconsistent logging (second one doesn't log counts)

---

## Part 4: Event Routing Complexity

### broadcast_message Routing

**Flow:**
```
Backend: whatsapp_client_ready event triggered
    ↓
WhatsApp Service: this.broadcastToClients(message)
    ↓
WebSocket Server: this.wsEmitter.emit('broadcast_message', message)
    ↓
Global Handler: emitter.on('broadcast_message', handler)
    ↓
Switch Statement (Lines 1000-1012):
    - MessageSchemas.WebSocketMessage.QR_UPDATE → broadcastToWaStatus()
    - MessageSchemas.WebSocketMessage.CLIENT_READY → broadcastToAll()
    - MessageSchemas.WebSocketMessage.MESSAGE_STATUS → broadcastToWaStatus()
    - default → broadcastToAll()
    ↓
Frontend Service: emits as original event type
    ↓
Components: Listen to whatsapp_client_ready, etc.
```

**Problem:**
- Event goes through 2 wrapper layers before reaching frontend
- Message type conversion loses some context
- Difficult to trace event flow
- Schema validation happens at multiple points

---

## Part 5: Event Flow Diagram

```
BACKEND EMITTERS
├── WhatsApp Service
│   ├── client.on('qr') → broadcastToClients() → 'broadcast_message'
│   ├── client.on('ready') → broadcastToClients() → 'broadcast_message'
│   ├── client.on('message_ack') → broadcastToClients() → 'broadcast_message'
│   └── restart/init → wsEmitter.emit('broadcast_message')
│
└── WebSocket Server (setupGlobalEventHandlers)
    ├── DATA_UPDATED → handleAppointmentUpdate() → broadcastToScreens()
    ├── PATIENT_LOADED → handlePatientLoaded() → sendToScreen()
    ├── PATIENT_UNLOADED → handlePatientUnloaded() → sendToScreen()
    ├── wa_message_update → buffer + batch → broadcastToWaStatus()
    └── broadcast_message → route based on type

FRONTEND CONNECTIONS
├── GlobalStateContext (Singleton ws)
│   ├── whatsapp_client_ready → setWhatsappClientReady(true)
│   └── whatsapp_qr_updated → setWhatsappQrCode(qr)
│
├── useWhatsAppWebSocket (Singleton ws)
│   ├── whatsapp_client_ready → setClientReady(true) [DUPLICATE]
│   ├── whatsapp_message_status → setMessageStatusUpdate(data)
│   ├── whatsapp_sending_progress → setSendingProgress(data)
│   └── whatsapp_initial_state_response → setClientReady(data.clientReady)
│
├── useWebSocketSync (Singleton ws)
│   └── appointments_updated → onAppointmentsUpdated()
│
├── SendMessage (Singleton ws)
│   └── whatsapp_client_ready → setClientStatus(ready) [DUPLICATE]
│
└── useWhatsAppAuth (Raw WebSocket - NOT Singleton)
    ├── whatsapp_qr_updated → setQrCode(qr) [SEPARATE]
    ├── whatsapp_client_ready → setAuthState(AUTHENTICATED) [SEPARATE]
    └── whatsapp_initial_state_response → handleInitialState()
```

---

## Part 6: Identified Issues Summary

### Critical Issues

| # | Issue | Location | Severity | Impact |
|---|-------|----------|----------|--------|
| 1 | Triple listener for `whatsapp_client_ready` | GlobalStateContext.jsx:77, useWhatsAppWebSocket.js:102, SendMessage.jsx:59 | CRITICAL | Race condition, state sync issues |
| 2 | Duplicate QR viewer registration loop | websocket.js:1054-1093 | CRITICAL | Wasted resources, double verification |
| 3 | Inconsistent WebSocket implementation | useWhatsAppAuth.js uses raw WS vs singleton | HIGH | State inconsistency, maintenance burden |
| 4 | No listener cleanup in SendMessage | SendMessage.jsx | HIGH | Memory leak on component unmount |
| 5 | Dual QR update listeners | GlobalStateContext.jsx:78 vs useWhatsAppAuth.js:200 | HIGH | Different QR codes in different parts |

---

## Part 7: Component Dependency Analysis

### sendMessage Component Issue
**File:** `/home/user/ShwNodApp/public/js/components/react/SendMessage.jsx`

**Lines 59, 66:** Listeners registered but **NO cleanup handlers** found
```javascript
// Lines 59, 66 register listeners
connectionManagerRef.current.on('whatsapp_client_ready', (data) => { ... });
connectionManagerRef.current.on('whatsapp_initial_state_response', (data) => { ... });

// Expected cleanup would be in useEffect return or componentWillUnmount
// NOT FOUND in this file
```

**Memory Leak Risk:**
- Component unmounts but listeners remain active
- Each component instance adds more listeners without removing old ones
- If component is mounted multiple times = exponential listener growth

---

## Part 8: Recommended Fixes

### Fix #1: Eliminate Duplicate `whatsapp_client_ready` Listeners

**Priority:** CRITICAL

**Solution:** 
- Keep listener ONLY in GlobalStateContext
- Other components should read from global state using `useGlobalState()` hook
- Remove listeners from useWhatsAppWebSocket and SendMessage

**Changes Required:**
```
File: useWhatsAppWebSocket.js
  - REMOVE: Line 102 (whatsapp_client_ready listener)
  - ADD: Use useGlobalState() to read whatsappClientReady instead

File: SendMessage.jsx
  - REMOVE: Lines 59, 66 (all whatsapp listeners)
  - ADD: Import and use useGlobalState() instead
  - ADD: useEffect cleanup function
```

---

### Fix #2: Consolidate QR Code Listeners

**Priority:** HIGH

**Solution:**
- useWhatsAppAuth should also use singleton WebSocket service
- Read QR code from GlobalStateContext instead of separate listener

**Changes Required:**
```
File: useWhatsAppAuth.js
  - REPLACE: Raw WebSocket with singleton service
  - REMOVE: Local qrCode state
  - ADD: Use useGlobalState() for whatsappQrCode
```

---

### Fix #3: Add Listener Cleanup

**Priority:** HIGH

**Files Affected:**
- SendMessage.jsx - NO cleanup
- Any other dynamically mounted component with listeners

**Template:**
```javascript
useEffect(() => {
  const handler = (data) => { /* ... */ };
  websocketService.on('event_name', handler);
  
  return () => {
    websocketService.off('event_name', handler);  // CLEANUP
  };
}, []);
```

---

### Fix #4: Remove Duplicate QR Verification Loop

**Priority:** MEDIUM

**Solution:**
```javascript
// File: websocket.js - REMOVE the duplicate interval (lines 1078-1093)
// Keep only the first one (lines 1054-1076)
```

---

### Fix #5: Simplify Event Routing

**Priority:** MEDIUM

**Solution:**
- Emit events directly from backend without broadcast_message wrapper
- Use universal event naming consistently
- Remove the message type routing in setupGlobalEventHandlers

---

## Part 9: Testing Recommendations

### Test Case 1: Verify Single Client Ready Event
```javascript
test('whatsapp_client_ready should only trigger once per event', async () => {
  const globalStateSetReady = jest.fn();
  const hookSetReady = jest.fn();
  const sendMessageSetReady = jest.fn();
  
  // Simulate backend emit
  wsService.emit('whatsapp_client_ready', { clientReady: true });
  
  // Only GlobalStateContext should have been called
  expect(globalStateSetReady).toHaveBeenCalledTimes(1);
  expect(hookSetReady).toHaveBeenCalledTimes(0);
  expect(sendMessageSetReady).toHaveBeenCalledTimes(0);
});
```

### Test Case 2: Verify Listener Cleanup
```javascript
test('SendMessage component should cleanup listeners on unmount', () => {
  const mockOff = jest.spyOn(websocketService, 'off');
  
  const { unmount } = render(<SendMessage />);
  unmount();
  
  expect(mockOff).toHaveBeenCalledWith('whatsapp_client_ready', expect.any(Function));
  expect(mockOff).toHaveBeenCalledWith('whatsapp_initial_state_response', expect.any(Function));
});
```

### Test Case 3: Monitor Duplicate Intervals
```javascript
test('QR viewer verification should run once per minute', () => {
  jest.useFakeTimers();
  const verifySpy = jest.spyOn(messageState, 'verifyQRViewerCount');
  
  setupPeriodicCleanup(connectionManager);
  
  jest.advanceTimersByTime(60000);
  
  expect(verifySpy).toHaveBeenCalledTimes(1); // Should be 1, currently 2
});
```

---

## Part 10: Files Requiring Changes

| File | Issue | Change Type |
|------|-------|-------------|
| `/home/user/ShwNodApp/public/js/contexts/GlobalStateContext.jsx` | Keep `whatsapp_client_ready` listener (primary) | KEEP AS-IS |
| `/home/user/ShwNodApp/public/js/hooks/useWhatsAppWebSocket.js` | Remove duplicate `whatsapp_client_ready` listener | REMOVE listener, use global state |
| `/home/user/ShwNodApp/public/js/components/react/SendMessage.jsx` | No cleanup + duplicate listeners | ADD cleanup, remove listeners |
| `/home/user/ShwNodApp/public/js/hooks/useWhatsAppAuth.js` | Inconsistent WebSocket + duplicate QR listener | REFACTOR to use singleton |
| `/home/user/ShwNodApp/utils/websocket.js` | Duplicate verification interval | REMOVE second interval (lines 1078-1093) |

---

## Conclusion

The WebSocket event handling system has grown organically with multiple duplicate listeners and inconsistent patterns. The primary issues are:

1. **Duplicate state updates** from `whatsapp_client_ready` event
2. **Inefficient periodic loops** verifying QR viewers twice per minute
3. **Inconsistent WebSocket implementations** causing state sync issues
4. **Memory leaks** from missing cleanup handlers

These issues should be resolved systematically, starting with consolidating listeners to the GlobalStateContext and ensuring all components read from global state rather than listening to events independently.

