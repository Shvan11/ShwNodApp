/**
 * Enhanced Database service with connection pooling and better error handling
 * Provides methods for database operations with improved resource management
 */
import { Connection, Request, TYPES } from 'tedious';

import ConnectionPool from './ConnectionPool.js';
import ResourceManager from '../core/ResourceManager.js';

// Register database service with resource manager
ResourceManager.register('database-service', null, async () => {
  console.log('Shutting down database service');
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

      const request = new Request(query, (err) => {
        if (err) {
          console.error('Query execution error:', {
            error: err.message,
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
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
          request.addParameter(param[0], param[1], param[2]);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      const result = [];
      const outputParams = [];
      let rowCount = 0;

      // Handle row data
      request.on('row', (columns) => {
        try {
          rowCount++;
          const mappedRow = rowMapper ? rowMapper(columns) : columns;
          result.push(mappedRow);
        } catch (mappingError) {
          console.error('Row mapping error:', {
            error: mappingError.message,
            rowIndex: rowCount - 1,
            query: query.substring(0, 50) + '...'
          });
          reject(new Error(`Row mapping failed at row ${rowCount - 1}: ${mappingError.message}`));
        }
      });

      // Handle output parameters
      request.on('returnValue', (parameterName, value) => {
        outputParams.push({ parameterName, value });
        console.log(`Output parameter: ${parameterName} = ${value}`);
      });

      // Handle completion
      request.on('requestCompleted', (rowCount, more) => {
        try {
          console.log(`Query completed: ${rowCount} rows affected/returned`);
          const finalResult = resultMapper(result, outputParams);
          resolve(finalResult);
        } catch (resultMappingError) {
          console.error('Result mapping error:', {
            error: resultMappingError.message,
            rowCount: result.length,
            query: query.substring(0, 50) + '...'
          });
          reject(new Error(`Result mapping failed: ${resultMappingError.message}`));
        }
      });

      // Handle request errors
      request.on('error', (error) => {
        console.error('Request error:', {
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
        console.error('SQL execution error:', execError);
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
        (params || []).forEach((param, index) => {
          if (!Array.isArray(param) || param.length < 3) {
            throw new Error(`Invalid parameter at index ${index}: expected [name, type, value]`);
          }
          request.addParameter(param[0], param[1], param[2]);
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
          console.error('beforeExec callback error:', {
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
          console.error('Row mapping error in stored procedure:', {
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
        console.log(`${procedureName} output: ${parameterName} = ${value}`);
      });

      // Handle completion
      request.on('requestCompleted', (rowCount, more) => {
        try {
          console.log(`Stored procedure ${procedureName} completed: ${rowCount} rows returned`);
          const finalResult = resultMapper ? resultMapper(result, outParams) : result;
          resolve(finalResult);
        } catch (resultMappingError) {
          console.error('Result mapping error in stored procedure:', {
            error: resultMappingError.message,
            procedure: procedureName,
            rowCount: result.length
          });
          reject(new Error(`Result mapping failed: ${resultMappingError.message}`));
        }
      });

      // Handle request errors
      request.on('error', (error) => {
        console.error('Stored procedure request error:', {
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
        console.error('Stored procedure execution error:', execError);
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
      'SELECT @@VERSION as Version, GETDATE() as CurrentTime',
      [],
      (columns) => ({
        version: columns[0].value,
        currentTime: columns[1].value
      })
    );

    console.log('Database connection test successful');
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
  withConnection,
  executeRawQuery,
  testConnection,
  testConnectionWithRetry,
  getDatabaseStats,
  healthCheck,
  shutdown,
  TYPES 
};
