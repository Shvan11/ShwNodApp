-- Migration: Add late time slots for Ramadan and extended slots settings
-- Created: 2026-01-31
-- Description: Adds late evening time slots (21:00-22:30) and configurable
--              settings for managing early/late slot categories

-- ============================================================================
-- Add late time slots to tbltimes table
-- ============================================================================
-- Note: Check if these TimeIDs don't already exist before running
-- The existing table has time slots up to 20:30 (TimeID 33)

INSERT INTO tbltimes (TimeID, MyTime)
SELECT 34, '1970-01-01T21:00:00'
WHERE NOT EXISTS (SELECT 1 FROM tbltimes WHERE TimeID = 34);

INSERT INTO tbltimes (TimeID, MyTime)
SELECT 35, '1970-01-01T21:30:00'
WHERE NOT EXISTS (SELECT 1 FROM tbltimes WHERE TimeID = 35);

INSERT INTO tbltimes (TimeID, MyTime)
SELECT 36, '1970-01-01T22:00:00'
WHERE NOT EXISTS (SELECT 1 FROM tbltimes WHERE TimeID = 36);

INSERT INTO tbltimes (TimeID, MyTime)
SELECT 37, '1970-01-01T22:30:00'
WHERE NOT EXISTS (SELECT 1 FROM tbltimes WHERE TimeID = 37);

-- ============================================================================
-- Add calendar settings to tbloptions table
-- ============================================================================

-- CALENDAR_EARLY_SLOTS: Defines which time slots are considered "early"
-- Stored as comma-separated HH:MM values
INSERT INTO tbloptions (OptionName, OptionValue)
SELECT 'CALENDAR_EARLY_SLOTS', '12:00,12:30,13:00,13:30'
WHERE NOT EXISTS (SELECT 1 FROM tbloptions WHERE OptionName = 'CALENDAR_EARLY_SLOTS');

-- CALENDAR_LATE_SLOTS: Defines which time slots are considered "late"
-- Stored as comma-separated HH:MM values
INSERT INTO tbloptions (OptionName, OptionValue)
SELECT 'CALENDAR_LATE_SLOTS', '21:00,21:30,22:00,22:30'
WHERE NOT EXISTS (SELECT 1 FROM tbloptions WHERE OptionName = 'CALENDAR_LATE_SLOTS');

-- CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT: Default state for the toggle
-- 'true' = early & late slots shown by default
-- 'false' = early & late slots hidden by default
INSERT INTO tbloptions (OptionName, OptionValue)
SELECT 'CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT', 'false'
WHERE NOT EXISTS (SELECT 1 FROM tbloptions WHERE OptionName = 'CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT');

-- ============================================================================
-- Verification queries (optional - run to confirm migration success)
-- ============================================================================
-- SELECT TimeID, MyTime FROM tbltimes ORDER BY TimeID;
-- SELECT * FROM tbloptions WHERE OptionName LIKE 'CALENDAR_%';
