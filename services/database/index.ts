// services/database/index.ts
/**
 * Enhanced Database service with connection pooling and better error handling
 * Provides methods for database operations with improved resource management
 */
import { Connection, Request, TYPES } from 'tedious';
import type { ColumnValue } from '../../types/database.types.js';

import ConnectionPool from './ConnectionPool.js';
import ResourceManager from '../core/ResourceManager.js';
import { log } from '../../utils/logger.js';

// Type definitions
export type TediousType = (typeof TYPES)[keyof typeof TYPES];
export type SqlParam = [string, TediousType, unknown];
export type RowMapper<T> = (columns: ColumnValue[]) => T;
export type ResultMapper<T, R> = (result: T[], outputParams: OutputParam[]) => R;

interface OutputParam {
  parameterName: string;
  value: unknown;
}

interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
}

interface DatabaseStats {
  connectionPool: PoolStats;
  timestamp: number;
  healthy: boolean;
}

interface ConnectionTestResult {
  version?: string;
  currentTime?: Date;
  quotedIdentifier?: number;
  ansiNulls?: number;
}

interface TestResult {
  success: boolean;
  message: string;
  data?: ConnectionTestResult;
  error?: string;
  poolStats?: PoolStats;
}

interface HealthCheckResult {
  healthy: boolean;
  message: string;
  error?: string;
  details: DatabaseStats & { connectionTest?: TestResult };
}

// Extended array type with rowsAffected property
interface QueryResult<T> extends Array<T> {
  rowsAffected?: number;
}

// Register database service with resource manager
ResourceManager.register('database-service', null, async () => {
  log.info('Shutting down database service');
  await ConnectionPool.cleanup();
});

/**
 * Enhanced executeQuery function using connection pool
 * @param query - SQL query string
 * @param params - Array of [name, type, value] tuples
 * @param rowMapper - Optional function to map each row (required for SELECT, optional for INSERT/UPDATE/DELETE)
 * @param resultMapper - Optional function to transform the final result array
 */
export function executeQuery<T = Record<string, unknown>, R = T[]>(
  query: string,
  params: SqlParam[] = [],
  rowMapper?: RowMapper<T>,
  resultMapper: ResultMapper<T, R> = ((result: T[]) => result) as unknown as ResultMapper<T, R>
): Promise<R & { rowsAffected?: number }> {
  return ConnectionPool.withConnection(async (connection: Connection) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!query || typeof query !== 'string') {
        reject(new Error('Query must be a non-empty string'));
        return;
      }

      const result: QueryResult<T> = [] as unknown as QueryResult<T>;
      const outputParams: OutputParam[] = [];
      let selectRowCount = 0;

      const request = new Request(query, (err: Error | null | undefined, rowCount?: number) => {
        if (err) {
          log.error('Query execution error', {
            error: err.message,
            query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
            code: (err as Error & { code?: string }).code,
          });
          reject(err);
          return;
        }

        try {
          log.debug(`Query completed: ${rowCount} rows affected/returned, ${selectRowCount} rows collected`);
          result.rowsAffected = rowCount;
          const finalResult = resultMapper(result, outputParams) as R & { rowsAffected?: number };
          if (finalResult !== (result as unknown) && typeof finalResult === 'object' && finalResult !== null) {
            finalResult.rowsAffected = rowCount;
          }
          resolve(finalResult);
        } catch (resultMappingError) {
          log.error('Result mapping error', {
            error: (resultMappingError as Error).message,
            rowCount: result.length,
            query: query.substring(0, 50) + '...',
          });
          reject(new Error(`Result mapping failed: ${(resultMappingError as Error).message}`));
        }
      });

      // Add parameters with validation
      try {
        (params || []).forEach((param, index) => {
          if (!Array.isArray(param) || param.length < 3) {
            throw new Error(`Invalid parameter at index ${index}: expected [name, type, value]`);
          }
          const [name, type, value] = param;
          request.addParameter(name, type, value);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      // Handle row data (for SELECT queries)
      request.on('row', (columns: ColumnValue[]) => {
        try {
          selectRowCount++;
          const mappedRow = rowMapper ? rowMapper(columns) : (columns as unknown as T);
          result.push(mappedRow);
        } catch (mappingError) {
          log.error('Row mapping error', {
            error: (mappingError as Error).message,
            rowIndex: selectRowCount - 1,
            query: query.substring(0, 50) + '...',
          });
          reject(new Error(`Row mapping failed at row ${selectRowCount - 1}: ${(mappingError as Error).message}`));
        }
      });

      // Handle output parameters
      request.on('returnValue', (parameterName: string, value: unknown) => {
        outputParams.push({ parameterName, value });
        log.debug(`Output parameter: ${parameterName} = ${value}`);
      });

      // Handle request errors
      request.on('error', (error: Error) => {
        log.error('Request error', {
          error: error.message,
          code: (error as Error & { code?: string }).code,
          query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        });
        reject(error);
      });

      // Execute the request
      try {
        connection.execSql(request);
      } catch (execError) {
        log.error('SQL execution error', { error: (execError as Error).message });
        reject(execError);
      }
    });
  });
}

