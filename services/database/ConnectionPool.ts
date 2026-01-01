// services/database/ConnectionPool.ts
import { Connection } from 'tedious';
import type { ConnectionConfiguration } from 'tedious/lib/connection.js';

// Use tedious connection configuration type
type ConnectionConfig = ConnectionConfiguration;
import config from '../../config/config.js';
import ResourceManager from '../core/ResourceManager.js';
import { logger } from '../core/Logger.js';

interface QueueEntry {
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
  timeoutMs: number;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
  [key: string]: number | boolean;
}

/**
 * Database connection pool for better resource management
 */
class ConnectionPool {
  private maxConnections: number;
  private connections: Connection[] = [];
  private activeConnections: Set<Connection> = new Set();
  private waitingQueue: QueueEntry[] = [];
  private _isShuttingDown = false;

  constructor(maxConnections = 10) {
    this.maxConnections = maxConnections;

    // Register with resource manager
    ResourceManager.register('database-pool', this, this.cleanup.bind(this));
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /**
   * Get a connection from the pool with enhanced timeout and cleanup
   */
  async getConnection(timeoutMs = 30000): Promise<Connection> {
    if (this._isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const requestIndex = this.waitingQueue.findIndex(
          (item) => item.resolve === resolve || item.reject === reject
        );
        if (requestIndex >= 0) {
          this.waitingQueue.splice(requestIndex, 1);
          logger.database.warn(`Connection timeout after ${timeoutMs}ms`, {
            queueLength: this.waitingQueue.length,
          });
        }
        reject(new Error(`Connection request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Check if we have available connections (verify connection state)
      const availableConnection = this.connections.find(
        (conn) => !this.activeConnections.has(conn) && conn.state?.name === 'LoggedIn'
      );

      if (availableConnection) {
        clearTimeout(timeout);
        this.activeConnections.add(availableConnection);
        logger.database.debug(`Reusing connection`, {
          active: this.activeConnections.size,
          total: this.connections.length,
        });
        resolve(availableConnection);
        return;
      }

      // Check if we can create new connection
      if (this.connections.length < this.maxConnections) {
        this.createConnection()
          .then((connection) => {
            clearTimeout(timeout);
            this.activeConnections.add(connection);
            logger.database.debug(`Created connection`, {
              active: this.activeConnections.size,
              total: this.connections.length,
            });
            resolve(connection);
          })
          .catch((error) => {
            clearTimeout(timeout);
            logger.database.error('Failed to create connection', error);
            reject(error);
          });
        return;
      }

      // Add to waiting queue with enhanced metadata
      const queueEntry: QueueEntry = {
        resolve,
        reject,
        timeout,
        timestamp: Date.now(),
        timeoutMs,
      };
      this.waitingQueue.push(queueEntry);

      logger.database.debug(`Queued connection request`, {
        position: this.waitingQueue.length,
        active: this.activeConnections.size,
        total: this.connections.length,
      });
    });
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connection: Connection): void {
    this.activeConnections.delete(connection);

    // Check if there are waiting requests
    if (this.waitingQueue.length > 0) {
      const { resolve, timeout } = this.waitingQueue.shift()!;
      clearTimeout(timeout);
      this.activeConnections.add(connection);
      resolve(connection);
    }
  }

  /**
   * Create a new database connection
   */
  private async createConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const connection = new Connection(config.database as ConnectionConfig);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Database connection timeout'));
      }, 15000);

      connection.on('connect', (err) => {
        clearTimeout(connectTimeout);

        if (err) {
          reject(err);
          return;
        }

        this.connections.push(connection);
        logger.database.info(`Connection created`, { poolSize: this.connections.length });
        resolve(connection);
      });

      connection.on('error', (error) => {
        logger.database.error('Connection error', error);
        this.removeConnection(connection);
      });

      connection.on('end', () => {
        logger.database.debug('Connection ended');
        this.removeConnection(connection);
      });

      connection.connect();
    });
  }

  /**
   * Remove a connection from the pool
   */
  private removeConnection(connection: Connection): void {
    const index = this.connections.indexOf(connection);
    if (index >= 0) {
      try {
        if (connection.state?.name === 'LoggedIn') {
          connection.close();
        }
      } catch (error) {
        logger.database.error('Error closing connection', error);
      }
      this.connections.splice(index, 1);
      this.activeConnections.delete(connection);
    }
  }

  /**
   * Execute query with automatic connection management
   */
  async withConnection<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection();

    try {
      return await operation(connection);
    } finally {
      this.releaseConnection(connection);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      totalConnections: this.connections.length,
      activeConnections: this.activeConnections.size,
      waitingRequests: this.waitingQueue.length,
      maxConnections: this.maxConnections,
      isShuttingDown: this._isShuttingDown,
    };
  }

  /**
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    logger.database.info('Shutting down connection pool');
    this._isShuttingDown = true;

    // Reject all waiting requests
    this.waitingQueue.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection pool is shutting down'));
    });
    this.waitingQueue.length = 0;

    // Close all connections
    const closePromises = this.connections.map((connection) => {
      return new Promise<void>((resolve) => {
        try {
          connection.close();
          resolve();
        } catch (error) {
          logger.database.error('Error closing connection during shutdown', error);
          resolve();
        }
      });
    });

    await Promise.allSettled(closePromises);
    logger.database.info('Connection pool shutdown complete');
  }
}

export default new ConnectionPool();
