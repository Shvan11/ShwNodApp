-- ============================================================================
-- Generate Patient Mappings for Folder Renaming Script
-- ============================================================================
-- This script queries all patients with aligner sets and outputs them
-- in the format needed by the rename-aligner-folders.bat script
--
-- INSTRUCTIONS:
-- 1. Run this query in SQL Server Management Studio or your SQL client
-- 2. Copy the results
-- 3. Paste into patient-mappings.txt (replace the example data)
-- 4. Run the batch script with /preview first to verify
-- ============================================================================

-- Output format: DoctorID|PersonID|PatientName
SELECT DISTINCT
    'DoctorID|PersonID|PatientName' AS MappingData
UNION ALL
SELECT
    CAST(als.AlignerDrID AS VARCHAR(10)) + '|' +
    CAST(p.PersonID AS VARCHAR(10)) + '|' +
    REPLACE(
        COALESCE(
            p.PatientName,
            RTRIM(LTRIM(COALESCE(p.FirstName, '') + ' ' + COALESCE(p.LastName, '')))
        ),
        ' ',
        '_'
    ) AS MappingData
FROM
    AlignerSets als
    INNER JOIN Works w ON als.WorkID = w.WorkID
    INNER JOIN Persons p ON w.PersonID = p.PersonID
WHERE
    als.AlignerDrID IS NOT NULL
    AND p.PersonID IS NOT NULL
ORDER BY
    MappingData;

-- ============================================================================
-- Alternative: Preview the data before exporting
-- ============================================================================
/*
SELECT
    als.AlignerDrID AS DoctorID,
    p.PersonID,
    REPLACE(
        COALESCE(
            p.PatientName,
            RTRIM(LTRIM(COALESCE(p.FirstName, '') + ' ' + COALESCE(p.LastName, '')))
        ),
        ' ',
        '_'
    ) AS PatientName,
    COUNT(als.AlignerSetID) AS TotalSets
FROM
    AlignerSets als
    INNER JOIN Works w ON als.WorkID = w.WorkID
    INNER JOIN Persons p ON w.PersonID = p.PersonID
WHERE
    als.AlignerDrID IS NOT NULL
    AND p.PersonID IS NOT NULL
GROUP BY
    als.AlignerDrID,
    p.PersonID,
    p.PatientName,
    p.FirstName,
    p.LastName
ORDER BY
    als.AlignerDrID,
    p.PersonID;
*/
