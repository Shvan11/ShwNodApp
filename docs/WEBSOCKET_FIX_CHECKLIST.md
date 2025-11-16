# WebSocket Event System - Fix Checklist

## Overview
The WebSocket event handling system has **5 critical issues** that need to be fixed. This checklist guides you through fixing them systematically.

## Critical Issues Found

### Issue 1: Triple Listener for `whatsapp_client_ready`
**Severity:** CRITICAL - Race condition risk

**What's happening:**
- Event emitted once from backend
- 3 different components listen to it
- Each updates its own local state
- Results in 3 redundant state updates

**Files involved:**
1. `public/js/contexts/GlobalStateContext.jsx` - Line 77
2. `public/js/hooks/useWhatsAppWebSocket.js` - Line 102  
3. `public/js/components/react/SendMessage.jsx` - Line 59

**Why it's a problem:**
- Difficult to track state changes
- Potential race conditions
- Extra React renders
- Maintenance nightmare

---

### Issue 2: Duplicate QR Verification Loop
**Severity:** CRITICAL - Resource waste

**What's happening:**
- `messageState.verifyQRViewerCount()` called twice per minute
- Same code runs in two separate setInterval()
- Wastes CPU cycles

**File affected:**
- `utils/websocket.js` - Lines 1054-1093
  - First interval: Lines 1054-1076
  - Second interval (DUPLICATE): Lines 1078-1093

