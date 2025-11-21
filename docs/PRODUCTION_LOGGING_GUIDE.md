# Production Logging Guide

## Overview

This document provides comprehensive guidelines for proper logging in production environments for the Shwan Orthodontics Management System. Following these guidelines will ensure clean, actionable logs that are easy to monitor and debug.

## Current Winston Configuration

**Location**: `utils/logger.js`

**Log Levels** (from highest to lowest priority):
- `error` - Error messages and exceptions
- `warn` - Warning messages
- `info` - Informational messages (default)
- `http` - HTTP request logs
- `verbose` - Verbose informational messages
- `debug` - Debug messages (development only)
- `silly` - Very detailed debug messages

**Production Configuration**:
- Log files: `logs/error.log` (errors only), `logs/combined.log` (all logs)
- File rotation: 5MB per file, 5 files max
- Console output: Disabled in production (NODE_ENV=production)
- Format: JSON with timestamps

## Environment Configuration

### Required Environment Variables

Add to `.env` file:

```bash
# Logging Configuration
LOG_LEVEL=warn           # Production: warn | Development: debug
NODE_ENV=production      # Enable production mode
```

### Log Level Recommendations

| Environment | LOG_LEVEL | Rationale |
|-------------|-----------|-----------|
| **Production** | `warn` or `error` | Only log warnings and errors. Minimize log volume. |
| **Staging** | `info` | Log key operations for testing/validation. |
| **Development** | `debug` | Log everything for debugging. |

## What to Log in Production

### ✅ DO LOG (warn/error level)

1. **Critical Errors**
   ```javascript
   log.error('Database connection failed', {
     server: config.database.server,
     error: err.message,
     code: err.code,
     timestamp: new Date().toISOString()
   });
   ```

2. **Security Events**
   ```javascript
   log.warn('Failed login attempt', {
     username: req.body.username,
     ip: req.ip,
     userAgent: req.headers['user-agent']
   });
   ```

3. **Resource Exhaustion**
   ```javascript
   log.warn('Connection pool exhausted', {
     activeConnections: pool.size,
     maxConnections: pool.max,
     pendingRequests: queue.length
   });
   ```

4. **Circuit Breaker State Changes**
   ```javascript
   log.warn('Circuit breaker opened', {
     service: 'whatsapp',
     failureCount: this.failureCount,
     threshold: this.failureThreshold
   });
   ```

5. **Message Delivery Failures**
   ```javascript
   log.error('WhatsApp message delivery failed', {
     messageId: msg.id,
     recipient: msg.to,
     error: err.message,
     retryCount: msg.retries
   });
   ```

6. **Application Lifecycle Events**
   ```javascript
   log.warn('Application starting graceful shutdown', {
     reason: 'SIGTERM received',
     activeConnections: server.getConnections()
   });
   ```

### ❌ DO NOT LOG (move to debug level)

1. **Successful Query Completions**
   ```javascript
   // ❌ WRONG (info level)
   log.info('Query completed: 50 rows affected');

   // ✅ CORRECT (debug level)
   log.debug('Query completed', { rowCount: 50 });
   ```

2. **Routine Message Status Updates**
   ```javascript
   // ❌ WRONG (info level)
   log.info('Starting WhatsApp status update');
   log.info('WhatsApp status update completed successfully');

   // ✅ CORRECT (debug level or remove entirely)
   log.debug('WhatsApp status update completed', { messageCount: 26 });
   ```

3. **Connection Pool Operations**
   ```javascript
   // ❌ WRONG (info level)
   log.info('[DB] Connection created');

   // ✅ CORRECT (debug level)
   log.debug('Database connection acquired', { poolSize: pool.size });
   ```

4. **Routine API Requests**
   ```javascript
   // ❌ WRONG (info level)
   log.info('GET /api/patients');

   // ✅ CORRECT (http level + use middleware)
   // Handled by express middleware, not manual logging
   ```

