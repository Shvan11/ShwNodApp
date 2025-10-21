# Manual Announcements - Quick Reference

## For Staff: How to Create Announcements

Manual announcements are useful for:
- 🔧 Portal maintenance notifications
- 📢 Feature updates
- ⚠️ Urgent alerts
- 📋 General communications

---

## Method 1: Via Supabase SQL Editor (Recommended)

### Access Supabase Dashboard
1. Go to https://supabase.com
2. Login to your project
3. Click **SQL Editor** in left sidebar
4. Click **New Query**

---

## Common Announcement Types

### 1. Broadcast to All Doctors

```sql
SELECT create_doctor_announcement(
    'Portal Maintenance',
    'The aligner portal will be offline on Sunday, October 25th from 2:00 AM to 4:00 AM for scheduled maintenance. Please plan accordingly.',
    'warning'
);
```

**Parameters:**
- `'Portal Maintenance'` - Title (appears bold)
- `'The aligner portal will...'` - Message (detailed text)
- `'warning'` - Type: `'info'`, `'success'`, `'warning'`, or `'urgent'`
- No doctor_id specified = broadcasts to ALL doctors

---

### 2. Target Specific Doctor

```sql
-- First, find the doctor's ID
SELECT dr_id, doctor_name, doctor_email
FROM aligner_doctors
WHERE doctor_name LIKE '%Smith%';

-- Then create targeted announcement
SELECT create_doctor_announcement(
    'Patient Inquiry',
    'Dr. Smith, please contact the lab regarding patient Ahmed Ali. We have questions about the latest setup.',
    'info',
    3  -- Replace with doctor's dr_id from above query
);
```

---

### 3. Feature Announcement

```sql
SELECT create_doctor_announcement(
    'New Feature: Export Reports',
    'You can now export detailed patient reports directly from the portal! Click on any case and look for the "Export PDF" button.',
    'success'
);
```

---

### 4. Urgent Alert

```sql
SELECT create_doctor_announcement(
    'Action Required: Update Contact Information',
    'Please verify and update your contact information in your profile settings as soon as possible.',
    'urgent'
);
```

---

### 5. With Link

```sql
SELECT create_doctor_announcement(
    'New Tutorial Available',
    'Learn how to use the new batch management features with our video tutorial.',
    'info',
    NULL,
    NULL,
    NULL,
    NULL
);

-- Then add link manually
UPDATE doctor_announcements
SET link_url = 'https://youtu.be/your-tutorial',
    link_text = 'Watch Tutorial'
WHERE title = 'New Tutorial Available';
```

---

## Announcement Types & Colors

| Type | Color | Icon | Use Case |
|------|-------|------|----------|
| `info` | Blue 🔵 | ℹ️ | General information, updates |
| `success` | Green 🟢 | ✓ | Positive news, completions |
| `warning` | Yellow 🟡 | ⚠️ | Caution, scheduled maintenance |
| `urgent` | Red 🔴 | ❗ | Critical, requires immediate action |

---

## Advanced Examples

### Schedule Future Announcement

```sql
INSERT INTO doctor_announcements (
    title,
    message,
    announcement_type,
    created_at,
    expires_at
) VALUES (
    'Upcoming Holiday Hours',
    'The lab will be closed on December 25th. Please plan your batch deliveries accordingly.',
    'info',
    '2025-12-20 09:00:00',  -- Show starting Dec 20
    '2025-12-26 00:00:00'   -- Expire after Dec 25
);
```

### Announcement with Case Reference

```sql
-- Notify doctor about specific case
SELECT create_doctor_announcement(
    'Case Ready for Review',
    'Set #3 for patient Sara Mohammed is ready for your review and approval.',
    'info',
    2,  -- doctor_id
    15  -- aligner_set_id (related case)
);
```

---

## View All Active Announcements

```sql
SELECT
    announcement_id,
    title,
    CASE
        WHEN target_doctor_id IS NULL THEN 'All Doctors'
        ELSE (SELECT doctor_name FROM aligner_doctors WHERE dr_id = target_doctor_id)
    END as target,
    announcement_type,
    created_at,
    (SELECT COUNT(*) FROM doctor_announcement_reads WHERE announcement_id = da.announcement_id) as read_count
FROM doctor_announcements da
WHERE expires_at IS NULL OR expires_at > NOW()
ORDER BY created_at DESC;
```

---

## Manage Announcements

### Edit Announcement

```sql
UPDATE doctor_announcements
SET
    title = 'Updated Title',
    message = 'Updated message text'
WHERE announcement_id = 123;
```

### Delete Announcement

```sql
DELETE FROM doctor_announcements
WHERE announcement_id = 123;
```

### Expire Announcement Early

```sql
UPDATE doctor_announcements
SET expires_at = NOW()
WHERE announcement_id = 123;
```

### Extend Announcement

```sql
UPDATE doctor_announcements
SET expires_at = NOW() + INTERVAL '30 days'
WHERE announcement_id = 123;
```

---

## See Who Read Announcement