**Why it's a problem:**
- Unnecessary function calls
- Wasted server resources
- Inconsistent logging (first logs, second doesn't)

---

### Issue 3: No Listener Cleanup in SendMessage Component
**Severity:** HIGH - Memory leak

**What's happening:**
- Component registers WebSocket listeners
- No cleanup when component unmounts
- Each mount adds new listener without removing old one

**File affected:**
- `public/js/components/react/SendMessage.jsx` - Lines 59, 66

**Why it's a problem:**
- Memory leak if component mounted multiple times
- Exponential listener growth
- All listeners fire on each event

---

### Issue 4: Inconsistent WebSocket Implementations
**Severity:** HIGH - State sync issues

**What's happening:**
- Most components use singleton WebSocket service
- `useWhatsAppAuth.js` uses raw WebSocket constructor
- Separate connections don't share events

**Files involved:**
- `public/js/hooks/useWhatsAppAuth.js` - Line 173
- Others use singleton from `public/js/services/websocket.js`

**Why it's a problem:**
- `useWhatsAppAuth` doesn't receive events from singleton
- QR code state differs in different parts of app
- Maintenance burden - two different patterns

---

### Issue 5: Dual QR Updated Listeners (Different Connections)
**Severity:** HIGH - State inconsistency

**What's happening:**
- GlobalStateContext listens via singleton
- useWhatsAppAuth listens via raw WebSocket
- Same event, different listeners
- Different QR codes in different parts of app

**Files involved:**
- `public/js/contexts/GlobalStateContext.jsx` - Line 78 (singleton)
- `public/js/hooks/useWhatsAppAuth.js` - Line 200 (raw WebSocket)

---

## Fix Priority Order

### CRITICAL FIXES (Do First)

#### Priority 1: Remove Duplicate QR Verification Loop
**Time:** 5 minutes

```
File: utils/websocket.js
Action: Delete lines 1078-1093 (second setInterval)
Why: Prevents double verification calls
```

**Steps:**
1. Open `utils/websocket.js`
2. Navigate to line 1078
3. Delete the entire second `setInterval` block (lines 1078-1093)
4. Save file
5. Test: Verify only one health check per minute in logs

---

#### Priority 2: Remove Duplicate Listener from useWhatsAppWebSocket
**Time:** 10 minutes

```
File: public/js/hooks/useWhatsAppWebSocket.js
Action: Remove lines 102-107 (whatsapp_client_ready listener)
Why: Let GlobalStateContext handle it, read from global state instead
```

**Steps:**
1. Open `public/js/hooks/useWhatsAppWebSocket.js`
2. Remove listener registration (line 102):
   ```javascript
   // REMOVE:
   websocketService.on('whatsapp_client_ready', handleClientReady);
   ```
3. Remove listener cleanup (line 123):
   ```javascript
   // REMOVE:
   websocketService.off('whatsapp_client_ready', handleClientReady);
   ```
4. Replace `clientReady` state with reading from GlobalStateContext:
   ```javascript
   // ADD:
   const { whatsappClientReady } = useGlobalState();
   // USE: whatsappClientReady instead of clientReady
   ```
5. Update return object to use global state value
6. Save file
7. Test: Verify WhatsApp send page still shows correct status

---

#### Priority 3: Add Cleanup to SendMessage Component
**Time:** 15 minutes

```
File: public/js/components/react/SendMessage.jsx
Action: Remove listeners + add cleanup
Why: Prevent memory leak
```

**Steps:**
1. Open `public/js/components/react/SendMessage.jsx`
2. Import `useGlobalState` at top:
   ```javascript
   import { useGlobalState } from '../../contexts/GlobalStateContext.js';
   ```
3. Remove the listener registration (lines 59, 66):
   ```javascript
   // REMOVE:
   connectionManagerRef.current.on('whatsapp_client_ready', ...);
   connectionManagerRef.current.on('whatsapp_initial_state_response', ...);
   ```
4. Replace with reading from global state:
   ```javascript
   const { whatsappClientReady } = useGlobalState();
   // Use whatsappClientReady instead of clientStatus.ready
   ```
5. Add cleanup in useEffect that sets up WebSocket:
   ```javascript
   return () => {
     if (connectionManagerRef.current) {
       // Listeners are now only in this effect, so remove them
       // Note: This component no longer registers listeners!
     }
   };
   ```
6. Save file
7. Test: Mount/unmount component multiple times, verify no listener leak

---

### HIGH PRIORITY FIXES (Do Next)

#### Priority 4: Refactor useWhatsAppAuth to Use Singleton
**Time:** 45 minutes

```
File: public/js/hooks/useWhatsAppAuth.js
Action: Replace raw WebSocket with singleton service
Why: Ensure all auth state syncs with GlobalStateContext
```

**Detailed steps in separate guide below**

---

#### Priority 5: Verify Component State Management
**Time:** 20 minutes

```
Action: Ensure all components use useGlobalState for shared state
Files: All components that read WhatsApp status
Why: Single source of truth
```

**Steps:**
1. Audit all components that use WebSocket:
   - Search for `.on('whatsapp_client_ready'`
   - Search for `.on('whatsapp_qr_updated'`
   - Search for `.on('whatsapp_message_status'`
2. For each listener found:
   - If in GlobalStateContext - KEEP
   - If elsewhere - REMOVE and use `useGlobalState()` instead
3. Save and test

---

## Detailed Fix Guide: useWhatsAppAuth Refactor

This is the most complex fix. Do this after the critical 3 fixes.

### Current Implementation
```javascript
// Current: Raw WebSocket
const ws = new WebSocket(wsUrl);
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'whatsapp_qr_updated':
      handleQRUpdate(message.data);
      break;
    // ...
  }
};
```

### Target Implementation
```javascript
// Target: Singleton service
const websocketService = (await import('../../services/websocket.js')).default;
await websocketService.connect({ clientType: 'auth', needsQR: true });

websocketService.on('whatsapp_qr_updated', handleQRUpdate);
websocketService.on('whatsapp_client_ready', handleClientReady);
websocketService.on('whatsapp_initial_state_response', handleInitialState);

// Also read QR from GlobalStateContext
const { whatsappQrCode } = useGlobalState();
```

### Steps to Refactor

1. **Backup the file:**
   ```bash
   cp public/js/hooks/useWhatsAppAuth.js public/js/hooks/useWhatsAppAuth.js.backup
   ```

2. **Replace WebSocket setup:**
   - Lines 173-230: Replace with singleton service
   - Add import for singleton service
   - Add event listeners using service.on()
   - Add cleanup in useEffect return

3. **Remove duplicate QR code state:**
   - Remove: `const [qrCode, setQrCode] = useState(null);`
   - Add: `const { whatsappQrCode } = useGlobalState();`
   - Replace all `setQrCode(...)` with reading from global state

4. **Test thoroughly:**
   - Navigate to WhatsApp Auth page
   - Verify QR code appears
   - Scan with WhatsApp
   - Verify state syncs with GlobalStateContext
   - Check that WebSocket singleton is used (not multiple connections)

---

## Testing Checklist

After each fix, run these tests:

### Unit Tests
```javascript
// Test 1: Verify no duplicate listeners
test('whatsapp_client_ready fires only once', () => {
  // Count listener invocations
  // Should be 1, not 3
});

// Test 2: Verify cleanup
test('SendMessage cleanup removes listeners', () => {
  // Mount and unmount component
  // Verify listener count doesn't grow
});

// Test 3: Verify QR verification
test('QR viewer verification runs once per minute', () => {
  // Count verifyQRViewerCount calls
  // Should be ~1 per minute, not 2
});
```

### Integration Tests
```javascript
// Test 1: WhatsApp Auth page
- Navigate to auth page
- Verify QR code displays (from GlobalState)
- Verify no duplicate listeners in DevTools

// Test 2: WhatsApp Send page
- Navigate to send page
- Verify client status shows correctly
- Verify clientReady comes from GlobalState

// Test 3: Global state sync
- Navigate between pages
- Verify QR code state consistent
- Verify client ready state consistent
```

### Manual Testing
1. **Check Memory Usage:**
   - Open DevTools
   - Navigate SendMessage component in/out multiple times
   - Verify memory doesn't grow (was leaking before)

2. **Check Network:**
   - Filter for WebSocket messages
   - Verify whatsapp_client_ready comes once, not 3x
   - Verify no duplicate QR viewer verification requests

3. **Check Logs:**
   - Look for "Called twice" patterns
   - Look for duplicate listener registrations
   - Verify error-free operation

---

## Verification Commands

```bash
# Count whatsapp_client_ready listeners before fix
grep -n "whatsapp_client_ready" public/js/hooks/*.js public/js/components/react/*.jsx
# Result: 3 listeners found (WRONG)

# After fix
grep -n "whatsapp_client_ready" public/js/hooks/*.js public/js/components/react/*.jsx
# Result: 1 listener in GlobalStateContext only (CORRECT)


# Check for duplicate intervals
grep -A 3 "setInterval" utils/websocket.js | grep -c "verifyQRViewerCount"
# Result: 2 before fix (WRONG)
# Result: 1 after fix (CORRECT)


# Check for listener cleanup in SendMessage
grep -A 10 "useEffect" public/js/components/react/SendMessage.jsx | grep "websocket.*off"
# Result: Should find cleanup before fix (but doesn't!)
# After fix: Should have cleanup
```

---

## Files to Modify Summary

| Priority | File | Lines | Action | Status |
|----------|------|-------|--------|--------|
| 1 | `utils/websocket.js` | 1078-1093 | DELETE | [ ] |
| 2 | `public/js/hooks/useWhatsAppWebSocket.js` | 102, 123 | REMOVE | [ ] |
| 3 | `public/js/components/react/SendMessage.jsx` | 59, 66 | REMOVE + ADD cleanup | [ ] |
| 4 | `public/js/hooks/useWhatsAppAuth.js` | 173-230 | REFACTOR | [ ] |
| 5 | Multiple files | Various | USE useGlobalState | [ ] |

---

## Rollback Plan

If something breaks:

```bash
# Each file has a backup strategy:

# 1. Git history
git checkout public/js/hooks/useWhatsAppWebSocket.js

# 2. Manual backup
cp public/js/hooks/useWhatsAppAuth.js.backup public/js/hooks/useWhatsAppAuth.js

# 3. Test in isolation
npm run dev  # Check no errors
```

---

## Success Criteria

- [ ] No duplicate whatsapp_client_ready listeners
- [ ] Memory doesn't leak on SendMessage mount/unmount
- [ ] QR verification runs once per minute (not twice)
- [ ] WhatsApp Auth page works correctly
- [ ] WhatsApp Send page shows correct status
- [ ] All WebSocket messages go through singleton (not raw WebSocket)
- [ ] State consistent across all pages
- [ ] No console errors related to WebSocket

---

## Questions or Issues?

Refer to the full analysis:
- `/home/user/ShwNodApp/docs/WEBSOCKET_EVENT_ANALYSIS.md` - Complete report
- `/home/user/ShwNodApp/docs/WEBSOCKET_LISTENER_FLOW_DIAGRAM.txt` - Visual diagrams
- `/home/user/ShwNodApp/docs/DUPLICATE_LISTENERS_QUICK_REFERENCE.txt` - Quick lookup

