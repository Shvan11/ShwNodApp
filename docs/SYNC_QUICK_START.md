# Sync System Quick Start

## How It Works

1. **SQL Server triggers** automatically capture changes to tables
2. Changes are stored in the **SyncQueue** table
3. Run the **sync script** to process the queue and sync to Supabase
4. Data becomes available in the external aligner portal

## Quick Commands

### Run Sync Manually
```bash
node scripts/sync.js
```

### Check Pending Syncs (SQL Server)
```sql
SELECT TableName, COUNT(*) as PendingCount
FROM SyncQueue
WHERE Status = 'Pending'
GROUP BY TableName;
```

### Check Failed Syncs (SQL Server)
```sql
SELECT TOP 10 TableName, RecordID, LastError, LastAttempt
FROM SyncQueue
WHERE Status = 'Failed'
ORDER BY LastAttempt DESC;
```

### Retry Failed Syncs
```sql
UPDATE SyncQueue
SET Status = 'Pending', LastError = NULL
WHERE Status = 'Failed';
```

Then run `node scripts/sync.js` again.

## Synced Tables

- ✅ Aligner Doctors
- ✅ Aligner Sets
- ✅ Aligner Batches
- ✅ Aligner Notes
- ✅ Patients
- ✅ Work Records

## Scheduled Syncs

### Option 1: Cron (Linux/WSL)
```bash
# Edit crontab
crontab -e

# Add this line to run every 5 minutes
*/5 * * * * cd /home/administrator/projects/ShwNodApp && node scripts/sync.js >> /var/log/aligner-sync.log 2>&1
```

### Option 2: Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Every 5 minutes
4. Action: Start a program
   - Program: `node`
   - Arguments: `scripts/sync.js`
   - Start in: `C:\path\to\ShwNodApp`

### Option 3: PM2 (Recommended)
```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'aligner-sync',
    script: 'scripts/sync.js',
    cron_restart: '*/5 * * * *',  // Every 5 minutes
    autorestart: false,
    watch: false
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Troubleshooting

### No data syncing?
1. Check if triggers exist:
   ```sql
   SELECT name FROM sys.triggers WHERE name LIKE '%sync%';
   ```

2. Check if changes are in queue:
   ```sql
   SELECT TOP 10 * FROM SyncQueue ORDER BY CreatedAt DESC;
   ```

3. Run sync manually and check for errors:
   ```bash
   node scripts/sync.js
   ```

### Sync taking too long?
Check queue size:
```sql
SELECT Status, COUNT(*) as Count
FROM SyncQueue
GROUP BY Status;
```

If there are thousands of pending records, they'll be processed in batches of 1000.

## API Endpoint

You can also trigger sync via API:

```bash
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"direction": "sql-to-postgres"}'
```

## For More Details

See `docs/SYNC_MIGRATION.md` for full documentation.
