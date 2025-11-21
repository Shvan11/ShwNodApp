/**
 * Run trigger optimization migration
 * This script creates the optimized trigger and monitoring view
 */

import { executeQuery } from '../services/database/index.js';

async function runMigration() {
  console.log('🔧 Starting trigger optimization migration...\n');

  try {
    // Step 1: Create optimized trigger
    console.log('📝 Creating optimized trigger: trg_AlignerBatches_SetAlignerSequences');

    const triggerSQL = `
CREATE TRIGGER dbo.trg_AlignerBatches_SetAlignerSequences
ON dbo.tblAlignerBatches
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Use window functions instead of correlated subqueries for better performance
    -- Note: UpperAlignerEndSequence and LowerAlignerEndSequence are computed columns
    WITH OrderedBatches AS (
        SELECT
            b.AlignerBatchID,
            b.AlignerSetID,
            b.UpperAlignerCount,
            b.LowerAlignerCount,
            b.ManufactureDate,
            -- Use window function to calculate cumulative sum up to previous row
            ISNULL(SUM(b.UpperAlignerCount) OVER (
                PARTITION BY b.AlignerSetID
                ORDER BY b.ManufactureDate, b.AlignerBatchID
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS PrevUpperCount,
            ISNULL(SUM(b.LowerAlignerCount) OVER (
                PARTITION BY b.AlignerSetID
                ORDER BY b.ManufactureDate, b.AlignerBatchID
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS PrevLowerCount
        FROM dbo.tblAlignerBatches b
        WHERE b.AlignerSetID IN (SELECT DISTINCT AlignerSetID FROM inserted)
    )
    UPDATE b
    SET
        UpperAlignerStartSequence = CASE
            WHEN o.UpperAlignerCount > 0
            THEN o.PrevUpperCount + 1
            ELSE NULL
        END,
        LowerAlignerStartSequence = CASE
            WHEN o.LowerAlignerCount > 0
            THEN o.PrevLowerCount + 1
            ELSE NULL
        END
    FROM dbo.tblAlignerBatches b
    INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID
    WHERE EXISTS (SELECT 1 FROM inserted i WHERE i.AlignerBatchID = b.AlignerBatchID);
END
`;

    await executeQuery(triggerSQL, []);
    console.log('✅ Trigger created successfully\n');

    // Step 2: Create performance monitoring view
    console.log('📊 Creating performance monitoring view: vw_TriggerPerformance');

    const viewSQL = `
CREATE VIEW vw_TriggerPerformance AS
SELECT
    OBJECT_NAME(s.object_id) AS TriggerName,
    OBJECT_NAME(p.object_id) AS TableName,
    s.execution_count,
    s.total_worker_time / 1000 AS total_worker_time_ms,
    s.total_elapsed_time / 1000 AS total_elapsed_time_ms,
    (s.total_worker_time / s.execution_count) / 1000 AS avg_worker_time_ms,
    (s.total_elapsed_time / s.execution_count) / 1000 AS avg_elapsed_time_ms,
    s.last_execution_time
FROM sys.dm_exec_trigger_stats s
INNER JOIN sys.triggers t ON s.object_id = t.object_id
INNER JOIN sys.objects p ON t.parent_id = p.object_id
WHERE OBJECT_NAME(p.object_id) = 'tblAlignerBatches'
`;

    await executeQuery(viewSQL, []);
    console.log('✅ View created successfully\n');

    // Step 3: Update statistics
    console.log('📈 Updating table statistics...');
    await executeQuery('UPDATE STATISTICS dbo.tblAlignerBatches WITH FULLSCAN', []);
    await executeQuery('UPDATE STATISTICS dbo.tblAlignerSets WITH FULLSCAN', []);
    console.log('✅ Statistics updated\n');

    console.log('========================================');
    console.log('✅ Migration completed successfully!');
    console.log('========================================\n');
    console.log('Changes applied:');
    console.log('1. ✅ Added two indexes to tblAlignerBatches');
    console.log('2. ✅ Optimized trg_AlignerBatches_SetAlignerSequences trigger');
    console.log('3. ✅ Created vw_TriggerPerformance monitoring view');
    console.log('4. ✅ Updated table statistics\n');
    console.log('Monitor performance with:');
    console.log('SELECT * FROM vw_TriggerPerformance ORDER BY avg_elapsed_time_ms DESC\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

runMigration();
