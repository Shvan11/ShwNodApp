#!/usr/bin/env node
/**
 * Database Utility Tool for Shwan Orthodontics
 * 
 * A comprehensive command-line tool for database operations including:
 * - Table schema inspection
 * - Data queries with formatting
 * - Database health checks
 * - Connection testing
 * 
 * Usage examples:
 *   node db-utility.js schema tblappointments
 *   node db-utility.js query "SELECT TOP 10 * FROM tblpatients"
 *   node db-utility.js health
 *   node db-utility.js tables
 *   node db-utility.js count tblappointments
 */

import { executeQuery, testConnection, healthCheck, TYPES } from './services/database/index.js';
import { logger } from './services/core/Logger.js';

// Command definitions
const COMMANDS = {
  schema: 'Get table schema information',
  query: 'Execute a custom SQL query',
  health: 'Check database health status',
  tables: 'List all tables in the database',
  count: 'Get row count for a table',
  columns: 'List columns for a table',
  indexes: 'List indexes for a table',
  procedures: 'List all stored procedures',
  procedure: 'Get stored procedure code and parameters',
  functions: 'List all user-defined functions',
  function: 'Get function code and parameters',
  help: 'Show this help message'
};

/**
 * Display help information
 */
function showHelp() {
  console.log('\n🔧 Database Utility Tool for Shwan Orthodontics\n');
  console.log('Available commands:');
  
  Object.entries(COMMANDS).forEach(([cmd, desc]) => {
    console.log(`  ${cmd.padEnd(12)} - ${desc}`);
  });
  
  console.log('\nUsage examples:');
  console.log('  node db-utility.js schema tblappointments');
  console.log('  node db-utility.js query "SELECT TOP 10 * FROM tblpatients"');
  console.log('  node db-utility.js count tblappointments');
  console.log('  node db-utility.js tables');
  console.log('  node db-utility.js procedures');
  console.log('  node db-utility.js procedure sp_GetPatientInfo');
  console.log('  node db-utility.js health\n');
}

/**
 * Get comprehensive table schema information
 */
async function getTableSchema(tableName) {
  if (!tableName) {
    throw new Error('Table name is required for schema command');
  }

  console.log(`\n📋 Schema for table: ${tableName}\n`);

  const schemaQuery = `
    SELECT 
      COLUMN_NAME,
      DATA_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = @tableName
    ORDER BY ORDINAL_POSITION
  `;

  const constraintsQuery = `
    SELECT 
      tc.CONSTRAINT_NAME,
      tc.CONSTRAINT_TYPE,
      kcu.COLUMN_NAME,
      tc.TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE tc.TABLE_NAME = @tableName
    ORDER BY tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME
  `;

  const indexesQuery = `
    SELECT 
      i.name AS IndexName,
      i.type_desc AS IndexType,
      i.is_unique AS IsUnique,
      i.is_primary_key AS IsPrimaryKey,
      STRING_AGG(c.name, ', ') AS Columns
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    WHERE t.name = @tableName AND i.name IS NOT NULL
    GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
    ORDER BY i.is_primary_key DESC, i.is_unique DESC, i.name
  `;

  try {
    // Get column information
    const columns = await executeQuery(
      schemaQuery,
      [['tableName', TYPES.VarChar, tableName]],
      (columns) => ({
        name: columns[0].value,
        dataType: columns[1].value,
        nullable: columns[2].value === 'YES',
        defaultValue: columns[3].value,
        maxLength: columns[4].value,
        precision: columns[5].value,
        scale: columns[6].value,
        position: columns[7].value
      })
    );

    if (columns.length === 0) {
      console.log(`❌ Table '${tableName}' not found or has no columns`);
      return;
    }

    // Display columns
    console.log('Columns:');
    console.log('-'.repeat(80));
    columns.forEach(col => {
      const typeInfo = col.maxLength 
        ? `${col.dataType}(${col.maxLength})`
        : col.precision 
          ? `${col.dataType}(${col.precision},${col.scale})`
          : col.dataType;
      
      console.log(`${col.position.toString().padStart(2)}. ${col.name.padEnd(25)} ${typeInfo.padEnd(20)} ${col.nullable ? 'NULL' : 'NOT NULL'.padEnd(8)} ${col.defaultValue || ''}`);
    });

    // Get constraints
    const constraints = await executeQuery(
      constraintsQuery,
      [['tableName', TYPES.VarChar, tableName]],
      (columns) => ({
        name: columns[0].value,
        type: columns[1].value,
        column: columns[2].value,
        table: columns[3].value
      })
    );

    if (constraints.length > 0) {
      console.log('\nConstraints:');
      console.log('-'.repeat(80));
      const grouped = constraints.reduce((acc, constraint) => {
        if (!acc[constraint.type]) acc[constraint.type] = [];
        acc[constraint.type].push(constraint);
        return acc;
      }, {});

      Object.entries(grouped).forEach(([type, items]) => {
        console.log(`${type}:`);
        items.forEach(item => {
          console.log(`  - ${item.name} (${item.column || 'N/A'})`);
        });
      });
    }

    // Get indexes
    const indexes = await executeQuery(
      indexesQuery,
      [['tableName', TYPES.VarChar, tableName]],
      (columns) => ({
        name: columns[0].value,
        type: columns[1].value,
        unique: columns[2].value,
        primaryKey: columns[3].value,
        columns: columns[4].value
      })
    );

    if (indexes.length > 0) {
      console.log('\nIndexes:');
      console.log('-'.repeat(80));
      indexes.forEach(idx => {
        const flags = [];
        if (idx.primaryKey) flags.push('PRIMARY KEY');
        if (idx.unique) flags.push('UNIQUE');
        
        console.log(`${idx.name.padEnd(30)} ${idx.type.padEnd(15)} ${flags.join(', ').padEnd(15)} (${idx.columns})`);
      });
    }

    console.log(`\n✅ Schema information retrieved for '${tableName}'`);

  } catch (error) {
    console.error(`❌ Error retrieving schema for '${tableName}':`, error.message);
    throw error;
  }
}

