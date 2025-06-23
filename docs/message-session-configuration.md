# MessageSession Time-Based ACK Tracking Configuration

## Overview

The system now implements intelligent 24-hour time-based ACK tracking to prevent irrelevant old WhatsApp acknowledgments from updating appointment records. This enhancement focuses on business-relevant delivery status while keeping the system lean and performant.

## Default Configuration

**Perfect for dental clinic operations:**
- **ACK Tracking Window**: 24 hours (86,400,000 ms)
- **Cleanup Interval**: 6 hours (21,600,000 ms)  
- **Final Session Cleanup**: 48 hours (172,800,000 ms)
- **Auto-Expiry**: Enabled

## Business Logic

### Why 24 Hours?
- **Appointment reminders** are typically for next day or day after
- **Patient responses** happen within hours, not days
- **Delivery status beyond 24 hours** has minimal business value
- **System efficiency** - focuses on actionable data only

### What Happens After 24 Hours?
- ✅ **Sessions expire** for ACK tracking
- ✅ **Old ACKs are ignored** (logged but not processed)
- ✅ **Database stays clean** - no irrelevant updates
- ✅ **Memory is freed** - automatic resource management

## Configuration Options

### Environment Variables (Recommended)
```bash
# 24 hours (default) - Perfect for clinics
export WHATSAPP_ACK_TRACKING_WINDOW=86400000

# 12 hours - More aggressive cleanup
export WHATSAPP_ACK_TRACKING_WINDOW=43200000

# 6 hours - Minimal tracking for high-volume systems
export WHATSAPP_ACK_TRACKING_WINDOW=21600000
```

### Code Configuration (Advanced)
```javascript
// Default configuration (recommended)
const messageSessionManager = new MessageSessionManager();

// Custom configuration for specific needs
const messageSessionManager = new MessageSessionManager({
  ackTrackingWindow: 24 * 60 * 60 * 1000,  // 24 hours
  cleanupInterval: 6 * 60 * 60 * 1000,     // 6 hours  
  maxSessionAge: 48 * 60 * 60 * 1000,      // 48 hours
  autoExpireEnabled: true,                  // Enable expiry
  maxHistorySize: 100                       // History limit
});
```

## Monitoring and Debugging

### Session Statistics
```javascript
// Get detailed session information
const stats = messageSessionManager.getAllStats();
console.log(stats);

// Output:
// {
//   active: [{ 
//     sessionId: "msg_session_2024-01-15_...",
//     date: "2024-01-15",
//     isExpired: false,
//     canAcceptAcks: true,
//     timeUntilExpiry: 82800000,
//     ackTrackingWindow: 86400000,
//     ...
//   }],
//   summary: {
//     activeSessions: 2,
//     expiredSessionCount: 0,
//     acceptingAcksCount: 2
//   }
// }
```

### Debug Information
```javascript
// Get comprehensive debug data
const debugInfo = messageSessionManager.getDebugInfo();
console.log(debugInfo.managerStats);

// Output:
// {
//   activeSessionCount: 2,
//   expiredSessionCount: 0,
//   acceptingAcksCount: 2,
//   ackTrackingWindow: 86400000,
//   autoExpireEnabled: true,
//   cleanupInterval: 21600000,
//   maxSessionAge: 172800000
// }
```

## Log Messages to Watch

### Normal Operation
```
ℹ️ MessageSession created (sessionId: msg_session_2024-01-15_..., expiresAt: 2024-01-16T08:00:00.000Z)
ℹ️ Message registered in session (messageId: 3EB0B43A..., appointmentId: 456)
ℹ️ Delivery status update recorded (status: read, timeUntilExpiry: 82800000)
```

### Expiry and Cleanup
```
ℹ️ MessageSession expired - no longer accepting ACKs (age: 86400s, mappingCount: 15)
⚠️ Session cannot accept ACKs - message lookup rejected (isExpired: true)
ℹ️ Periodic cleanup completed (expiredSessions: 2, cleanedSessions: 1)
```

## Recommendations by Environment

### Production (Clinic)
```javascript
// Use defaults - perfect for clinic operations
const manager = new MessageSessionManager();
```

### Development/Testing
```javascript
// Shorter windows for faster testing
const manager = new MessageSessionManager({
  ackTrackingWindow: 60 * 1000,      // 1 minute
  cleanupInterval: 30 * 1000,        // 30 seconds
  maxSessionAge: 2 * 60 * 1000       // 2 minutes
});
```

### High-Volume Environment
```javascript
// More aggressive cleanup
const manager = new MessageSessionManager({
  ackTrackingWindow: 6 * 60 * 60 * 1000,   // 6 hours
  cleanupInterval: 60 * 60 * 1000,         // 1 hour
  maxSessionAge: 12 * 60 * 60 * 1000       // 12 hours
});
```

## Benefits Summary

### Resource Efficiency
- ✅ **Bounded memory growth** - sessions expire automatically
- ✅ **Faster lookups** - smaller active dataset
- ✅ **Reduced database load** - fewer unnecessary updates

### Business Alignment  
- ✅ **Focus on actionable data** - recent delivery status matters
- ✅ **Eliminate noise** - old ACKs don't pollute reports
- ✅ **Better performance** - system optimized for current operations

### Operational Benefits
- ✅ **Predictable behavior** - consistent resource usage
- ✅ **Easy monitoring** - comprehensive statistics and debugging
- ✅ **Zero configuration** - works perfectly out of the box
- ✅ **Fully configurable** - adapt to any environment

## Migration Notes

**No database changes required!** This enhancement is purely at the application layer and maintains full backward compatibility with existing stored procedures and database schema.

The system will automatically:
1. ✅ Start using time-based tracking immediately
2. ✅ Expire old sessions after 24 hours  
3. ✅ Clean up resources automatically
4. ✅ Log all activity for monitoring

**Perfect for your dental clinic** - focuses on the 24-hour window when appointment reminders and patient responses are most relevant!