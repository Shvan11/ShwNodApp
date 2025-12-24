/**
 * Enhanced Database service with connection pooling and better error handling
 * Provides methods for database operations with improved resource management
 */
import { Connection, Request, TYPES } from 'tedious';

import ConnectionPool from './ConnectionPool.js';
import ResourceManager from '../core/ResourceManager.js';
import { log } from '../../utils/logger.js';

// Register database service with resource manager
ResourceManager.register('database-service', null, async () => {
  log.info('Shutting down database service');
  await ConnectionPool.cleanup();
});

/**
 * Enhanced executeQuery function using connection pool
 * @param {string} query - The SQL query to execute
 * @param {Array} params - An array of parameter arrays [name, type, value]
 * @param {Function} rowMapper - A function to map each row of the result set
 * @param {Function} [resultMapper] - An optional function to map the final result
 * @returns {Promise<any>} - A promise that resolves with the mapped result
 */
function executeQuery(query, params, rowMapper, resultMapper = (result) => result) {
  return ConnectionPool.withConnection(async (connection) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!query || typeof query !== 'string') {
        reject(new Error('Query must be a non-empty string'));
        return;
      }

      const result = [];
      const outputParams = [];
      let selectRowCount = 0;

      // The Request callback receives (error, rowCount, rows) when complete
      const request = new Request(query, (err, rowCount) => {
        if (err) {
          log.error('Query execution error', {
            error: err.message,
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            code: err.code
          });
          reject(err);
          return;
        }

        // Request completed successfully
        try {
          log.debug(`Query completed: ${rowCount} rows affected/returned, ${selectRowCount} rows collected`);
          // Attach rowsAffected to the result array for UPDATE/INSERT/DELETE queries
          result.rowsAffected = rowCount;
          const finalResult = resultMapper(result, outputParams);
          // If resultMapper returns the same array, rowsAffected is already attached
          // If it returns a new object, attach rowsAffected to it as well
          if (finalResult !== result && typeof finalResult === 'object' && finalResult !== null) {
            finalResult.rowsAffected = rowCount;
          }
          resolve(finalResult);
        } catch (resultMappingError) {
          log.error('Result mapping error', {
            error: resultMappingError.message,
            rowCount: result.length,
            query: query.substring(0, 50) + '...'
          });
          reject(new Error(`Result mapping failed: ${resultMappingError.message}`));
        }
      });

      // Add parameters with validation
      try {
        (params || []).forEach((param, index) => {
          if (!Array.isArray(param) || param.length < 3) {
            throw new Error(`Invalid parameter at index ${index}: expected [name, type, value]`);
          }
          const [name, type, value] = param;
          // If value is null, pass options to mark it as nullable
          const options = value === null ? { nullable: true } : undefined;
          request.addParameter(name, type, value, options);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      // Handle row data (for SELECT queries)
      request.on('row', (columns) => {
        try {
          selectRowCount++;
          const mappedRow = rowMapper ? rowMapper(columns) : columns;
          result.push(mappedRow);
        } catch (mappingError) {
          log.error('Row mapping error', {
            error: mappingError.message,
            rowIndex: selectRowCount - 1,
            query: query.substring(0, 50) + '...'
          });
          reject(new Error(`Row mapping failed at row ${selectRowCount - 1}: ${mappingError.message}`));
        }
      });

      // Handle output parameters
      request.on('returnValue', (parameterName, value) => {
        outputParams.push({ parameterName, value });
        log.debug(`Output parameter: ${parameterName} = ${value}`);
      });

      // Handle request errors
      request.on('error', (error) => {
        log.error('Request error', {
          error: error.message,
          code: error.code,
          query: query.substring(0, 100) + (query.length > 100 ? '...' : '')
        });
        reject(error);
      });

      // Execute the request
      try {
        connection.execSql(request);
      } catch (execError) {
        log.error('SQL execution error', { error: execError.message });
        reject(execError);
      }
    });
  });
}

/**
 * Enhanced executeStoredProcedure function using connection pool
 * @param {string} procedureName - The name of the stored procedure to execute
 * @param {Array} params - An array of parameter arrays [name, type, value]
 * @param {Function} [beforeExec] - An optional function to configure the request before execution
 * @param {Function} [rowMapper] - A function to map each row of the result set
 * @param {Function} [resultMapper] - A function to map the final result
 * @returns {Promise<any>} - A promise that resolves with the mapped result
 */