/**
 * Execute a custom SQL query with formatted output
 */
async function executeCustomQuery(query) {
  if (!query) {
    throw new Error('SQL query is required');
  }

  console.log(`\n🔍 Executing query:\n${query}\n`);

  try {
    const startTime = Date.now();
    
    const results = await executeQuery(
      query,
      [],
      (columns) => {
        const row = {};
        columns.forEach(col => {
          row[col.metadata.colName] = col.value;
        });
        return row;
      }
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    if (results.length === 0) {
      console.log('📄 No results returned');
    } else {
      // Display results in a table format
      console.log(`📊 Results (${results.length} rows, ${duration}ms):`);
      console.log('-'.repeat(100));
      
      if (results.length > 0) {
        // Get column names
        const columns = Object.keys(results[0]);
        
        // Display header
        console.log(columns.map(col => col.padEnd(15)).join(' | '));
        console.log(columns.map(() => '-'.repeat(15)).join('-+-'));
        
        // Display rows (limit to first 50 for readability)
        const displayRows = results.slice(0, 50);
        displayRows.forEach(row => {
          console.log(columns.map(col => {
            const value = row[col];
            return (value !== null && value !== undefined ? String(value) : 'NULL').padEnd(15);
          }).join(' | '));
        });
        
        if (results.length > 50) {
          console.log(`... and ${results.length - 50} more rows`);
        }
      }
    }

    console.log(`\n✅ Query completed in ${duration}ms`);
    return results;

  } catch (error) {
    console.error('❌ Query execution failed:', error.message);
    throw error;
  }
}

/**
 * List all tables in the database
 */
async function listTables() {
  console.log('\n📋 Database Tables:\n');

  const query = `
    SELECT 
      TABLE_SCHEMA,
      TABLE_NAME,
      TABLE_TYPE
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `;

  try {
    const tables = await executeQuery(
      query,
      [],
      (columns) => ({
        schema: columns[0].value,
        name: columns[1].value,
        type: columns[2].value
      })
    );

    if (tables.length === 0) {
      console.log('❌ No tables found');
      return;
    }

    console.log('Schema'.padEnd(15) + 'Table Name'.padEnd(30) + 'Type');
    console.log('-'.repeat(60));
    
    tables.forEach(table => {
      console.log(table.schema.padEnd(15) + table.name.padEnd(30) + table.type);
    });

    console.log(`\n✅ Found ${tables.length} tables`);

  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
    throw error;
  }
}

/**
 * Get row count for a table
 */
async function getTableCount(tableName) {
  if (!tableName) {
    throw new Error('Table name is required for count command');
  }

  console.log(`\n🔢 Row count for table: ${tableName}`);

  try {
    const results = await executeQuery(
      `SELECT COUNT(*) as RowCount FROM ${tableName}`,
      [],
      (columns) => ({ count: columns[0].value })
    );

    const count = results[0].count;
    console.log(`\n📊 Table '${tableName}' contains ${count.toLocaleString()} rows\n`);

  } catch (error) {
    console.error(`❌ Error getting count for '${tableName}':`, error.message);
    throw error;
  }
}

/**
 * List all stored procedures
 */
async function listStoredProcedures() {
  console.log('\n📋 Stored Procedures:\n');

  const query = `
    SELECT 
      ROUTINE_SCHEMA,
      ROUTINE_NAME,
      ROUTINE_TYPE,
      CREATED,
      LAST_ALTERED
    FROM INFORMATION_SCHEMA.ROUTINES 
    WHERE ROUTINE_TYPE = 'PROCEDURE'
    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
  `;

  try {
    const procedures = await executeQuery(
      query,
      [],
      (columns) => ({
        schema: columns[0].value,
        name: columns[1].value,
        type: columns[2].value,
        created: columns[3].value,
        lastAltered: columns[4].value
      })
    );

    if (procedures.length === 0) {
      console.log('❌ No stored procedures found');
      return;
    }

    console.log('Schema'.padEnd(15) + 'Procedure Name'.padEnd(40) + 'Created'.padEnd(20) + 'Modified');
    console.log('-'.repeat(90));
    
    procedures.forEach(proc => {
      const created = proc.created ? new Date(proc.created).toLocaleDateString() : 'N/A';
      const modified = proc.lastAltered ? new Date(proc.lastAltered).toLocaleDateString() : 'N/A';
      console.log(proc.schema.padEnd(15) + proc.name.padEnd(40) + created.padEnd(20) + modified);
    });

    console.log(`\n✅ Found ${procedures.length} stored procedures`);

  } catch (error) {
    console.error('❌ Error listing stored procedures:', error.message);
    throw error;
  }
}

/**
 * Get stored procedure code and parameters
 */
async function getStoredProcedureCode(procedureName) {
  if (!procedureName) {
    throw new Error('Procedure name is required');
  }

  console.log(`\n📝 Stored Procedure: ${procedureName}\n`);

  // Get procedure definition
  const definitionQuery = `
    SELECT 
      ROUTINE_DEFINITION,
      ROUTINE_SCHEMA,
      CREATED,
      LAST_ALTERED
    FROM INFORMATION_SCHEMA.ROUTINES 
    WHERE ROUTINE_NAME = @procedureName AND ROUTINE_TYPE = 'PROCEDURE'
  `;

  // Get procedure parameters
  const parametersQuery = `
    SELECT 
      PARAMETER_NAME,
      DATA_TYPE,
      PARAMETER_MODE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.PARAMETERS 
    WHERE SPECIFIC_NAME = @procedureName
    ORDER BY ORDINAL_POSITION
  `;

  // Alternative query for SQL Server specific procedure text
  const sqlServerQuery = `
    SELECT 
      o.name AS ProcedureName,
      o.create_date AS Created,
      o.modify_date AS Modified,
      m.definition AS ProcedureText
    FROM sys.objects o
    INNER JOIN sys.sql_modules m ON o.object_id = m.object_id
    WHERE o.type = 'P' AND o.name = @procedureName
  `;

  try {
    // Try SQL Server specific query first (more reliable for procedure text)
    let procedureInfo;
    try {
      const sqlServerResult = await executeQuery(
        sqlServerQuery,
        [['procedureName', TYPES.VarChar, procedureName]],
        (columns) => ({
          name: columns[0].value,
          created: columns[1].value,
          modified: columns[2].value,
          definition: columns[3].value
        })
      );
      
      if (sqlServerResult.length > 0) {
        procedureInfo = sqlServerResult[0];
      }
    } catch (sqlServerError) {
      console.log('Note: SQL Server specific query failed, trying INFORMATION_SCHEMA...');
    }

    // Fallback to INFORMATION_SCHEMA if SQL Server query failed
    if (!procedureInfo) {
      const infoSchemaResult = await executeQuery(
        definitionQuery,
        [['procedureName', TYPES.VarChar, procedureName]],
        (columns) => ({
          definition: columns[0].value,
          schema: columns[1].value,
          created: columns[2].value,
          modified: columns[3].value
        })
      );

      if (infoSchemaResult.length === 0) {
        console.log(`❌ Stored procedure '${procedureName}' not found`);
        return;
      }

      procedureInfo = infoSchemaResult[0];
    }

    // Get parameters
    const parameters = await executeQuery(
      parametersQuery,
      [['procedureName', TYPES.VarChar, procedureName]],
      (columns) => ({
        name: columns[0].value,
        dataType: columns[1].value,
        mode: columns[2].value,
        maxLength: columns[3].value,
        precision: columns[4].value,
        scale: columns[5].value,
        position: columns[6].value
      })
    );

    // Display procedure information
    console.log('Procedure Information:');
    console.log('-'.repeat(50));
    if (procedureInfo.created) {
      console.log(`Created: ${new Date(procedureInfo.created).toLocaleString()}`);
    }
    if (procedureInfo.modified) {
      console.log(`Modified: ${new Date(procedureInfo.modified).toLocaleString()}`);
    }

    // Display parameters if any
    if (parameters.length > 0) {
      console.log('\nParameters:');
      console.log('-'.repeat(50));
      parameters.forEach(param => {
        const typeInfo = param.maxLength 
          ? `${param.dataType}(${param.maxLength})`
          : param.precision 
            ? `${param.dataType}(${param.precision},${param.scale})`
            : param.dataType;
        
        console.log(`${param.position}. ${param.name} - ${typeInfo} (${param.mode || 'IN'})`);
      });
    }

    // Display procedure code
    console.log('\nProcedure Code:');
    console.log('='.repeat(80));
    
    if (procedureInfo.definition) {
      // Format the code with line numbers
      const lines = procedureInfo.definition.split('\n');
      lines.forEach((line, index) => {
        console.log(`${(index + 1).toString().padStart(4)}: ${line}`);
      });
    } else {
      console.log('❌ Procedure definition not available');
    }

    console.log('='.repeat(80));
    console.log(`\n✅ Retrieved code for procedure '${procedureName}'`);

  } catch (error) {
    console.error(`❌ Error retrieving procedure '${procedureName}':`, error.message);
    throw error;
  }
}

/**
 * List all user-defined functions
 */
async function listFunctions() {
  console.log('\n📋 User-Defined Functions:\n');

  const query = `
    SELECT 
      ROUTINE_SCHEMA,
      ROUTINE_NAME,
      ROUTINE_TYPE,
      DATA_TYPE,
      CREATED,
      LAST_ALTERED
    FROM INFORMATION_SCHEMA.ROUTINES 
    WHERE ROUTINE_TYPE = 'FUNCTION'
    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
  `;

  try {
    const functions = await executeQuery(
      query,
      [],
      (columns) => ({
        schema: columns[0].value,
        name: columns[1].value,
        type: columns[2].value,
        returnType: columns[3].value,
        created: columns[4].value,
        lastAltered: columns[5].value
      })
    );

    if (functions.length === 0) {
      console.log('❌ No user-defined functions found');
      return;
    }

    console.log('Schema'.padEnd(15) + 'Function Name'.padEnd(30) + 'Return Type'.padEnd(15) + 'Created'.padEnd(15) + 'Modified');
    console.log('-'.repeat(90));
    
    functions.forEach(func => {
      const created = func.created ? new Date(func.created).toLocaleDateString() : 'N/A';
      const modified = func.lastAltered ? new Date(func.lastAltered).toLocaleDateString() : 'N/A';
      console.log(func.schema.padEnd(15) + func.name.padEnd(30) + (func.returnType || 'N/A').padEnd(15) + created.padEnd(15) + modified);
    });

    console.log(`\n✅ Found ${functions.length} user-defined functions`);

  } catch (error) {
    console.error('❌ Error listing functions:', error.message);
    throw error;
  }
}

/**
 * Get function code and parameters (similar to stored procedure)
 */
async function getFunctionCode(functionName) {
  if (!functionName) {
    throw new Error('Function name is required');
  }

  console.log(`\n📝 Function: ${functionName}\n`);

  // SQL Server specific query for function text
  const sqlServerQuery = `
    SELECT 
      o.name AS FunctionName,
      o.create_date AS Created,
      o.modify_date AS Modified,
      m.definition AS FunctionText
    FROM sys.objects o
    INNER JOIN sys.sql_modules m ON o.object_id = m.object_id
    WHERE o.type IN ('FN', 'IF', 'TF') AND o.name = @functionName
  `;

  // Get function parameters
  const parametersQuery = `
    SELECT 
      PARAMETER_NAME,
      DATA_TYPE,
      PARAMETER_MODE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.PARAMETERS 
    WHERE SPECIFIC_NAME = @functionName
    ORDER BY ORDINAL_POSITION
  `;

  try {
    const functionResult = await executeQuery(
      sqlServerQuery,
      [['functionName', TYPES.VarChar, functionName]],
      (columns) => ({
        name: columns[0].value,
        created: columns[1].value,
        modified: columns[2].value,
        definition: columns[3].value
      })
    );

    if (functionResult.length === 0) {
      console.log(`❌ Function '${functionName}' not found`);
      return;
    }

    const functionInfo = functionResult[0];

    // Get parameters
    const parameters = await executeQuery(
      parametersQuery,
      [['functionName', TYPES.VarChar, functionName]],
      (columns) => ({
        name: columns[0].value,
        dataType: columns[1].value,
        mode: columns[2].value,
        maxLength: columns[3].value,
        precision: columns[4].value,
        scale: columns[5].value,
        position: columns[6].value
      })
    );

    // Display function information
    console.log('Function Information:');
    console.log('-'.repeat(50));
    console.log(`Created: ${new Date(functionInfo.created).toLocaleString()}`);
    console.log(`Modified: ${new Date(functionInfo.modified).toLocaleString()}`);

    // Display parameters if any
    if (parameters.length > 0) {
      console.log('\nParameters:');
      console.log('-'.repeat(50));
      parameters.forEach(param => {
        const typeInfo = param.maxLength 
          ? `${param.dataType}(${param.maxLength})`
          : param.precision 
            ? `${param.dataType}(${param.precision},${param.scale})`
            : param.dataType;
        
        console.log(`${param.position}. ${param.name} - ${typeInfo} (${param.mode || 'IN'})`);
      });
    }

    // Display function code
    console.log('\nFunction Code:');
    console.log('='.repeat(80));
    
    if (functionInfo.definition) {
      // Format the code with line numbers
      const lines = functionInfo.definition.split('\n');
      lines.forEach((line, index) => {
        console.log(`${(index + 1).toString().padStart(4)}: ${line}`);
      });
    } else {
      console.log('❌ Function definition not available');
    }

    console.log('='.repeat(80));
    console.log(`\n✅ Retrieved code for function '${functionName}'`);

  } catch (error) {
    console.error(`❌ Error retrieving function '${functionName}':`, error.message);
    throw error;
  }
}

/**
 * Check database health
 */
async function checkHealth() {
  console.log('\n🏥 Database Health Check\n');

  try {
    const health = await healthCheck();
    
    console.log(`Status: ${health.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
    console.log(`Message: ${health.message}`);
    
    if (health.details) {
      console.log('\nDetails:');
      console.log(`- Connection Pool: ${health.details.connectionPool.totalConnections} total, ${health.details.connectionPool.activeConnections} active`);
      console.log(`- Max Connections: ${health.details.connectionPool.maxConnections}`);
      console.log(`- Waiting Requests: ${health.details.connectionPool.waitingRequests}`);
      
      if (health.details.connectionTest) {
        console.log(`- Connection Test: ${health.details.connectionTest.success ? '✅ PASSED' : '❌ FAILED'}`);
        if (health.details.connectionTest.data) {
          console.log(`- Server Time: ${health.details.connectionTest.data.currentTime}`);
        }
      }
    }

    if (health.error) {
      console.log(`\n❌ Error: ${health.error}`);
    }

  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help') {
    showHelp();
    return;
  }

  const command = args[0].toLowerCase();
  const param = args[1];

  try {
    switch (command) {
      case 'schema':
        await getTableSchema(param);
        break;
        
      case 'query':
        await executeCustomQuery(param);
        break;
        
      case 'health':
        await checkHealth();
        break;
        
      case 'tables':
        await listTables();
        break;
        
      case 'count':
        await getTableCount(param);
        break;
        
      case 'columns':
        await getTableSchema(param);
        break;
        
      case 'indexes':
        await getTableSchema(param);
        break;
        
      case 'procedures':
        await listStoredProcedures();
        break;
        
      case 'procedure':
        await getStoredProcedureCode(param);
        break;
        
      case 'functions':
        await listFunctions();
        break;
        
      case 'function':
        await getFunctionCode(param);
        break;
        
      default:
        console.log(`❌ Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
}

// Export functions for programmatic use
export {
  getTableSchema,
  executeCustomQuery,
  listTables,
  getTableCount,
  checkHealth,
  listStoredProcedures,
  getStoredProcedureCode,
  listFunctions,
  getFunctionCode
};