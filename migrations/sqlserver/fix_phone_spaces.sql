-- Migration: Fix phone number spaces
-- Description: Removes spaces from phone numbers that were incorrectly stored
--              due to the frontend phone mask formatting bug.
-- Impact: ~81 patients with malformed phone numbers
-- Date: 2026-01-31

-- Preview affected records (run this first to verify)
-- SELECT PersonId, Phone, REPLACE(Phone, ' ', '') AS CleanedPhone
-- FROM tblpatients
-- WHERE Phone LIKE '% %';

-- Fix Phone column - remove all spaces
UPDATE tblpatients
SET Phone = REPLACE(Phone, ' ', '')
WHERE Phone LIKE '% %';

-- Fix Phone2 column if it has the same issue
UPDATE tblpatients
SET Phone2 = REPLACE(Phone2, ' ', '')
WHERE Phone2 LIKE '% %';

-- Verify fix (should return 0)
-- SELECT COUNT(*) AS RemainingWithSpaces FROM tblpatients WHERE Phone LIKE '% %';
