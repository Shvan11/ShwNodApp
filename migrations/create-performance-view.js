/**
 * Create performance monitoring view
 */

import { executeQuery } from '../services/database/index.js';

async function createView() {
  console.log('📊 Creating vw_TriggerPerformance view...\n');

  try {
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
    console.log('✅ View created successfully!\n');
    console.log('Test the view with:');
    console.log('SELECT * FROM vw_TriggerPerformance ORDER BY avg_elapsed_time_ms DESC\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create view:', error.message);
    process.exit(1);
  }
}

createView();
