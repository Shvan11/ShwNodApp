import sql from 'mssql';
import config from '../../config/config.js';
import ResourceManager from '../core/ResourceManager.js';
import { logger } from '../core/Logger.js';

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
  [key: string]: number | boolean;
}

let pool: sql.ConnectionPool | null = null;
let connectPromise: Promise<sql.ConnectionPool> | null = null;

function buildMssqlConfig(): sql.config {
  const db = config.database;
  return {
    server: db.server,
    database: db.database,
    user: db.authentication.options.userName,
    password: db.authentication.options.password,
    options: {
      instanceName: db.options.instanceName,
      encrypt: false,
      trustServerCertificate: true,
      useUTC: false,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool) return pool;
  if (!connectPromise) {
    connectPromise = new sql.ConnectionPool(buildMssqlConfig())
      .connect()
      .then((p) => {
        pool = p;
        pool.on('error', (err: Error) => {
          logger.database.error('Pool error', { error: err.message });
        });
        return p;
      })
      .catch((err: Error) => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

export function getStats(): PoolStats {
  if (!pool) {
    return {
      totalConnections: 0,
      activeConnections: 0,
      waitingRequests: 0,
      maxConnections: 10,
      isShuttingDown: true,
    };
  }
  // tarn is the internal pool manager exposed by mssql
  const tarn = (pool as unknown as { pool: { numUsed(): number; numFree(): number; numPendingAcquires(): number; max: number } }).pool;
  return {
    totalConnections: tarn.numUsed() + tarn.numFree(),
    activeConnections: tarn.numUsed(),
    waitingRequests: tarn.numPendingAcquires(),
    maxConnections: tarn.max,
    isShuttingDown: false,
  };
}

ResourceManager.register('database-pool', null, async () => {
  if (pool) {
    await pool.close();
    pool = null;
    connectPromise = null;
    logger.database.info('Connection pool closed');
  }
});