/**
 * Enhanced executeStoredProcedure function using connection pool
 */
export function executeStoredProcedure<T, R = T[]>(
  procedureName: string,
  params: SqlParam[],
  beforeExec?: (request: Request) => void,
  rowMapper?: RowMapper<T>,
  resultMapper?: ResultMapper<T, R>
): Promise<R> {
  return ConnectionPool.withConnection(async (connection: Connection) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!procedureName || typeof procedureName !== 'string') {
        reject(new Error('Procedure name must be a non-empty string'));
        return;
      }

      const request = new Request(procedureName, (err: Error | null | undefined) => {
        if (err) {
          log.error('Stored procedure execution error', {
            error: err.message,
            procedure: procedureName,
            code: (err as Error & { code?: string }).code,
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
          request.addParameter(name, type, value);
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
            error: (beforeExecError as Error).message,
            procedure: procedureName,
          });
          reject(new Error(`beforeExec callback failed: ${(beforeExecError as Error).message}`));
          return;
        }
      }

      const result: T[] = [];
      const outParams: OutputParam[] = [];
      let rowCount = 0;

      // Handle row data
      request.on('row', (columns: ColumnValue[]) => {
        try {
          rowCount++;
          const mappedRow = rowMapper ? rowMapper(columns) : (columns as unknown as T);
          result.push(mappedRow);
        } catch (mappingError) {
          log.error('Row mapping error in stored procedure', {
            error: (mappingError as Error).message,
            rowIndex: rowCount - 1,
            procedure: procedureName,
          });
          reject(new Error(`Row mapping failed at row ${rowCount - 1}: ${(mappingError as Error).message}`));
        }
      });

      // Handle return values/output parameters
      request.on('returnValue', (parameterName: string, value: unknown) => {
        outParams.push({ parameterName, value });
      });

      // Handle completion
      request.on('requestCompleted', () => {
        try {
          const finalResult = resultMapper ? resultMapper(result, outParams) : (result as unknown as R);
          resolve(finalResult);
        } catch (resultMappingError) {
          log.error('Result mapping error in stored procedure', {
            error: (resultMappingError as Error).message,
            procedure: procedureName,
            rowCount: result.length,
          });
          reject(new Error(`Result mapping failed: ${(resultMappingError as Error).message}`));
        }
      });

      // Handle request errors
      request.on('error', (error: Error) => {
        log.error('Stored procedure request error', {
          error: error.message,
          code: (error as Error & { code?: string }).code,
          procedure: procedureName,
        });
        reject(error);
      });

      // Execute the stored procedure
      try {
        connection.callProcedure(request);
      } catch (execError) {
        log.error('Stored procedure execution error', { error: (execError as Error).message });
        reject(execError);
      }
    });
  });
}

/**
 * Execute multiple operations within a single connection
 */
export function withConnection<T>(operations: (connection: Connection) => Promise<T>): Promise<T> {
  return ConnectionPool.withConnection(operations);
}

/**
 * Execute a raw SQL query with a specific connection
 */
export function executeRawQuery(
  connection: Connection,
  query: string,
  params: SqlParam[] = []
): Promise<ColumnValue[][]> {
  return new Promise((resolve, reject) => {
    const request = new Request(query, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
    });

    // Add parameters
    params.forEach((param) => {
      request.addParameter(param[0], param[1], param[2]);
    });

    const result: ColumnValue[][] = [];

    request.on('row', (columns: ColumnValue[]) => {
      result.push(columns);
    });

    request.on('requestCompleted', () => {
      resolve(result);
    });

    request.on('error', (error: Error) => {
      reject(error);
    });

    connection.execSql(request);
  });
}

/**
 * Test database connectivity
 */
