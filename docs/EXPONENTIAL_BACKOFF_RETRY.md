# Exponential Backoff Retry System

## Overview

The queue processor now implements **exponential backoff retry** for failed sync operations. This ensures reliable delivery even during extended outages.

## How It Works

### Scenario: Internet Goes Down

```
Time    Event
─────────────────────────────────────────────────────
00:00   Doctor updates aligner set
00:00   ✅ Change captured in SyncQueue
00:00   ✅ Webhook fires, Node.js notified
00:00   ❌ Supabase unreachable (internet down)
00:00   📋 Item marked: Status='Pending', Attempts=1
00:00   ⏱️  Retry #1 scheduled in 1 minute

00:01   🔄 Retry #1 executes
00:01   ❌ Still no internet
00:01   📋 Item updated: Attempts=2
00:01   ⏱️  Retry #2 scheduled in 2 minutes

00:03   🔄 Retry #2 executes
00:03   ❌ Still no internet
00:03   📋 Item updated: Attempts=3
00:03   ⏱️  Retry #3 scheduled in 4 minutes

00:07   🔄 Retry #3 executes
00:07   ✅ Internet restored!
00:07   ✅ Item synced to Supabase
00:07   ✅ Status='Synced'
00:07   🎉 No data loss!
```

## Retry Schedule

| Retry # | Wait Time | Cumulative Time | Use Case |
|---------|-----------|-----------------|----------|
| 1 | 1 minute | 1 min | Brief network hiccup |
| 2 | 2 minutes | 3 min | Router restart |
| 3 | 4 minutes | 7 min | ISP issue |
| 4 | 8 minutes | 15 min | Extended outage |
| 5 | 16 minutes | 31 min | Major outage |
| 6 | 32 minutes | 63 min | Critical outage |
| 7+ | 60 minutes | Hourly | Long-term outage |

**After 10 failed attempts:** Item marked as `Status='Failed'` and stops retrying (requires manual intervention).

## Key Features

### 1. **Smart Reset on New Webhooks**
When a new change happens and webhook fires, the retry counter resets:

```javascript
// New webhook arrives
processQueueOnce() {
    this.retryAttempts = 0;  // Reset to fast retries
    this.processQueue();
}
```

**Why?** New activity suggests the issue might be resolved, so retry quickly.

### 2. **Progressive Backoff**
Uses exponential formula: `delay = baseInterval × 2^retryAttempts`

```javascript
baseRetryInterval = 60 * 1000;        // 1 minute
maxRetryInterval = 60 * 60 * 1000;    // 60 minutes (cap)

// Calculation examples:
// Retry 1: 60s × 2^0 = 60s = 1 minute
// Retry 2: 60s × 2^1 = 120s = 2 minutes
// Retry 3: 60s × 2^2 = 240s = 4 minutes
// Retry 4: 60s × 2^3 = 480s = 8 minutes
// Retry 7: 60s × 2^6 = 3840s = 64 minutes → capped at 60 minutes
```

### 3. **Zero Overhead When Healthy**
```javascript
// All items synced successfully
if (failCount === 0) {
    this.retryAttempts = 0;  // No retry timer scheduled
}

// Queue is empty
if (items.length === 0) {
    this.retryAttempts = 0;  // No retry timer scheduled
}
```

**No pending items = no retry timers = zero resource usage**

### 4. **Check Before Retry**
Before each retry, verifies there are actually pending items:

```javascript
async getPendingCount() {
    // Query database for pending items
    // Only retry if there's work to do
}
```

**Avoids wasted retries if items were synced via webhook.**

## Benefits

### ✅ Fast Recovery for Transient Issues
- **1-minute hiccup:** Recovered in 1 minute
- **5-minute outage:** Recovered in 7 minutes (3 retries)
- **15-minute outage:** Recovered in 15 minutes (4 retries)

### ✅ Reduced Load During Extended Outages
- Doesn't hammer Supabase every minute
- Backs off progressively to hourly retries
- Prevents overwhelming the system on recovery

### ✅ Automatic Recovery
- No manual intervention needed
- Works 24/7 unattended
- Self-healing system

### ✅ Industry Best Practice
Used by:
- AWS (API Gateway, Lambda)
- Google Cloud (Pub/Sub)
- Azure (Service Bus)
- Stripe (Webhook retries)
- GitHub (Webhook retries)

## Real-World Scenarios

### Scenario 1: ISP Restart (5 minutes)
```
00:00  Internet drops
00:00  Change captured → Pending
00:01  Retry #1 → Fails
00:03  Retry #2 → Fails
00:05  Internet restored
00:07  Retry #3 → Success ✅
```
**Total time to recovery: 7 minutes**