function executeStoredProcedure(procedureName, params, beforeExec, rowMapper, resultMapper) {
  return ConnectionPool.withConnection(async (connection) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!procedureName || typeof procedureName !== 'string') {
        reject(new Error('Procedure name must be a non-empty string'));
        return;
      }

      const request = new Request(procedureName, (err) => {
        if (err) {
          log.error('Stored procedure execution error', {
            error: err.message,
            procedure: procedureName,
            code: err.code
          });
          reject(err);
          return;
        }
      });

      // Add parameters with validation
      try {
        (params || []).forEach((param, index) => {
          if (!Array.isArray(param) || param.length < 3) {
            throw new Error(`Invalid parameter at index ${index}: expected [name, type, value]`);
          }
          const [name, type, value] = param;
          // If value is null, pass options to mark it as nullable
          const options = value === null ? { nullable: true } : undefined;
          request.addParameter(name, type, value, options);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      // Execute beforeExec callback with error handling
      if (beforeExec) {
        try {
          beforeExec(request);
        } catch (beforeExecError) {
          log.error('beforeExec callback error', {
            error: beforeExecError.message,
            procedure: procedureName
          });
          reject(new Error(`beforeExec callback failed: ${beforeExecError.message}`));
          return;
        }
      }

      const result = [];
      const outParams = [];
      let rowCount = 0;

      // Handle row data
      request.on('row', (columns) => {
        try {
          rowCount++;
          const mappedRow = rowMapper ? rowMapper(columns) : columns;
          result.push(mappedRow);
        } catch (mappingError) {
          log.error('Row mapping error in stored procedure', {
            error: mappingError.message,
            rowIndex: rowCount - 1,
            procedure: procedureName
          });
          reject(new Error(`Row mapping failed at row ${rowCount - 1}: ${mappingError.message}`));
        }
      });

      // Handle return values/output parameters
      request.on('returnValue', (parameterName, value) => {
        outParams.push({ parameterName, value });
      });

      // Handle completion
      request.on('requestCompleted', () => {
        try {
          const finalResult = resultMapper ? resultMapper(result, outParams) : result;
          resolve(finalResult);
        } catch (resultMappingError) {
          log.error('Result mapping error in stored procedure', {
            error: resultMappingError.message,
            procedure: procedureName,
            rowCount: result.length
          });
          reject(new Error(`Result mapping failed: ${resultMappingError.message}`));
        }
      });

      // Handle request errors
      request.on('error', (error) => {
        log.error('Stored procedure request error', {
          error: error.message,
          code: error.code,
          procedure: procedureName
        });
        reject(error);
      });

      // Execute the stored procedure
      try {
        connection.callProcedure(request);
      } catch (execError) {
        log.error('Stored procedure execution error', { error: execError.message });
        reject(execError);
      }
    });
  });
}

/**
 * Execute multiple operations within a single connection
 * Useful for related operations that should use the same connection
 * @param {Function} operations - Async function that receives a connection
 * @returns {Promise<any>} - Result of the operations
 */
function withConnection(operations) {
  return ConnectionPool.withConnection(operations);
}

/**
 * Execute a raw SQL query with a specific connection (for advanced use cases)
 * @param {Connection} connection - Database connection to use
 * @param {string} query - SQL query to execute
 * @param {Array} [params] - Query parameters
 * @returns {Promise<any>} - Query results
 */