export async function testConnection(): Promise<TestResult> {
  try {
    const testResult = await executeQuery<ConnectionTestResult>(
      `SELECT
        @@VERSION as Version,
        GETDATE() as CurrentTime,
        SESSIONPROPERTY('QUOTED_IDENTIFIER') as QUOTED_IDENTIFIER,
        SESSIONPROPERTY('ANSI_NULLS') as ANSI_NULLS`,
      [],
      (columns: ColumnValue[]) => ({
        version: columns[0].value as string,
        currentTime: columns[1].value as Date,
        quotedIdentifier: columns[2].value as number,
        ansiNulls: columns[3].value as number,
      })
    );

    log.info('Database connection test successful');
    log.debug('Session settings:', {
      QUOTED_IDENTIFIER: testResult[0]?.quotedIdentifier,
      ANSI_NULLS: testResult[0]?.ansiNulls,
    });
    return {
      success: true,
      message: 'Database connection successful',
      data: testResult[0],
      poolStats: ConnectionPool.getStats(),
    };
  } catch (error) {
    log.error('Database connection test failed:', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : String(error),
      poolStats: ConnectionPool.getStats(),
    };
  }
}

/**
 * Test database connectivity with retry logic for service startup
 */
export async function testConnectionWithRetry(maxRetries = 5, retryDelay = 15000): Promise<TestResult> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log.info(`Database connection attempt ${attempt}/${maxRetries}...`);
      const result = await testConnection();

      if (result.success) {
        if (attempt > 1) {
          log.info(`Database connection successful after ${attempt} attempts`);
        }
        return result;
      }

      lastError = result.error || null;
    } catch (error) {
      lastError = (error as Error).message;
      log.error(`Database connection attempt ${attempt} failed:`, { error: (error as Error).message });
    }

    if (attempt < maxRetries) {
      log.info(`Waiting ${retryDelay / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  return {
    success: false,
    message: `Database connection failed after ${maxRetries} attempts`,
    error: lastError || 'Unknown error',
  };
}

/**
 * Get database and connection pool statistics
 */
export function getDatabaseStats(): DatabaseStats {
  const poolStats = ConnectionPool.getStats();

  return {
    connectionPool: poolStats,
    timestamp: Date.now(),
    healthy: !poolStats.isShuttingDown && poolStats.totalConnections > 0,
  };
}

/**
 * Health check for database service
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  try {
    const stats = getDatabaseStats();

    if (!stats.healthy) {
      return {
        healthy: false,
        message: 'Database connection pool is not healthy',
        details: stats,
      };
    }

    const connectionTest = await testConnection();

    return {
      healthy: connectionTest.success,
      message: connectionTest.success
        ? 'Database is healthy and responsive'
        : 'Database connectivity issues detected',
      details: {
        ...stats,
        connectionTest: connectionTest,
      },
    };
  } catch (error) {
    return {
      healthy: false,
      message: 'Database health check failed',
      error: (error as Error).message,
      details: getDatabaseStats(),
    };
  }
}

/**
 * Execute a stored procedure that returns multiple result sets
 */
export function executeMultipleResultSets<T extends object>(
  procedureName: string,
  params: SqlParam[] = []
): Promise<T[][]> {
  return ConnectionPool.withConnection(async (connection: Connection) => {
    return new Promise((resolve, reject) => {
      const request = new Request(procedureName, (err: Error | null | undefined) => {
        if (err) {
          log.error('Stored procedure execution error:', {
            error: err.message,
            procedure: procedureName,
            code: (err as Error & { code?: string }).code,
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
          request.addParameter(name, type, value);
        });
      } catch (paramError) {
        reject(paramError);
        return;
      }

      const resultSets: T[][] = [];
      let currentSet: T[] = [];

      // Handle row data
      request.on('row', (columns: ColumnValue[]) => {
        const row = {} as T;
        columns.forEach((col) => {
          (row as Record<string, unknown>)[col.metadata.colName] = col.value;
        });
        currentSet.push(row);
      });

      // Handle result set completion
      request.on('doneInProc', () => {
        resultSets.push([...currentSet]);
        currentSet = [];
      });

      // Handle final completion
      request.on('requestCompleted', () => {
        log.debug(`Stored procedure '${procedureName}' completed: ${resultSets.length} result sets returned`);
        resolve(resultSets);
      });

      // Handle errors
      request.on('error', (error: Error) => {
        log.error('Request error:', {
          error: error.message,
          procedure: procedureName,
          code: (error as Error & { code?: string }).code,
        });
        reject(error);
      });

      connection.callProcedure(request);
    });
  });
}

/**
 * Graceful shutdown of database service
 */
export async function shutdown(): Promise<void> {
  log.info('Initiating database service shutdown');
  try {
    await ConnectionPool.cleanup();
    log.info('Database service shutdown completed');
  } catch (error) {
    log.error('Error during database service shutdown:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Export TYPES for use in query modules
export { TYPES };