5. **Emojis and Decorative Output**
   ```javascript
   // ❌ WRONG
   log.info('🚀 Server listening on port: 3000');

   // ✅ CORRECT
   log.info('Server listening', { port: 3000, env: process.env.NODE_ENV });
   ```

## Fixing Common Issues

### Issue 1: Excessive "Query completed" Logs

**Problem**: Every database query logs "Query completed: undefined rows affected/returned"

**Fix**: Changed from `console.log()` to `log.debug()` in `services/database/index.js`

**Before**:
```javascript
console.log(`Query completed: ${rowCount} rows affected/returned`);
```

**After**:
```javascript
log.debug(`Query completed: ${rowCount} rows affected/returned`);
```

**Result**: With `LOG_LEVEL=warn`, these messages are not logged in production.

### Issue 2: Repetitive Message Status Updates

**Problem**: 100+ "Starting/completed WhatsApp status update" messages

**Recommendation**: Add request IDs for tracing and reduce verbosity

**Location**: `services/database/queries/messaging-queries.js`

**Suggested Fix**:
```javascript
// Instead of logging every status update
log.info('[MSG] Starting WhatsApp status update');
log.info('[MSG] WhatsApp status update completed successfully');

// Log only once per batch with summary
log.debug('WhatsApp status batch update', {
  batchId: sessionId,
  messagesUpdated: statusUpdates.length,
  duration: Date.now() - startTime
});

// Log only failures
if (failed.length > 0) {
  log.warn('WhatsApp status update had failures', {
    batchId: sessionId,
    failedCount: failed.length,
    failed: failed.map(m => ({ id: m.id, error: m.error }))
  });
}
```

### Issue 3: dotenv Verbose Output

**Problem**: dotenv logs configuration tips on every startup

**Fix**: Added `debug: false` to all `dotenv.config()` calls

**Files Updated**:
- `config/config.js`
- `index.js`

**Before**:
```javascript
dotenv.config();
```

**After**:
```javascript
dotenv.config({ debug: false });
```

### Issue 4: Emoji-Filled Console Logs

**Problem**: Startup logs filled with emojis and debug messages

**Recommendation**: Replace with structured Winston logs

**Before** (in `index.js`):
```javascript
console.log('🚀 Starting Shwan Orthodontics Application...');
console.log('💬 DEBUG: About to connect WhatsApp service...');
console.log('✅ DEBUG: WhatsApp service connected');
```

**After**:
```javascript
log.info('Starting Shwan Orthodontics Application', {
  env: process.env.NODE_ENV,
  port: config.server.port,
  version: require('./package.json').version
});

log.debug('Connecting WhatsApp service');
log.debug('WhatsApp service connected');
```

## Structured Logging Best Practices

### 1. Always Include Context

```javascript
// ❌ BAD
log.error('Query failed');

// ✅ GOOD
log.error('Query failed', {
  query: query.substring(0, 100),
  error: err.message,
  code: err.code,
  connectionId: connection.id
});
```

### 2. Use Consistent Naming

```javascript
// ✅ GOOD - Consistent field names
log.error('Payment processing failed', {
  patientId: patient.id,
  amount: payment.amount,
  currency: payment.currency,
  error: err.message,
  errorCode: err.code
});
```

### 3. Add Request IDs for Tracing

```javascript
// Add middleware to generate request IDs
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// Use in logs
log.warn('Rate limit exceeded', {
  requestId: req.id,
  ip: req.ip,
  endpoint: req.path
});
```

### 4. Log Aggregate Metrics, Not Individual Operations

```javascript
// ❌ BAD - Log every message
messages.forEach(msg => {
  log.info('Sending message', { to: msg.to });
});

// ✅ GOOD - Log batch summary
log.info('WhatsApp batch send completed', {
  batchId: session.id,
  total: messages.length,
  sent: results.sent.length,
  failed: results.failed.length,
  duration: endTime - startTime
});
```

## Monitoring Production Logs

### Log File Locations

