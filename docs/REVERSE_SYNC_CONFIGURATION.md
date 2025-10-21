# Reverse Sync Configuration Guide

## Overview

The **Reverse Sync Poller** is a resource-friendly system that catches changes from the external app (Supabase) when the main server is offline. It runs automatically at startup and periodically (hourly by default) to ensure no changes are missed.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ DUAL-DIRECTION SYNC SYSTEM                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. SQL Server → Supabase (Real-time via Webhooks)         │
│     ├─ Triggers fire on data changes                       │
│     ├─ HTTP POST to /api/sync/queue-notify                 │
│     └─ Queue processor syncs to Supabase                   │
│                                                              │
│  2. Supabase → SQL Server (Webhook + Polling Hybrid)       │
│     ├─ PRIMARY: Supabase webhooks (real-time)              │
│     │   └─ HTTP POST to /api/sync/webhook                  │
│     └─ FALLBACK: Reverse sync poller                       │
│         ├─ Runs at server startup (catches missed changes)  │
│         └─ Runs hourly (catches webhook failures)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why We Need Both Webhooks AND Polling

**Webhooks** (Real-time):
- Instant synchronization when doctor adds/edits notes
- Zero resource usage when no changes occur
- Ideal for normal operation

**Polling** (Fallback):
- Catches changes that occurred while server was offline
- Recovers from webhook failures (network issues, etc.)
- Ensures eventual consistency
- Resource-friendly (only runs hourly)

## Resource-Friendly Design

### Smart Features

1. **Timestamp-Based Queries**: Only fetches records changed since last sync
2. **State Persistence**: Saves last sync time to avoid duplicate processing
3. **Record Limits**: Prevents memory overflow on large backlogs (500 max per poll)
4. **Lazy Initialization**: Only connects to Supabase if credentials exist
5. **Non-Blocking**: Errors don't crash the server - they're logged and retried
6. **Configurable Intervals**: Adjust frequency based on your needs

## Environment Variables

Add these to your `.env` file to configure reverse sync:

```bash
# ===== REVERSE SYNC CONFIGURATION =====

# Enable/disable reverse sync poller (default: true)
REVERSE_SYNC_ENABLED=true

# Polling interval in minutes (default: 60 = 1 hour)
# Lower values = more frequent checks, higher resource usage
# Higher values = less frequent checks, lower resource usage
REVERSE_SYNC_INTERVAL_MINUTES=60

# Lookback window on first startup in hours (default: 24)
# How far back to check for missed changes when server starts
REVERSE_SYNC_LOOKBACK_HOURS=24

# Maximum records to sync per poll (default: 500)
# Prevents memory issues if there's a large backlog
REVERSE_SYNC_MAX_RECORDS=500
```

## Configuration Examples

### Scenario 1: High-Frequency Clinic (Busy Practice)

```bash
# Check every 30 minutes for better responsiveness
REVERSE_SYNC_INTERVAL_MINUTES=30

# Only look back 12 hours on startup (server rarely down)
REVERSE_SYNC_LOOKBACK_HOURS=12

# Process more records per poll (powerful server)
REVERSE_SYNC_MAX_RECORDS=1000
```

**Resource Impact**: Medium
**Best For**: Clinics with reliable uptime and powerful servers

---

### Scenario 2: Low-Frequency Clinic (Small Practice) - **RECOMMENDED**

```bash
# Check every 60 minutes (default - very resource friendly)
REVERSE_SYNC_INTERVAL_MINUTES=60

# Look back 24 hours on startup
REVERSE_SYNC_LOOKBACK_HOURS=24

# Standard batch size
REVERSE_SYNC_MAX_RECORDS=500
```

**Resource Impact**: Low (default settings)
**Best For**: Most clinics - balances reliability with resource usage

---

### Scenario 3: Unreliable Network/Power

```bash
# Check every 2 hours (very light on resources)
REVERSE_SYNC_INTERVAL_MINUTES=120

# Look back 72 hours on startup (server often down)
REVERSE_SYNC_LOOKBACK_HOURS=72

# Smaller batches to avoid timeouts on slow connections
REVERSE_SYNC_MAX_RECORDS=250
```

**Resource Impact**: Very Low
**Best For**: Clinics with frequent outages or slow internet

---

### Scenario 4: Disable Reverse Sync (Webhooks Only)

```bash
# Disable periodic polling - rely only on webhooks
REVERSE_SYNC_ENABLED=false
```

**Resource Impact**: None (no polling at all)
**Best For**: Testing environments or if you have 100% reliable uptime
**WARNING**: Changes made while server is offline will NOT be synced

## How to Monitor

### Startup Logs

When the server starts, you'll see:

```
⏰ Starting periodic reverse sync (every 60 minutes)
   Lookback window: 24h
   Max records per poll: 500

🚀 Running initial reverse sync on startup...
🔄 Starting reverse sync poll (Supabase → SQL Server)

🔍 Polling for notes since 1/20/2025, 10:00:00 AM
   ✓ No new notes found

🔍 Polling for batch updates since 1/20/2025, 10:00:00 AM
   ✓ No batch updates found

✅ Reverse sync complete: 0 notes, 0 batches (234ms)
✓ Startup sync complete - no missed changes
```