function executeRawQuery(connection, query, params = []) {
  return new Promise((resolve, reject) => {
    const request = new Request(query, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    // Add parameters
    params.forEach(param => {
      request.addParameter(param[0], param[1], param[2]);
    });

    const result = [];
    
    request.on('row', (columns) => {
      result.push(columns);
    });

    request.on('requestCompleted', () => {
      resolve(result);
    });

    request.on('error', (error) => {
      reject(error);
    });

    connection.execSql(request);
  });
}

/**
 * Test database connectivity
 * @returns {Promise<Object>} - Connection test result
 */
async function testConnection() {
  try {
    const testResult = await executeQuery(
      `SELECT
        @@VERSION as Version,
        GETDATE() as CurrentTime,
        SESSIONPROPERTY('QUOTED_IDENTIFIER') as QUOTED_IDENTIFIER,
        SESSIONPROPERTY('ANSI_NULLS') as ANSI_NULLS`,
      [],
      (columns) => ({
        version: columns[0].value,
        currentTime: columns[1].value,
        quotedIdentifier: columns[2].value,
        ansiNulls: columns[3].value
      })
    );

    console.log('Database connection test successful');
    console.log('Session settings:', {
      QUOTED_IDENTIFIER: testResult[0]?.quotedIdentifier,
      ANSI_NULLS: testResult[0]?.ansiNulls
    });
    return {
      success: true,
      message: 'Database connection successful',
      data: testResult[0],
      poolStats: ConnectionPool.getStats()
    };
  } catch (error) {
    console.error('Database connection test failed:', error);
    return {
      success: false,
      message: 'Database connection failed',
      error: error.message,
      poolStats: ConnectionPool.getStats()
    };
  }
}

/**
 * Test database connectivity with retry logic for service startup
 * @param {number} maxRetries - Maximum number of retry attempts (default: 5)
 * @param {number} retryDelay - Delay between retries in ms (default: 15000)
 * @returns {Promise<Object>} - Connection test result
 */
async function testConnectionWithRetry(maxRetries = 5, retryDelay = 15000) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📊 Database connection attempt ${attempt}/${maxRetries}...`);
      const result = await testConnection();
      
      if (result.success) {
        if (attempt > 1) {
          console.log(`✅ Database connection successful after ${attempt} attempts`);
        }
        return result;
      }
      
      lastError = result.error;
    } catch (error) {
      lastError = error.message;
      console.error(`❌ Database connection attempt ${attempt} failed:`, error.message);
    }
    
    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      console.log(`⏳ Waiting ${retryDelay/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  return {
    success: false,
    message: `Database connection failed after ${maxRetries} attempts`,
    error: lastError
  };
}

/**
 * Get database and connection pool statistics
 * @returns {Object} - Database statistics
 */
function getDatabaseStats() {
  const poolStats = ConnectionPool.getStats();
  
  return {
    connectionPool: poolStats,
    timestamp: Date.now(),
    healthy: !poolStats.isShuttingDown && poolStats.totalConnections > 0
  };
}

/**
 * Health check for database service
 * @returns {Promise<Object>} - Health check result
 */
async function healthCheck() {
  try {
    const stats = getDatabaseStats();
    
    if (!stats.healthy) {
      return {
        healthy: false,
        message: 'Database connection pool is not healthy',
        details: stats
      };
    }

    // Test actual connectivity
    const connectionTest = await testConnection();
    
    return {
      healthy: connectionTest.success,
      message: connectionTest.success 
        ? 'Database is healthy and responsive' 
        : 'Database connectivity issues detected',
      details: {
        ...stats,
        connectionTest: connectionTest
      }
    };
  } catch (error) {
    return {
      healthy: false,
      message: 'Database health check failed',
      error: error.message,
      details: getDatabaseStats()
    };
  }
}

/**
 * Execute a stored procedure that returns multiple result sets
 * Useful for procedures that return more than one SELECT statement
 * @param {string} procedureName - The name of the stored procedure
 * @param {Array} params - An array of parameter arrays [name, type, value]
 * @returns {Promise<Array>} - Array of result sets (each result set is an array of rows)
 */
function executeMultipleResultSets(procedureName, params = []) {
  return ConnectionPool.withConnection(async (connection) => {
    return new Promise((resolve, reject) => {
      const request = new Request(procedureName, (err) => {
        if (err) {
          console.error('Stored procedure execution error:', {
            error: err.message,
            procedure: procedureName,
            code: err.code
          });
          reject(err);
          return;
        }
      });

      // Add parameters with validation
      try {
        params.forEach((param, index) => {
          if (!Array.isArray(param) || param.length < 3) {
            throw new Error(`Invalid parameter at index ${index}: expected [name, type, value]`);
          }
          const [name, type, value] = param;
          const options = value === null ? { nullable: true } : undefined;
          request.addParameter(name, type, value, options);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      const resultSets = [];
      let currentSet = [];

      // Handle row data
      request.on('row', (columns) => {
        const row = {};
        columns.forEach(col => {
          row[col.metadata.colName] = col.value;
        });
        currentSet.push(row);
      });

      // Handle result set completion (doneInProc fires after each SELECT)
      request.on('doneInProc', (rowCount, more) => {
        // Always push current set to maintain result set order
        resultSets.push([...currentSet]);
        currentSet = [];
      });

      // Handle final completion
      request.on('requestCompleted', () => {
        console.log(`Stored procedure '${procedureName}' completed: ${resultSets.length} result sets returned`);
        resolve(resultSets);
      });

      // Handle errors
      request.on('error', (error) => {
        console.error('Request error:', {
          error: error.message,
          procedure: procedureName,
          code: error.code
        });
        reject(error);
      });

      // Execute the stored procedure
      connection.callProcedure(request);
    });
  });
}

/**
 * Graceful shutdown of database service
 * @returns {Promise<void>}
 */
async function shutdown() {
  console.log('Initiating database service shutdown');
  try {
    await ConnectionPool.cleanup();
    console.log('Database service shutdown completed');
  } catch (error) {
    console.error('Error during database service shutdown:', error);
    throw error;
  }
}

// Export all functions and types
export {
  executeQuery,
  executeStoredProcedure,
  executeMultipleResultSets,
  withConnection,
  executeRawQuery,
  testConnection,
  testConnectionWithRetry,
  getDatabaseStats,
  healthCheck,
  shutdown,
  TYPES
};