```sql
SELECT
    d.doctor_name,
    d.doctor_email,
    CASE
        WHEN r.read_at IS NOT NULL THEN '✅ Read'
        ELSE '⏳ Unread'
    END as status,
    r.read_at
FROM aligner_doctors d
LEFT JOIN doctor_announcement_reads r
    ON d.dr_id = r.dr_id
    AND r.announcement_id = 123  -- Replace with your announcement_id
ORDER BY r.read_at DESC NULLS LAST;
```

---

## Bulk Operations

### Notify All Doctors About Specific Patient

```sql
-- Get all doctors treating this patient
WITH patient_doctors AS (
    SELECT DISTINCT s.aligner_dr_id as dr_id
    FROM aligner_sets s
    JOIN work w ON s.work_id = w.work_id
    WHERE w.person_id = 15  -- Replace with person_id
)
-- Create announcement for each doctor
INSERT INTO doctor_announcements (title, message, announcement_type, target_doctor_id)
SELECT
    'Patient Update Required',
    'Please review the latest treatment plan for your patient.',
    'info',
    dr_id
FROM patient_doctors;
```

### Delete Old Announcements

```sql
-- Delete announcements older than 90 days
DELETE FROM doctor_announcements
WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Templates

### Copy-Paste Templates

**Maintenance Notification:**
```sql
SELECT create_doctor_announcement(
    'Scheduled Maintenance',
    'The portal will be unavailable on [DATE] from [TIME] to [TIME] for system maintenance.',
    'warning'
);
```

**New Feature:**
```sql
SELECT create_doctor_announcement(
    'New Feature: [FEATURE NAME]',
    '[DESCRIPTION]. Try it out in the portal today!',
    'success'
);
```

**Urgent Action:**
```sql
SELECT create_doctor_announcement(
    'Action Required: [SUBJECT]',
    '[DETAILED MESSAGE]. Please respond by [DEADLINE].',
    'urgent'
);
```

**General Update:**
```sql
SELECT create_doctor_announcement(
    '[SUBJECT]',
    '[MESSAGE]',
    'info'
);
```

---

## Best Practices

### ✅ DO:
- Keep titles short and clear (max 50 characters)
- Provide actionable information in messages
- Use appropriate announcement types (don't overuse "urgent")
- Set expiration dates for time-sensitive announcements
- Test with one doctor before broadcasting to all

### ❌ DON'T:
- Create too many announcements (doctors will ignore them)
- Use ALL CAPS or excessive punctuation
- Include sensitive patient information
- Forget to set expiration for temporary announcements
- Mix multiple topics in one announcement

---

## Troubleshooting

### Announcement Not Appearing

**Check 1: Verify it was created**
```sql
SELECT * FROM doctor_announcements
WHERE title LIKE '%your title%';
```

**Check 2: Verify target doctor**
```sql
SELECT
    a.title,
    a.target_doctor_id,
    CASE
        WHEN a.target_doctor_id IS NULL THEN 'Broadcast to all'
        ELSE d.doctor_name
    END as target
FROM doctor_announcements a
LEFT JOIN aligner_doctors d ON a.target_doctor_id = d.dr_id
WHERE a.announcement_id = 123;
```

**Check 3: Check expiration**
```sql
SELECT title, expires_at,
    CASE
        WHEN expires_at IS NULL THEN 'Never expires'
        WHEN expires_at > NOW() THEN 'Active'
        ELSE 'EXPIRED'
    END as status
FROM doctor_announcements
WHERE announcement_id = 123;
```

---

## FAQ

**Q: How long do announcements stay visible?**
A: By default, announcements expire after 30 days. You can override this by setting a custom `expires_at` date.

**Q: Can I undo a sent announcement?**
A: Yes, delete it immediately:
```sql
DELETE FROM doctor_announcements WHERE announcement_id = [ID];
```

**Q: Will doctors see old announcements if they login after a week?**
A: Yes, unread announcements persist until the doctor dismisses them or they expire.

**Q: Can I send attachments?**
A: Not directly, but you can include a link to a file hosted on Google Drive or Dropbox.

**Q: How do I know if doctors are reading announcements?**
A: Use the "See Who Read Announcement" query above to check read status.

---

## Need Help?

For technical assistance or feature requests, contact:
- **System Administrator**: [Your contact info]
- **Documentation**: `/docs/DOCTOR_ANNOUNCEMENTS_SYSTEM.md`

---

## Quick Reference Card

```
╔════════════════════════════════════════════════╗
║        MANUAL ANNOUNCEMENT QUICK REF           ║
╠════════════════════════════════════════════════╣
║                                                ║
║  Broadcast to All:                             ║
║  SELECT create_doctor_announcement(            ║
║    'Title', 'Message', 'type'                  ║
║  );                                            ║
║                                                ║
║  Target Specific Doctor:                       ║
║  SELECT create_doctor_announcement(            ║
║    'Title', 'Message', 'type', doctor_id       ║
║  );                                            ║
║                                                ║
║  Types: 'info', 'success', 'warning', 'urgent' ║
║                                                ║
╚════════════════════════════════════════════════╝
```
