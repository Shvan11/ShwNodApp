# Doctor Announcements System

## Overview

Automatic notification system for doctors using the **External Aligner Portal**. Doctors receive real-time notifications when important events occur in their aligner cases.

**Key Features:**
- ✅ **Fully Automatic** - Notifications are triggered by PostgreSQL database triggers
- ✅ **Real-time** - Uses Supabase Realtime for instant push notifications
- ✅ **Zero Local Changes** - No modifications needed to your staff app or SQL Server
- ✅ **Works via Sync** - All events are detected when data syncs to Supabase

---

## Architecture

```
┌─────────────────┐      Sync Service      ┌──────────────┐
│   SQL Server    │──────(Every 15 min)───→│  Supabase    │
│  (Local Staff)  │                         │ (PostgreSQL) │
└─────────────────┘                         └──────┬───────┘
                                                   │
                                                   │ Triggers Fire
                                                   ↓
                                            ┌──────────────┐
                                            │Announcements │
                                            │    Table     │
                                            └──────┬───────┘
                                                   │
                                                   │ Realtime Push
                                                   ↓
                                            ┌──────────────┐
                                            │Doctor Portal │
                                            │  (External)  │
                                            └──────────────┘
```

---

## Automatic Trigger Events

### 1. New Aligner Set Created
**Trigger:** When staff creates new aligner set in local app
**Notification:** "New Aligner Set Created - Set #2 has been created for Ahmed Ali (Invisalign)"
**Type:** Success (green)

### 2. New Batch Manufactured
**Trigger:** When staff adds new batch to a set
**Notification:** "Batch Manufacturing Started - Batch #3 is being manufactured for Sara (Upper: 10-15, Lower: 8-12)"
**Type:** Info (blue)

### 3. Batch Delivered to Patient
**Trigger:** When `delivered_to_patient_date` is updated
**Notification:** "Batch Delivered Successfully - Batch #2 for Ahmed Ali has been delivered to the patient on Oct 22, 2025"
**Type:** Success (green)

### 4. Lab Sends Note
**Trigger:** When staff adds note with `note_type='Lab'`
**Notification:** "New Message from Lab - Shwan Lab sent a message about Sara: 'Please review the latest setup...'"
**Type:** Info (blue)

### 5. Payment Received
**Trigger:** When `total_paid` is updated
**Notification:**
  - Partial: "Payment Received - Payment of $500 received for Ahmed Ali. Balance: $1000"
  - Complete: "Payment Completed - Full payment received for Ahmed Ali! Total: $1500"
**Type:** Info/Success

### 6. Set Completed
**Trigger:** When `is_active` changes from `true` to `false`
**Notification:** "Treatment Set Completed - Set #1 for Ahmed Ali has been completed!"
**Type:** Success (green)

---

## Database Schema

### Tables

#### `doctor_announcements`
```sql
announcement_id SERIAL PRIMARY KEY
title VARCHAR(200)                -- "Batch Delivered Successfully"
message TEXT                      -- Full message
announcement_type VARCHAR(50)     -- 'info', 'success', 'warning', 'urgent'
target_doctor_id INT              -- NULL = all doctors, ID = specific doctor
related_set_id INT                -- Link to aligner set
related_batch_id INT              -- Link to batch
related_note_id INT               -- Link to note
link_url VARCHAR(500)             -- Optional action link
link_text VARCHAR(100)            -- Link button text
is_dismissible BOOLEAN            -- Can doctor dismiss it?
created_at TIMESTAMPTZ            -- When announcement was created
expires_at TIMESTAMPTZ            -- Auto-expire after 30 days
```

#### `doctor_announcement_reads`
```sql
read_id SERIAL PRIMARY KEY
announcement_id INT               -- Reference to announcement
dr_id INT                         -- Reference to doctor
read_at TIMESTAMPTZ               -- When doctor dismissed it
```

### Triggers

All triggers are attached to Supabase tables and fire automatically when data is synced from SQL Server:

1. `trigger_notify_new_set` - On INSERT to `aligner_sets`
2. `trigger_notify_new_batch` - On INSERT to `aligner_batches`
3. `trigger_notify_batch_delivered` - On UPDATE to `aligner_batches`
4. `trigger_notify_lab_note` - On INSERT to `aligner_notes`
5. `trigger_notify_payment_update` - On UPDATE to `aligner_set_payments`
6. `trigger_notify_set_completed` - On UPDATE to `aligner_sets`

---

## Frontend Implementation

### Notification UI Components

**1. Banner Notifications (Top of Portal)**
- Shows up to 3 most recent unread announcements
- Persistent until dismissed
- Color-coded by type (info=blue, success=green, warning=yellow, urgent=red)
- "Dismiss All" button for quick cleanup

**2. Toast Notifications (Bottom-Right)**
- Appears instantly when new announcement arrives (real-time)
- Auto-dismisses after 5 seconds
- Animated slide-in from right
- Stack multiple toasts

### Real-time Subscription

The portal subscribes to two channels:
```javascript
supabase
  .channel('doctor-announcements')
  .on('postgres_changes', {
    event: 'INSERT',
    table: 'doctor_announcements',
    filter: `target_doctor_id=eq.${doctor.dr_id}`  // Targeted
  })
  .on('postgres_changes', {
    event: 'INSERT',
    table: 'doctor_announcements',
    filter: 'target_doctor_id=is.null'            // Broadcast
  })
  .subscribe();
```

---

## How It Works (Step by Step)

### Example: Staff Delivers Batch

1. **Staff Action (Local App):**
   - Staff opens aligner management
   - Marks batch #3 as "Delivered to Patient" on Oct 22, 2025
   - Saves to SQL Server

2. **Sync Service (Every 15 min):**
   - Sync service polls SQL Server for changes
   - Detects updated `aligner_batches` record
   - Copies update to Supabase

3. **Supabase Trigger (Automatic):**
   - PostgreSQL trigger `trigger_notify_batch_delivered` fires
   - Detects `delivered_to_patient_date` changed from NULL to Oct 22, 2025
   - Calls `create_doctor_announcement()` function
   - Inserts new row into `doctor_announcements` table

4. **Real-time Push:**
   - Supabase Realtime detects INSERT
   - Pushes notification to all subscribed clients
   - Doctor's portal receives notification instantly

5. **Doctor Sees Notification:**
   - **Toast:** Slides in from bottom-right with message
   - **Banner:** Appears at top of portal (persistent)
   - Doctor clicks "✕" to dismiss
   - Row added to `doctor_announcement_reads` table

---

## Manual Announcements (Optional)

Staff can also create manual announcements for:
- Portal maintenance
- Feature updates
- Urgent alerts

### Via SQL (Supabase SQL Editor)

```sql
-- Broadcast to all doctors
SELECT create_doctor_announcement(
    'Portal Maintenance',
    'The portal will be offline on Sunday 2AM-4AM for scheduled maintenance.',
    'warning',
    NULL  -- NULL = all doctors
);

-- Targeted announcement
SELECT create_doctor_announcement(
    'Your Patient Inquiry',
    'Dr. Smith, please contact the lab regarding patient Ahmed Ali.',
    'info',
    3  -- Specific doctor ID
);
```

---

## Testing

### 1. Test with Existing Data

Create a test announcement:

```sql
INSERT INTO doctor_announcements (
    title,
    message,
    announcement_type,
    target_doctor_id,
    expires_at
) VALUES (
    'Welcome to Announcements!',
    'This is a test notification. You will see real-time updates here.',
    'info',
    1,  -- Replace with your test doctor's dr_id
    NOW() + INTERVAL '7 days'
);
```

### 2. Test Real-time Triggers

**Option A: Update existing batch via Supabase SQL Editor**
```sql
UPDATE aligner_batches
SET delivered_to_patient_date = CURRENT_DATE
WHERE aligner_batch_id = 1 AND delivered_to_patient_date IS NULL;
```

**Option B: Wait for sync**
- Staff marks batch as delivered in local app
- Wait 15 minutes for sync
- Notification appears automatically