```bash
/home/administrator/projects/ShwNodApp/logs/
├── error.log       # Errors only (5MB x 5 files)
├── combined.log    # All logs (5MB x 5 files)
```

### Viewing Logs in Real-Time

```bash
# Watch error log
tail -f logs/error.log

# Watch combined log
tail -f logs/combined.log

# Search for specific errors
grep -i "circuit breaker" logs/error.log

# Parse JSON logs with jq
tail -f logs/combined.log | jq 'select(.level=="error")'
```

### Log Analysis Commands

```bash
# Count errors by type
cat logs/error.log | jq -r '.message' | sort | uniq -c | sort -rn

# Find all WhatsApp-related errors
cat logs/error.log | jq 'select(.message | contains("WhatsApp"))'

# Find errors in last hour
cat logs/error.log | jq 'select(.timestamp > "'$(date -u -d '1 hour ago' '+%Y-%m-%d %H:%M:%S')'")'
```

## Migration Checklist

### Phase 1: Immediate Fixes (Completed)

- [x] Replace all `console.log()` with Winston logger in `services/database/index.js`
- [x] Change "Query completed" logs from `info` to `debug` level
- [x] Set `LOG_LEVEL=warn` in `.env` for production
- [x] Silence dotenv verbose output with `debug: false`

### Phase 2: Recommended Improvements

- [ ] Add request IDs to all API logs
- [ ] Reduce message status update logging (batch summaries instead)
- [ ] Replace startup emoji logs with structured Winston logs
- [ ] Add log rotation monitoring alerts
- [ ] Implement log aggregation (e.g., Winston → Elasticsearch)
- [ ] Add performance metrics logging (response times, throughput)
- [ ] Create dashboard for error monitoring

### Phase 3: Advanced Monitoring

- [ ] Integrate with log aggregation service (e.g., ELK, Splunk, Datadog)
- [ ] Set up alerting for critical errors (e.g., circuit breaker opens)
- [ ] Implement distributed tracing for message flows
- [ ] Add business metrics logging (messages sent, payments processed)
- [ ] Create automated log analysis scripts

## Example: Clean Production Logs

**Before** (180+ lines of noise):
```
[dotenv@17.2.3] injecting env (37) from .env -- tip: ⚙️  load multiple .env files...
Resource registered: database-pool
Query completed: undefined rows affected/returned
17:53:50 ℹ️ INFO  [MSG] Starting WhatsApp status update
17:53:50 ℹ️ INFO  [MSG] WhatsApp status update completed successfully
17:53:52 ℹ️ INFO  [MSG] Starting WhatsApp status update
17:53:52 ℹ️ INFO  [MSG] WhatsApp status update completed successfully
... (150+ more lines)
```

**After** (clean, actionable):
```
2025-11-21 17:52:03 [info]: Application started {"env":"production","port":3000,"version":"1.0.0"}
2025-11-21 17:52:14 [info]: WhatsApp client connected {"sessionAge":"6s"}
2025-11-21 17:53:50 [info]: WhatsApp batch send completed {"batchId":"msg_session_2025-11-22","total":26,"sent":26,"failed":0,"duration":"52s"}
```

## Error-Only Mode for Maximum Quietness

For ultra-quiet production logs, set `LOG_LEVEL=error`:

```bash
LOG_LEVEL=error
```

This will **only** log errors, producing minimal output:

```
2025-11-21 18:00:00 [error]: Database connection failed {"server":"Clinic","error":"Connection timeout","code":"ETIMEDOUT"}
2025-11-21 18:05:30 [error]: WhatsApp message delivery failed {"messageId":"msg_123","recipient":"+9647501234567","error":"Rate limit exceeded","retryCount":3}
```

## Contact and Support

For questions about logging:
- Review Winston documentation: https://github.com/winstonjs/winston
- Check `utils/logger.js` for current configuration
- Review this guide: `docs/PRODUCTION_LOGGING_GUIDE.md`

---

**Last Updated**: 2025-11-21
**Maintained By**: Shwan Orthodontics Development Team