### If Changes Were Missed

```
🚀 Running initial reverse sync on startup...
🔄 Starting reverse sync poll (Supabase → SQL Server)

🔍 Polling for notes since 1/20/2025, 10:00:00 AM
   📝 Found 5 note(s) to sync
   ✅ Synced 5/5 notes (0 errors)

🔍 Polling for batch updates since 1/20/2025, 10:00:00 AM
   📦 Found 2 edited batch(es) (3 total)
   ✅ Synced 2/2 batch updates (0 errors)

✅ Reverse sync complete: 5 notes, 2 batches (456ms)
🎉 Startup sync recovered 7 missed changes
```

### Hourly Checks

Every hour (or your configured interval), you'll see:

```
🔄 Starting reverse sync poll (Supabase → SQL Server)
🔍 Polling for notes since 1/21/2025, 2:00:00 PM
   ✓ No new notes found
🔍 Polling for batch updates since 1/21/2025, 2:00:00 PM
   ✓ No batch updates found
✅ Reverse sync complete: 0 notes, 0 batches (123ms)
```

## State File

The sync state is saved to `/data/reverse-sync-state.json`:

```json
{
  "lastNotesSync": "2025-01-21T14:00:00.000Z",
  "lastBatchesSync": "2025-01-21T14:00:00.000Z",
  "lastPollTime": "2025-01-21T14:00:00.000Z"
}
```

This ensures the poller only checks for changes since the last successful sync.

## Performance Characteristics

### Database Impact

**Per Poll Cycle** (assuming 500 record limit):
- 1 query to Supabase `aligner_notes` table (with timestamp filter)
- 1 query to Supabase `aligner_batches` table (with timestamp filter)
- N queries to SQL Server (where N = number of changed records)

**Typical Scenarios**:
- **No changes**: ~100-200ms, 2 lightweight SELECT queries
- **5 changes**: ~500ms, 2 SELECT + 5 INSERT/UPDATE queries
- **500 changes**: ~10-30 seconds, 2 SELECT + 500 INSERT/UPDATE queries

### Memory Usage

- **State file**: < 1 KB
- **Per poll**: ~1-5 MB (depending on record count)
- **Steady state**: Minimal (poller is idle between runs)

### Network Usage

- **Per poll with no changes**: < 10 KB (2 small queries)
- **Per poll with 100 changes**: ~100-500 KB (depending on note size)

## Troubleshooting

### Sync Not Running

Check logs for:

```
⏭️  Periodic reverse sync disabled via REVERSE_SYNC_ENABLED=false
```
**Solution**: Set `REVERSE_SYNC_ENABLED=true` in `.env`

---

```
⏭️  Supabase not configured - periodic reverse sync disabled
```
**Solution**: Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env`

### Sync Failing

Check logs for error details:

```
❌ Reverse sync failed: <error message>
```

**Common causes**:
1. **Network issues**: Check internet connection
2. **Invalid credentials**: Verify Supabase keys
3. **SQL Server down**: Check database connectivity
4. **Table schema mismatch**: Run migrations

### Changes Still Missing

1. Check if webhook sync is working (`POST /api/sync/webhook`)
2. Check Supabase webhook configuration
3. Manually trigger sync: `POST /api/sync/trigger`
4. Check reverse sync state file: `/data/reverse-sync-state.json`
5. Delete state file to force full resync from lookback window

## Best Practices

### Recommended Settings

1. **Use Default Settings**: They're optimized for 99% of use cases
2. **Monitor Startup Logs**: Ensure initial sync completes successfully
3. **Keep State File**: Don't delete `/data/reverse-sync-state.json` unless troubleshooting
4. **Backup State File**: Include in your backup strategy

### When to Adjust Settings

**Increase Frequency** (lower `REVERSE_SYNC_INTERVAL_MINUTES`) if:
- You have frequent webhook failures
- You need faster recovery from missed changes
- Server uptime is unreliable

**Decrease Frequency** (higher `REVERSE_SYNC_INTERVAL_MINUTES`) if:
- You have limited server resources
- Webhooks are 100% reliable
- You rarely have missed changes

**Increase Lookback Window** (`REVERSE_SYNC_LOOKBACK_HOURS`) if:
- Server is often offline for extended periods
- You need to catch changes from days ago

**Decrease Lookback Window** if:
- Server uptime is very reliable
- You want faster startup times

## Manual Sync

You can manually trigger a reverse sync via API:

```bash
# Trigger manual sync
curl -X POST http://localhost:3000/api/sync/manual-reverse-sync
```

Add this endpoint to `routes/sync-webhook.js` if needed (currently not implemented).

## Summary

The reverse sync poller is a **set-it-and-forget-it** system that:

✅ Automatically catches missed changes at startup
✅ Runs hourly as a fallback for webhook failures
✅ Uses minimal resources (< 5 MB memory, < 1% CPU)
✅ Configurable via environment variables
✅ Non-blocking (errors don't crash server)
✅ Production-ready with robust error handling

**Recommendation**: Use default settings unless you have specific needs. The system is designed to "just work" with minimal configuration.
