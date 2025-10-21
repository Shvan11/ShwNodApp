-- ============================================================================
-- Doctor Announcements System
-- ============================================================================
-- Purpose: Automatic notifications for doctors when events occur
-- Approach: PostgreSQL triggers create announcements automatically
-- No changes needed to local app - works via existing sync!
-- ============================================================================

-- ============================================================================
-- 1. ANNOUNCEMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS doctor_announcements (
    announcement_id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    announcement_type VARCHAR(50) DEFAULT 'info' CHECK (
        announcement_type IN ('info', 'success', 'warning', 'urgent')
    ),
    target_doctor_id INT NULL REFERENCES aligner_doctors(dr_id) ON DELETE CASCADE,
    -- NULL = all doctors, specific ID = targeted announcement

    -- Optional metadata
    related_set_id INT NULL REFERENCES aligner_sets(aligner_set_id) ON DELETE CASCADE,
    related_batch_id INT NULL REFERENCES aligner_batches(aligner_batch_id) ON DELETE CASCADE,
    related_note_id INT NULL REFERENCES aligner_notes(note_id) ON DELETE CASCADE,

    -- Links and actions
    link_url VARCHAR(500) NULL,
    link_text VARCHAR(100) NULL,

    -- Lifecycle
    is_dismissible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,

    -- Index for fast queries
    CONSTRAINT valid_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- Indexes for performance
CREATE INDEX idx_announcements_doctor ON doctor_announcements(target_doctor_id) WHERE target_doctor_id IS NOT NULL;
CREATE INDEX idx_announcements_created ON doctor_announcements(created_at DESC);
CREATE INDEX idx_announcements_active ON doctor_announcements(expires_at) WHERE expires_at IS NULL OR expires_at > NOW();

COMMENT ON TABLE doctor_announcements IS 'Automatic notifications for doctors about treatment events';
COMMENT ON COLUMN doctor_announcements.target_doctor_id IS 'NULL = broadcast to all doctors, specific ID = targeted';
COMMENT ON COLUMN doctor_announcements.announcement_type IS 'Visual styling: info (blue), success (green), warning (yellow), urgent (red)';

-- ============================================================================
-- 2. READ TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS doctor_announcement_reads (
    read_id SERIAL PRIMARY KEY,
    announcement_id INT NOT NULL REFERENCES doctor_announcements(announcement_id) ON DELETE CASCADE,
    dr_id INT NOT NULL REFERENCES aligner_doctors(dr_id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate reads
    UNIQUE(announcement_id, dr_id)
);

-- Index for fast "unread count" queries
CREATE INDEX idx_announcement_reads_doctor ON doctor_announcement_reads(dr_id);
CREATE INDEX idx_announcement_reads_announcement ON doctor_announcement_reads(announcement_id);

COMMENT ON TABLE doctor_announcement_reads IS 'Tracks which doctors have read which announcements';

-- ============================================================================
-- 3. ROW-LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE doctor_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_announcement_reads ENABLE ROW LEVEL SECURITY;

-- Doctors can only see announcements targeted to them or global ones
CREATE POLICY "Doctors view their announcements"
ON doctor_announcements FOR SELECT
USING (
    target_doctor_id IS NULL  -- Global announcement
    OR target_doctor_id = auth.uid()::int  -- Targeted to them
);

-- Doctors can mark announcements as read
CREATE POLICY "Doctors mark as read"
ON doctor_announcement_reads FOR INSERT
WITH CHECK (dr_id = auth.uid()::int);

-- Doctors can view their own read status
CREATE POLICY "Doctors view their read status"
ON doctor_announcement_reads FOR SELECT
USING (dr_id = auth.uid()::int);

COMMENT ON POLICY "Doctors view their announcements" ON doctor_announcements IS 'Doctors see global or targeted announcements only';

-- ============================================================================
-- 4. HELPER FUNCTION: Create Announcement
-- ============================================================================

CREATE OR REPLACE FUNCTION create_doctor_announcement(
    p_title VARCHAR,
    p_message TEXT,
    p_type VARCHAR DEFAULT 'info',
    p_doctor_id INT DEFAULT NULL,
    p_set_id INT DEFAULT NULL,
    p_batch_id INT DEFAULT NULL,
    p_note_id INT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_announcement_id INT;
BEGIN
    INSERT INTO doctor_announcements (
        title,
        message,
        announcement_type,
        target_doctor_id,
        related_set_id,
        related_batch_id,
        related_note_id,
        expires_at
    ) VALUES (
        p_title,
        p_message,
        p_type,
        p_doctor_id,
        p_set_id,
        p_batch_id,
        p_note_id,
        NOW() + INTERVAL '30 days'  -- Auto-expire after 30 days
    ) RETURNING announcement_id INTO v_announcement_id;

    RETURN v_announcement_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_doctor_announcement IS 'Helper function to create announcements with consistent structure';

-- ============================================================================
-- 5. TRIGGER FUNCTIONS: Automatic Notifications
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EVENT 1: New Aligner Set Created
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_new_set()
RETURNS TRIGGER AS $$
DECLARE
    v_patient_name VARCHAR;
    v_work_type VARCHAR;
BEGIN
    -- Get patient info
    SELECT p.patient_name, w.type_of_work
    INTO v_patient_name, v_work_type
    FROM work w
    LEFT JOIN patients p ON w.person_id = p.person_id
    WHERE w.work_id = NEW.work_id;

    -- Create announcement
    PERFORM create_doctor_announcement(
        'New Aligner Set Created',
        format('Set #%s has been created for %s (%s)',
            NEW.set_sequence,
            COALESCE(v_patient_name, 'Patient'),
            COALESCE(v_work_type, 'Treatment')),
        'success',
        NEW.aligner_dr_id,
        NEW.aligner_set_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_new_set
AFTER INSERT ON aligner_sets
FOR EACH ROW
EXECUTE FUNCTION notify_new_set();

COMMENT ON FUNCTION notify_new_set IS 'Auto-notify doctor when new aligner set is created';

-- ----------------------------------------------------------------------------
-- EVENT 2: New Batch Manufactured
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_new_batch()
RETURNS TRIGGER AS $$
DECLARE
    v_doctor_id INT;
    v_set_id INT;
    v_patient_name VARCHAR;
BEGIN
    -- Get set and doctor info
    SELECT s.aligner_dr_id, s.aligner_set_id, p.patient_name
    INTO v_doctor_id, v_set_id, v_patient_name
    FROM aligner_sets s
    LEFT JOIN work w ON s.work_id = w.work_id
    LEFT JOIN patients p ON w.person_id = p.person_id
    WHERE s.aligner_set_id = NEW.aligner_set_id;

    -- Create announcement
    PERFORM create_doctor_announcement(
        'Batch Manufacturing Started',
        format('Batch #%s is being manufactured for %s (Upper: %s-%s, Lower: %s-%s)',
            NEW.batch_sequence,
            COALESCE(v_patient_name, 'patient'),
            COALESCE(NEW.upper_aligner_start_sequence::text, 'N/A'),
            COALESCE(NEW.upper_aligner_end_sequence::text, 'N/A'),
            COALESCE(NEW.lower_aligner_start_sequence::text, 'N/A'),
            COALESCE(NEW.lower_aligner_end_sequence::text, 'N/A')),
        'info',
        v_doctor_id,
        v_set_id,
        NEW.aligner_batch_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_new_batch
AFTER INSERT ON aligner_batches
FOR EACH ROW
EXECUTE FUNCTION notify_new_batch();

COMMENT ON FUNCTION notify_new_batch IS 'Auto-notify doctor when new batch is manufactured';

-- ----------------------------------------------------------------------------
-- EVENT 3: Batch Delivered to Patient
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_batch_delivered()
RETURNS TRIGGER AS $$
DECLARE
    v_doctor_id INT;
    v_set_id INT;
    v_patient_name VARCHAR;
BEGIN
    -- Only trigger when batch is newly delivered
    IF OLD.delivered_to_patient_date IS NULL AND NEW.delivered_to_patient_date IS NOT NULL THEN

        -- Get info
        SELECT s.aligner_dr_id, s.aligner_set_id, p.patient_name
        INTO v_doctor_id, v_set_id, v_patient_name
        FROM aligner_sets s
        LEFT JOIN work w ON s.work_id = w.work_id
        LEFT JOIN patients p ON w.person_id = p.person_id
        WHERE s.aligner_set_id = NEW.aligner_set_id;

        -- Create announcement
        PERFORM create_doctor_announcement(
            'Batch Delivered Successfully',
            format('Batch #%s for %s has been delivered to the patient on %s',
                NEW.batch_sequence,
                COALESCE(v_patient_name, 'patient'),
                TO_CHAR(NEW.delivered_to_patient_date, 'Mon DD, YYYY')),
            'success',
            v_doctor_id,
            v_set_id,
            NEW.aligner_batch_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_batch_delivered
AFTER UPDATE ON aligner_batches
FOR EACH ROW
EXECUTE FUNCTION notify_batch_delivered();

COMMENT ON FUNCTION notify_batch_delivered IS 'Auto-notify doctor when batch is delivered to patient';

-- ----------------------------------------------------------------------------
-- EVENT 4: Lab Sends Note
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_lab_note()
RETURNS TRIGGER AS $$
DECLARE
    v_doctor_id INT;
    v_set_id INT;
    v_patient_name VARCHAR;
    v_preview TEXT;
BEGIN
    -- Only trigger for Lab notes
    IF NEW.note_type = 'Lab' THEN

        -- Get info
        SELECT s.aligner_dr_id, s.aligner_set_id, p.patient_name
        INTO v_doctor_id, v_set_id, v_patient_name
        FROM aligner_sets s
        LEFT JOIN work w ON s.work_id = w.work_id
        LEFT JOIN patients p ON w.person_id = p.person_id
        WHERE s.aligner_set_id = NEW.aligner_set_id;

        -- Create preview (first 100 chars)
        v_preview := LEFT(NEW.note_text, 100);
        IF LENGTH(NEW.note_text) > 100 THEN
            v_preview := v_preview || '...';
        END IF;

        -- Create announcement
        PERFORM create_doctor_announcement(
            'New Message from Lab',
            format('Shwan Lab sent a message about %s: "%s"',
                COALESCE(v_patient_name, 'your patient'),
                v_preview),
            'info',
            v_doctor_id,
            v_set_id,
            NULL,
            NEW.note_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_lab_note
AFTER INSERT ON aligner_notes
FOR EACH ROW
EXECUTE FUNCTION notify_lab_note();

COMMENT ON FUNCTION notify_lab_note IS 'Auto-notify doctor when lab sends a message';

-- ----------------------------------------------------------------------------
-- EVENT 5: Payment Received
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_payment_update()
RETURNS TRIGGER AS $$
DECLARE
    v_doctor_id INT;
    v_set_id INT;
    v_patient_name VARCHAR;
    v_amount_change NUMERIC;
BEGIN
    -- Only trigger when payment actually changes
    IF NEW.total_paid IS DISTINCT FROM OLD.total_paid THEN

        v_amount_change := NEW.total_paid - COALESCE(OLD.total_paid, 0);

        -- Get info
        SELECT s.aligner_dr_id, s.aligner_set_id, p.patient_name
        INTO v_doctor_id, v_set_id, v_patient_name
        FROM aligner_sets s
        LEFT JOIN work w ON s.work_id = w.work_id
        LEFT JOIN patients p ON w.person_id = p.person_id
        WHERE s.aligner_set_id = NEW.aligner_set_id;

        -- Create announcement based on payment status
        IF NEW.payment_status = 'Paid' THEN
            PERFORM create_doctor_announcement(
                'Payment Completed',
                format('Full payment received for %s! Total: %s',
                    COALESCE(v_patient_name, 'patient'),
                    NEW.total_paid::text),
                'success',
                v_doctor_id,
                v_set_id
            );
        ELSE
            PERFORM create_doctor_announcement(
                'Payment Received',
                format('Payment of %s received for %s. Balance: %s',
                    v_amount_change::text,
                    COALESCE(v_patient_name, 'patient'),
                    COALESCE(NEW.balance, 0)::text),
                'info',
                v_doctor_id,
                v_set_id
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_payment_update
AFTER UPDATE ON aligner_set_payments
FOR EACH ROW
EXECUTE FUNCTION notify_payment_update();

COMMENT ON FUNCTION notify_payment_update IS 'Auto-notify doctor when payments are received';

-- ----------------------------------------------------------------------------
-- EVENT 6: Set Completed
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_set_completed()
RETURNS TRIGGER AS $$
DECLARE
    v_patient_name VARCHAR;
BEGIN
    -- Only trigger when set becomes inactive (completed)
    IF OLD.is_active = true AND NEW.is_active = false THEN

        -- Get patient name
        SELECT p.patient_name
        INTO v_patient_name
        FROM work w
        LEFT JOIN patients p ON w.person_id = p.person_id
        WHERE w.work_id = NEW.work_id;

        -- Create announcement
        PERFORM create_doctor_announcement(
            'Treatment Set Completed',
            format('Set #%s for %s has been completed! 🎉',
                NEW.set_sequence,
                COALESCE(v_patient_name, 'patient')),
            'success',
            NEW.aligner_dr_id,
            NEW.aligner_set_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_set_completed
AFTER UPDATE ON aligner_sets
FOR EACH ROW
EXECUTE FUNCTION notify_set_completed();

COMMENT ON FUNCTION notify_set_completed IS 'Auto-notify doctor when treatment set is completed';

-- ============================================================================
-- 6. CLEANUP FUNCTION: Auto-delete expired announcements
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_announcements()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM doctor_announcements
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_announcements IS 'Delete announcements past their expiry date (run via cron)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Log completion
DO $$
BEGIN
    RAISE NOTICE '✅ Doctor announcements system created successfully';
    RAISE NOTICE '📋 Tables: doctor_announcements, doctor_announcement_reads';
    RAISE NOTICE '🔔 Triggers: 6 automatic notification triggers enabled';
    RAISE NOTICE '🔒 RLS: Row-level security policies active';
    RAISE NOTICE '🎯 Next: Apply this migration to Supabase';
END $$;