### 3. Verify in Portal

1. Login to external portal: `https://your-cloudflare-pages-url.com?email=doctor@test.com`
2. Check banner at top (should show unread count)
3. Check console logs: `📬 Loaded X unread announcements`
4. Check real-time subscription: `🔔 Subscribing to real-time announcements`

---

## Customization

### Change Auto-expire Duration

Edit line 130 in migration file or run:
```sql
ALTER TABLE doctor_announcements
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '60 days');
```

### Add New Trigger Event

Example: Notify when wire changes:

```sql
CREATE OR REPLACE FUNCTION notify_wire_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.wire_type IS DISTINCT FROM OLD.wire_type THEN
        PERFORM create_doctor_announcement(
            'Wire Changed',
            format('Wire updated to %s', NEW.wire_type),
            'info',
            (SELECT aligner_dr_id FROM aligner_sets WHERE aligner_set_id = NEW.set_id)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_wire_change
AFTER UPDATE ON visits
FOR EACH ROW
EXECUTE FUNCTION notify_wire_change();
```

### Disable Specific Trigger

```sql
ALTER TABLE aligner_batches DISABLE TRIGGER trigger_notify_new_batch;
```

### Re-enable Trigger

```sql
ALTER TABLE aligner_batches ENABLE TRIGGER trigger_notify_new_batch;
```

---

## Troubleshooting

### No Notifications Appearing

**Check 1: Verify tables exist**
```sql
SELECT COUNT(*) FROM doctor_announcements;
```

**Check 2: Verify triggers are enabled**
```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname LIKE 'trigger_notify%';
```

**Check 3: Check console logs**
Open browser DevTools → Console:
- Look for: `📬 Loaded X unread announcements`
- Look for: `🔔 Subscribing to real-time announcements`

**Check 4: Verify Realtime is enabled in Supabase**
- Go to Supabase Dashboard → Database → Replication
- Ensure `doctor_announcements` table has Realtime enabled

### Notifications Not Real-time

**Issue:** Notifications appear after page refresh but not instantly

**Solution:** Enable Supabase Realtime for the table:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE doctor_announcements;
```

### Too Many Notifications

**Adjust Auto-expire:**
```sql
UPDATE doctor_announcements
SET expires_at = NOW()
WHERE created_at < NOW() - INTERVAL '7 days';
```

---

## Performance Considerations

- **Sync Delay:** Notifications appear within 15 minutes of staff action (or instantly if using webhooks)
- **Database Load:** Minimal - triggers only fire on actual data changes
- **Realtime Connections:** One WebSocket per logged-in doctor
- **Auto-cleanup:** Announcements expire after 30 days (configurable)

---

## Future Enhancements

Potential additions:

1. **Email Notifications** - Send email digest of unread announcements
2. **Push Notifications** - Browser push notifications (requires service worker)
3. **Notification Preferences** - Let doctors choose which events to be notified about
4. **Admin Panel** - UI for staff to create manual announcements
5. **Faster Sync** - Reduce sync interval to 5 minutes or add webhooks for critical events
6. **Notification History** - View all past announcements (currently only shows unread)

---

## Files Modified

### Migrations
- `/migrations/postgresql/announcements/01_create_announcements_system.sql`

### Frontend
- `/aligner-portal-external/src/components/AlignerPortal.jsx` - Added notification state, loading, real-time subscription, and UI components
- `/aligner-portal-external/src/styles.css` - Added announcement and toast styles

### Documentation
- `/docs/DOCTOR_ANNOUNCEMENTS_SYSTEM.md` (this file)

---

## Summary

✅ **Automatic notifications** for 6 key events
✅ **Real-time updates** via Supabase Realtime
✅ **Zero local changes** - works via existing sync
✅ **Beautiful UI** - Banner + toast notifications
✅ **Mobile-friendly** - Responsive design
✅ **Dismissible** - Doctors can mark as read
✅ **Targeted** - Notify specific doctors or broadcast to all

**Total Implementation Time:** ~2 hours
**Maintenance Required:** None (fully automatic)