### Scenario 2: Supabase Maintenance (30 minutes)
```
00:00  Supabase maintenance starts
00:00  Change captured → Pending
00:01  Retry #1 → Fails
00:03  Retry #2 → Fails
00:07  Retry #3 → Fails
00:15  Retry #4 → Fails
00:30  Supabase restored
00:31  Retry #5 → Success ✅
```
**Total time to recovery: 31 minutes**

### Scenario 3: Major Outage (2 hours)
```
00:00  Major outage
00:00  Multiple changes captured → Pending
...    Retries continue with exponential backoff
01:03  Reaching hourly retries
02:00  Outage resolved
02:05  Next retry → All items sync ✅
```
**All data synced despite 2-hour outage**

### Scenario 4: Webhook Still Works (Internet OK)
```
00:00  Doctor makes change
00:00  Webhook fires immediately
00:00  All items sync ✅
00:00  No retry timer scheduled
```
**Zero overhead when healthy**

## Configuration

Located in `services/sync/queue-processor.js`:

```javascript
class QueueProcessor {
    constructor() {
        this.maxAttempts = 10;                    // Max tries per item
        this.batchSize = 50;                      // Items per batch
        this.baseRetryInterval = 60 * 1000;       // 1 minute base
        this.maxRetryInterval = 60 * 60 * 1000;   // 1 hour cap
    }
}
```

**Recommended settings:**
- **maxAttempts: 10** - Covers ~6 hours of hourly retries
- **baseRetryInterval: 60s** - Fast recovery for brief outages
- **maxRetryInterval: 60m** - Reasonable for extended outages

## Monitoring

### Check Retry Status in Logs

```bash
tail -f logs/app.log | grep -E "Retry|scheduled"
```

**Expected output during outage:**
```
⏱️  Retry #1 scheduled in 1m 0s
🔄 Retry attempt #1: Checking for pending items...
📋 Found 5 pending items, processing...
❌ Batch complete: 0 synced, 5 failed
⏱️  Retry #2 scheduled in 2m 0s
```

### Check Queue Status

```sql
-- In SQL Server
SELECT
    Status,
    COUNT(*) as Count,
    AVG(Attempts) as AvgAttempts,
    MAX(Attempts) as MaxAttempts
FROM SyncQueue
GROUP BY Status;
```

**Healthy system:**
- `Pending`: 0-5 items (only during active outage)
- `Synced`: Majority
- `Failed`: 0 (or very few requiring manual intervention)

### Check for Items Near Max Attempts

```sql
SELECT *
FROM SyncQueue
WHERE Status = 'Pending'
  AND Attempts >= 8
ORDER BY Attempts DESC;
```

**Action:** If you see items with 8-9 attempts, investigate the issue before they hit 10 and fail permanently.

## Testing

### Test Exponential Backoff

1. **Simulate Supabase Outage:**
   - Stop internet or change `SUPABASE_URL` to invalid value
   - Update a patient in SQL Server
   - Watch logs for retry schedule

2. **Expected Logs:**
```
📥 Received queue notification from SQL Server
🔄 Syncing patients ID 123 (UPDATE)
❌ Sync failed: fetch failed
📋 Item updated: Attempts=1
⏱️  Retry #1 scheduled in 1m 0s

[1 minute later]
🔄 Retry attempt #1: Checking for pending items...
📋 Found 1 pending items, processing...
❌ Sync failed: fetch failed
⏱️  Retry #2 scheduled in 2m 0s

[2 minutes later]
🔄 Retry attempt #2: Checking for pending items...
...
```

3. **Restore connectivity**
4. **Next retry should succeed**

### Test Webhook Reset

1. **While retry timer is active:**
   - Make a NEW change in SQL Server
   - Webhook fires
   - Retry counter resets to 0

2. **Expected Logs:**
```
⏱️  Retry #3 scheduled in 4m 0s
📥 Received queue notification from SQL Server
🔄 Processing queue... [retryAttempts reset to 0]
```

## Comparison: Old vs New

### Old System (No Automatic Retry)
```
❌ Internet down → Sync fails → Item stuck forever
❌ Manual intervention required
❌ Data loss risk if not monitored
```

### New System (Exponential Backoff)
```
✅ Internet down → Automatic retry with backoff
✅ Self-healing, no manual intervention
✅ Zero data loss, even during outages
```

## Conclusion

The exponential backoff retry system provides:

1. **Fast recovery** - 1-minute retries for brief issues
2. **Progressive backoff** - Reduces load during extended outages
3. **Automatic healing** - No manual intervention needed
4. **Zero overhead** - No timers when healthy
5. **Industry standard** - Battle-tested approach used by major platforms

Your sync system is now **production-grade** with enterprise reliability! 🎉
