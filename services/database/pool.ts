import sql from 'mssql';
import config from '../../config/config.js';
import ResourceManager from '../core/ResourceManager.js';
import { log } from '../../utils/logger.js';

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
          log.error('Pool error', { error: err.message });
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

ResourceManager.register('database-pool', null, async () => {
  if (pool) {
    await pool.close();
    pool = null;
    connectPromise = null;
    log.info('Connection pool closed');
  }
});
