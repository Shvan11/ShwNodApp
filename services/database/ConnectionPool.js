// services/database/ConnectionPool.js
import { Connection } from 'tedious';
import config from '../../config/config.js';
import ResourceManager from '../core/ResourceManager.js';

/**
 * Database connection pool for better resource management
 */
class ConnectionPool {
  constructor(maxConnections = 10) {
    this.maxConnections = maxConnections;
    this.connections = [];
    this.activeConnections = new Set();
    this.waitingQueue = [];
    this.isShuttingDown = false;

    // Register with resource manager
    ResourceManager.register('database-pool', this, this.cleanup.bind(this));
  }

  /**
   * Get a connection from the pool with enhanced timeout and cleanup
   */
  async getConnection(timeoutMs = 30000) {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Enhanced cleanup - find and remove this specific request
        const requestIndex = this.waitingQueue.findIndex(item => 
          item.resolve === resolve || item.reject === reject
        );
        if (requestIndex >= 0) {
          this.waitingQueue.splice(requestIndex, 1);
          console.warn(`Connection request timeout after ${timeoutMs}ms. Queue length: ${this.waitingQueue.length}`);
        }
        reject(new Error(`Connection request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Check if we have available connections (verify connection state)
      const availableConnection = this.connections.find(conn => 
        !this.activeConnections.has(conn) && 
        conn.readyState === conn.STATE.LoggedIn
      );
      
      if (availableConnection) {
        clearTimeout(timeout);
        this.activeConnections.add(availableConnection);
        console.log(`Reusing existing connection. Active: ${this.activeConnections.size}/${this.connections.length}`);
        resolve(availableConnection);
        return;
      }

      // Check if we can create new connection
      if (this.connections.length < this.maxConnections) {
        this.createConnection()
          .then(connection => {
            clearTimeout(timeout);
            this.activeConnections.add(connection);
            console.log(`Created new connection. Active: ${this.activeConnections.size}/${this.connections.length}`);
            resolve(connection);
          })
          .catch(error => {
            clearTimeout(timeout);
            console.error('Failed to create new connection:', error);
            reject(error);
          });
        return;
      }

      // Add to waiting queue with enhanced metadata
      const queueEntry = { 
        resolve, 
        reject, 
        timeout,
        timestamp: Date.now(),
        timeoutMs
      };
      this.waitingQueue.push(queueEntry);
      
      console.log(`Added to connection queue. Position: ${this.waitingQueue.length}, Pool: ${this.activeConnections.size}/${this.connections.length}`);
    });
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connection) {
    this.activeConnections.delete(connection);

    // Check if there are waiting requests
    if (this.waitingQueue.length > 0) {
      const { resolve, timeout } = this.waitingQueue.shift();
      clearTimeout(timeout);
      this.activeConnections.add(connection);
      resolve(connection);
    }
  }

  /**
   * Create a new database connection
   */
  async createConnection() {
    return new Promise((resolve, reject) => {
      const connection = new Connection(config.database);

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
        console.log(`Database connection created. Pool size: ${this.connections.length}`);
        resolve(connection);
      });

      connection.on('error', (error) => {
        console.error('Database connection error:', error);
        this.removeConnection(connection);
      });

      connection.on('end', () => {
        console.log('Database connection ended');
        this.removeConnection(connection);
      });

      connection.connect();
    });
  }

  /**
   * Remove a connection from the pool
   */
  removeConnection(connection) {
    const index = this.connections.indexOf(connection);
    if (index >= 0) {
      try {
        if (connection.readyState === connection.STATE.LoggedIn) {
          connection.close();
        }
      } catch (error) {
        console.error('Error closing connection:', error);
      }
      this.connections.splice(index, 1);
      this.activeConnections.delete(connection);
    }
  }

  /**
   * Execute query with automatic connection management
   */
  async withConnection(operation) {
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
  getStats() {
    return {
      totalConnections: this.connections.length,
      activeConnections: this.activeConnections.size,
      waitingRequests: this.waitingQueue.length,
      maxConnections: this.maxConnections,
      isShuttingDown: this.isShuttingDown
    };
  }

  /**
   * Cleanup all connections
   */
  async cleanup() {
    console.log('Shutting down database connection pool');
    this.isShuttingDown = true;

    // Reject all waiting requests
    this.waitingQueue.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection pool is shutting down'));
    });
    this.waitingQueue.length = 0;

    // Close all connections
    const closePromises = this.connections.map(connection => {
      return new Promise(resolve => {
        try {
          connection.close();
          resolve();
        } catch (error) {
          console.error('Error closing database connection:', error);
          resolve();
        }
      });
    });

    await Promise.allSettled(closePromises);
    console.log('Database connection pool shutdown complete');
  }
}

export default new ConnectionPool();