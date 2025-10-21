# Doctor Announcements System - Testing Guide

## Quick Test Checklist

### ✅ Step 1: Verify Database Setup

Run in Supabase SQL Editor:

```sql
-- Check tables exist
SELECT
    'doctor_announcements' as table_name,
    COUNT(*) as count
FROM doctor_announcements
UNION ALL
SELECT
    'doctor_announcement_reads',
    COUNT(*)
FROM doctor_announcement_reads;

-- Check triggers exist
SELECT
    tgname as trigger_name,
    CASE tgenabled
        WHEN 'O' THEN 'Enabled'
        WHEN 'D' THEN 'Disabled'
    END as status
FROM pg_trigger
WHERE tgname LIKE 'trigger_notify%'
ORDER BY tgname;
```

**Expected Output:**
- Both tables should exist
- 6 triggers should show as "Enabled"

---

### ✅ Step 2: Create Test Announcement

```sql
-- Create a test announcement for your doctor
SELECT create_doctor_announcement(
    'System Test',
    'This is a test notification to verify the announcement system is working correctly.',
    'info',
    1  -- Replace with your doctor's dr_id
);

-- Verify it was created
SELECT announcement_id, title, message, created_at
FROM doctor_announcements
ORDER BY created_at DESC
LIMIT 1;
```

---

### ✅ Step 3: Test Frontend Display

1. **Open the external portal:**
   ```
   https://your-cloudflare-pages-url.com?email=doctor@test.com
   ```

2. **Check browser console** (F12 → Console tab):
   ```
   Look for:
   ✅ 📬 Loaded 1 unread announcements
   ✅ 🔔 Subscribing to real-time announcements for doctor: 1
   ```

3. **Visual Check:**
   - **Banner should appear** at top of portal (below header)
   - **Should show:** "You have 1 new update"
   - **Message:** "System Test - This is a test notification..."

---

### ✅ Step 4: Test Real-time Push Notification

**While portal is open**, run this in Supabase SQL Editor:

```sql
-- Create another announcement (simulates real event)
SELECT create_doctor_announcement(
    'Real-time Test',
    'If you see this as a toast notification, real-time updates are working!',
    'success',
    1  -- Your doctor's dr_id
);
```

**Expected Result:**
- **Toast notification** should slide in from bottom-right
- **Green color** (success type)
- **Auto-dismisses** after 5 seconds
- **Banner updates** to show "You have 2 new updates"

---

### ✅ Step 5: Test Dismiss Functionality

1. **Click the ✕ button** on any announcement in the banner
2. **Check console:** Should log successful mark as read
3. **Verify in database:**

```sql
SELECT a.title, r.read_at, d.doctor_name
FROM doctor_announcement_reads r
JOIN doctor_announcements a ON r.announcement_id = a.announcement_id
JOIN aligner_doctors d ON r.dr_id = d.dr_id
ORDER BY r.read_at DESC
LIMIT 5;
```

---

### ✅ Step 6: Test Automatic Triggers

#### Test 1: New Batch Trigger

```sql
-- Find an existing set
SELECT aligner_set_id, aligner_dr_id
FROM aligner_sets
WHERE is_active = true
LIMIT 1;

-- Insert a test batch (replace aligner_set_id with value from above)
INSERT INTO aligner_batches (
    aligner_set_id,
    batch_sequence,
    upper_aligner_count,
    lower_aligner_count,
    upper_aligner_start_sequence,
    upper_aligner_end_sequence,
    lower_aligner_start_sequence,
    lower_aligner_end_sequence,
    manufacture_date
) VALUES (
    1,  -- Replace with your set_id
    99, -- Test batch number
    5,
    5,
    1,
    5,
    1,
    5,
    CURRENT_DATE
);

-- Verify announcement was created
SELECT title, message
FROM doctor_announcements
WHERE title = 'Batch Manufacturing Started'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** Announcement created automatically!

#### Test 2: Batch Delivered Trigger

```sql
-- Mark test batch as delivered
UPDATE aligner_batches
SET delivered_to_patient_date = CURRENT_DATE
WHERE batch_sequence = 99;

