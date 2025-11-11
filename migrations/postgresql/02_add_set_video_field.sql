-- =============================================
-- Add set_video field to aligner_sets table
-- Migration: 02_add_set_video_field.sql
-- Purpose: Add YouTube video URL field for case explanations (external app)
-- =============================================

-- Add column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'aligner_sets'
        AND column_name = 'set_video'
    ) THEN
        ALTER TABLE aligner_sets
        ADD COLUMN set_video VARCHAR(2000);

        RAISE NOTICE 'Column set_video added to aligner_sets';
    ELSE
        RAISE NOTICE 'Column set_video already exists, skipping';
    END IF;
END $$;

-- Add column description
COMMENT ON COLUMN aligner_sets.set_video IS 'YouTube URL for case explanation video';

-- Update updated_at trigger to handle the new column
-- (This ensures updated_at timestamp updates when set_video changes)
-- The trigger already exists from migration 01, no changes needed

-- Confirmation message
DO $$
BEGIN
    RAISE NOTICE '✅ Migration complete: set_video field added to aligner_sets';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Sync should automatically populate this field from SQL Server';
    RAISE NOTICE '2. Doctors can view videos in the external portal';
    RAISE NOTICE '3. Videos are read-only for doctors (managed from internal app)';
END $$;
