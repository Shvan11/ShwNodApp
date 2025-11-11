# SetVideo Field - Maintenance Guide

## Overview
Added `SetVideo` field to store YouTube URLs for case explanation videos.

**Date:** 2025-11-11
**Status:** Production ✅

---

## Database Schema

### SQL Server (tblAlignerSets)
```sql
SetVideo NVARCHAR(2000) NULL
```

### PostgreSQL/Supabase (aligner_sets)
```sql
set_video VARCHAR(2000)
```

---

## Sync Configuration

**Trigger:** `trg_sync_tblAlignerSets` includes SetVideo field
**Auto-sync:** Changes to SetVideo automatically sync to Supabase via SyncQueue

---

## Files Modified

### Database
- `migrations/sqlserver/10_add_set_video_field.sql` - Add column
- `migrations/sqlserver/11_update_aligner_sets_trigger_for_video.sql` - Update trigger
- `migrations/postgresql/02_add_set_video_field.sql` - External app schema

### Backend
- `routes/api.js` - GET/PUT endpoints include SetVideo
- `utils/youtube-validator.js` - URL validation helpers

### Frontend
- `public/js/pages/aligner/PatientSets.jsx` - Display & edit UI
- `public/js/components/react/SetFormDrawer.jsx` - Form field

---

## Troubleshooting

### Video not syncing to Supabase?

Check trigger includes SetVideo:
```sql
SELECT OBJECT_DEFINITION(OBJECT_ID('trg_sync_tblAlignerSets'))
-- Should contain: i.SetVideo as set_video
```

Check SyncQueue:
```sql
SELECT * FROM SyncQueue
WHERE TableName = 'aligner_sets'
AND Status = 'Failed'
ORDER BY CreatedAt DESC
```

### Re-sync if needed:
```bash
node -e "import('./services/sync/queue-processor.js').then(m => m.default.processQueue())"
```

---

## Accepted URL Formats
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`

---

**Migrations already applied. No further action needed.**