-- Check announcement
SELECT title, message
FROM doctor_announcements
WHERE title = 'Batch Delivered Successfully'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** New "Batch Delivered Successfully" announcement!

#### Test 3: Lab Note Trigger

```sql
-- Add a lab note (replace aligner_set_id)
INSERT INTO aligner_notes (
    aligner_set_id,
    note_type,
    note_text
) VALUES (
    1,  -- Replace with your set_id
    'Lab',
    'This is a test message from the lab to verify the notification trigger works correctly.'
);

-- Check announcement
SELECT title, message
FROM doctor_announcements
WHERE title = 'New Message from Lab'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** "New Message from Lab" announcement appears!

---

### ✅ Step 7: Cleanup Test Data

```sql
-- Delete test batch
DELETE FROM aligner_batches WHERE batch_sequence = 99;

-- Delete test note
DELETE FROM aligner_notes
WHERE note_text LIKE '%test message from the lab%';

-- Optional: Clear all test announcements
DELETE FROM doctor_announcements
WHERE title IN ('System Test', 'Real-time Test');
```

---

## Verification Checklist

After running all tests, you should have verified:

- [✅] Tables and triggers are created
- [✅] Helper function works (`create_doctor_announcement`)
- [✅] Frontend loads announcements
- [✅] Banner displays correctly
- [✅] Real-time subscription active
- [✅] Toast notifications appear instantly
- [✅] Dismiss functionality works
- [✅] Automatic triggers fire on INSERT/UPDATE
- [✅] Announcements are targeted to correct doctor

---

## Common Issues

### Issue: "Table does not exist"

**Solution:**
```sql
-- Re-run migration
\i /path/to/01_create_announcements_system.sql
```

### Issue: Toast not appearing

**Solution:** Check Supabase Realtime is enabled:
```sql
-- Enable realtime for the table
ALTER PUBLICATION supabase_realtime ADD TABLE doctor_announcements;
```

### Issue: No announcements showing

**Check doctor_id:**
```sql
-- Find your doctor's ID
SELECT dr_id, doctor_name, doctor_email
FROM aligner_doctors;

-- Check announcements for that doctor
SELECT *
FROM doctor_announcements
WHERE target_doctor_id = 1  -- Replace with your dr_id
   OR target_doctor_id IS NULL;
```

---

## Performance Test (Optional)

Test with multiple announcements:

```sql
-- Create 10 test announcements
DO $$
BEGIN
    FOR i IN 1..10 LOOP
        PERFORM create_doctor_announcement(
            'Performance Test #' || i,
            'Testing with multiple announcements - ' || i,
            CASE
                WHEN i % 4 = 0 THEN 'success'
                WHEN i % 4 = 1 THEN 'info'
                WHEN i % 4 = 2 THEN 'warning'
                ELSE 'urgent'
            END,
            1  -- Your doctor_id
        );
    END LOOP;
END $$;
```

**Check:**
- Portal should show "You have 10 new updates"
- Banner should display first 3 announcements
- "+7 more updates" should appear at bottom

**Cleanup:**
```sql
DELETE FROM doctor_announcements WHERE title LIKE 'Performance Test%';
```

---

## Next Steps After Testing

Once all tests pass:

1. ✅ **Document for team** - Share this testing guide
2. ✅ **Monitor production** - Check console logs after first sync
3. ✅ **Gather feedback** - Ask doctors about notification usefulness
4. ✅ **Adjust timing** - Consider reducing sync interval if 15 min is too slow
5. ✅ **Add more triggers** - Based on doctor requests

---

## Test Credentials

For testing purposes, you can access the portal with:

**Development:**
```
http://localhost:5173?email=your-test-doctor@email.com
```

**Production:**
```
https://your-app.pages.dev?email=your-test-doctor@email.com
```

Make sure the email exists in the `aligner_doctors` table!

---

## Automated Testing (Future)

Consider adding automated tests:

1. **Trigger Tests:** Verify each trigger fires correctly
2. **Real-time Tests:** Verify WebSocket connections
3. **UI Tests:** Verify banner and toast rendering
4. **Performance Tests:** Test with 100+ announcements

Example test framework: Playwright + Supabase Test Helpers
