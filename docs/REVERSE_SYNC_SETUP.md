# Reverse Sync Setup (Supabase → SQL Server)

## Overview

Doctors can edit two things in the external aligner portal:
1. **Add notes** to aligner sets
2. **Edit days per aligner** for batches

These changes need to sync back from Supabase to SQL Server.

## Hybrid Approach

We use a **hybrid sync strategy** for reliability:

### 1. Real-Time Webhook (Instant)
When server is running, webhooks deliver changes immediately.

**Endpoint:** `POST /api/sync/webhook`
**Handles:**
- New notes (`aligner_notes` INSERT)
- Batch days updates (`aligner_batches` UPDATE)

### 2. Periodic Polling (Catch-up)
When server starts or runs hourly, polls for missed changes.

**Schedule:**
- On server startup: Polls immediately
- Every 60 minutes: Polls for changes

**Catches:**
- Changes made while server was offline
- Webhook delivery failures (backup)

## How It Works

```
Doctor edits in portal
         ↓
   Supabase updated
         ↓
    ┌────┴────┐
    │         │
Webhook    Polling
(instant)  (hourly)
    │         │
    └────┬────┘
         ↓
   SQL Server
```

## Configuration

### Environment Variables
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key
```

### Polling Interval
Default: 60 minutes

To change, edit `index.js` line 315:
```javascript
startPeriodicPolling(30); // Poll every 30 minutes
```

## State Tracking

Last sync times are stored in: `data/reverse-sync-state.json`

```json
{
  "lastNotesSync": "2025-10-21T12:00:00.000Z",
  "lastBatchesSync": "2025-10-21T12:00:00.000Z",
  "lastPollTime": "2025-10-21T12:00:00.000Z"
}
```

This ensures we only sync new changes, not everything every time.

## Setting Up Supabase Webhooks

1. Go to **Supabase Dashboard → Database → Webhooks**

2. **Create webhook for notes:**
   - Name: `aligner_notes_to_sqlserver`
   - Table: `aligner_notes`
   - Events: `INSERT`, `UPDATE` (check both)
   - Type: `HTTP Request`
   - Method: `POST`
   - URL: `https://your-server.com/api/sync/webhook`
   - HTTP Headers: `Content-Type: application/json`

3. **Create webhook for batch days:**
   - Name: `aligner_batches_to_sqlserver`
   - Table: `aligner_batches`
   - Events: `UPDATE`
   - Type: `HTTP Request`
   - Method: `POST`
   - URL: `https://your-server.com/api/sync/webhook`
   - HTTP Headers: `Content-Type: application/json`

## Testing

### Test Webhook (Real-time)
1. Start your server: `node index.js`
2. Add a note in the external portal
3. Check server logs for: `📥 Received Supabase webhook`
4. Verify note appears in SQL Server `tblAlignerNotes`

### Test Polling (Catch-up)
1. Stop your server
2. Add a note in the external portal
3. Start your server: `node index.js`
4. Check logs for: `🔄 Starting reverse sync poll`
5. Verify note appears in SQL Server

### Manual Poll Trigger
```bash
# Check what would be synced
curl http://localhost:3000/api/sync/status
```

## Monitoring

### Check Sync Status
```sql
-- Check most recent notes in SQL Server
SELECT TOP 5 NoteID, NoteText, CreatedAt
FROM tblAlignerNotes
ORDER BY CreatedAt DESC;

-- Check batch days updates
SELECT TOP 5 AlignerBatchID, Days
FROM tblAlignerBatches
ORDER BY AlignerBatchID DESC;
```

### Server Logs
```bash
# Watch for sync activity
tail -f logs/app.log | grep -E "sync|webhook|poll"
```

Look for:
- `✅ Reverse sync polling started`
- `📥 Received Supabase webhook`
- `🔄 Starting reverse sync poll`
- `✅ Poll complete: X notes, Y batches`

## Troubleshooting

### Webhook not firing?
1. Check Supabase webhook logs in dashboard
2. Verify server URL is accessible from internet
3. Test with: `curl -X POST http://your-server/api/sync/webhook -d '{}'`

### Polling not working?
1. Check `data/reverse-sync-state.json` exists and has valid timestamps
2. Verify Supabase credentials in `.env`
3. Check server logs for polling errors

### Changes not syncing?
1. Check if changes are in Supabase:
   ```sql
   SELECT * FROM aligner_notes ORDER BY created_at DESC LIMIT 5;
   ```
2. Check server logs for errors
3. Manually trigger poll (server will catch up on next startup)

## Architecture

**Files:**
- `services/sync/reverse-sync-poller.js` - Polling logic
- `services/sync/sync-engine.js` - Webhook handlers (postgresToSql class)
- `routes/sync-webhook.js` - Webhook endpoint
- `index.js` - Startup integration

**Flow:**
1. Doctor edits in portal → Supabase updated
2. Supabase fires webhook → `/api/sync/webhook`
3. Webhook handler syncs to SQL Server instantly
4. Hourly poll catches any missed changes as backup
5. State file tracks last sync to avoid duplicates

## Benefits

✅ **Instant updates** when server is online (webhook)
✅ **Reliable catch-up** when server restarts (polling)
✅ **No data loss** even if server is offline for days
✅ **Efficient** - only syncs new changes, not everything
✅ **Redundant** - webhook + polling ensures delivery
