// services/database/TransactionManager.js
import { Connection, Request, TYPES } from 'tedious';
import config from '../../config/config.js';
import ConnectionPool from './ConnectionPool.js';

/**
 * Enhanced database transaction manager with timeout handling and connection pooling
 */
class TransactionManager {
  constructor() {
    this.activeTransactions = new Map();
    this.transactionTimeout = 30000; // 30 seconds default
  }

  /**
   * Execute operations within a transaction with enhanced error handling
   */
  async withTransaction(operations, timeoutMs = this.transactionTimeout) {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let connection = null;
    let timeoutHandle = null;

    try {
      console.log(`Starting transaction ${transactionId} with ${operations.length} operations`);
      
      // Get connection from pool with timeout
      connection = await ConnectionPool.getConnection(timeoutMs);
      
      // Set transaction timeout
      timeoutHandle = setTimeout(() => {
        console.error(`Transaction ${transactionId} timeout after ${timeoutMs}ms`);
        if (this.activeTransactions.has(transactionId)) {
          this.forceRollback(transactionId, connection);
        }
      }, timeoutMs);

      // Begin transaction
      await this.beginTransactionAsync(connection, timeoutMs);
      this.activeTransactions.set(transactionId, { 
        connection, 
        startTime: Date.now(),
        timeoutHandle 
      });

      // Execute operations with progress tracking
      const results = [];
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        console.log(`Executing transaction operation ${i + 1}/${operations.length} for ${transactionId}`);
        
        const result = await operation(connection);
        results.push(result);
      }

      // Clear timeout before commit
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      // Commit transaction
      await this.commitTransactionAsync(connection);
      console.log(`Transaction ${transactionId} committed successfully`);
      return results;

    } catch (error) {
      console.error(`Transaction ${transactionId} failed:`, error.message);
      
      // Enhanced rollback with better error handling
      if (connection) {
        try {
          await this.rollbackTransactionAsync(connection);
          console.log(`Transaction ${transactionId} rolled back successfully`);
        } catch (rollbackError) {
          console.error(`Rollback failed for transaction ${transactionId}:`, rollbackError.message);
          // Force close connection on rollback failure
          try {
            connection.close();
          } catch (closeError) {
            console.error(`Connection close failed for transaction ${transactionId}:`, closeError.message);
          }
        }
      }
      throw error;

    } finally {
      // Comprehensive cleanup
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      
      const transactionData = this.activeTransactions.get(transactionId);
      if (transactionData) {
        const duration = Date.now() - transactionData.startTime;
        console.log(`Transaction ${transactionId} duration: ${duration}ms`);
        this.activeTransactions.delete(transactionId);
      }
      
      if (connection) {
        try {
          ConnectionPool.releaseConnection(connection);
        } catch (releaseError) {
          console.error(`Error releasing connection for transaction ${transactionId}:`, releaseError.message);
        }
      }
    }
  }

  /**
   * Force rollback for timed-out transactions
   */
  async forceRollback(transactionId, connection) {
    console.warn(`Force rolling back transaction ${transactionId}`);
    try {
      await this.rollbackTransactionAsync(connection);
      this.activeTransactions.delete(transactionId);
    } catch (error) {
      console.error(`Force rollback failed for ${transactionId}:`, error.message);
      // Force close connection
      try {
        connection.close();
      } catch (closeError) {
        console.error(`Force connection close failed for ${transactionId}:`, closeError.message);
      }
    }
  }

  /**
   * Helper to promisify connection.connect() with timeout
   */
  connectAsync(connection, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      connection.on('connect', (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
      
      connection.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      connection.connect();
    });
  }

  /**
   * Begin transaction with timeout
   */
  beginTransactionAsync(connection, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BEGIN TRANSACTION timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const request = new Request('BEGIN TRANSACTION', (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
      
      try {
        connection.execSql(request);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Commit transaction with timeout
   */
  commitTransactionAsync(connection, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`COMMIT TRANSACTION timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const request = new Request('COMMIT TRANSACTION', (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
      
      try {
        connection.execSql(request);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Rollback transaction with timeout
   */
  rollbackTransactionAsync(connection, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`ROLLBACK TRANSACTION timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const request = new Request('ROLLBACK TRANSACTION', (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
      
      try {
        connection.execSql(request);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Get statistics about active transactions
   */
  getStats() {
    const transactions = Array.from(this.activeTransactions.entries()).map(([id, data]) => ({
      id,
      duration: Date.now() - data.startTime,
      startTime: data.startTime
    }));

    return {
      activeCount: this.activeTransactions.size,
      transactions,
      oldestTransaction: transactions.length > 0 ? 
        Math.max(...transactions.map(t => t.duration)) : 0
    };
  }

  /**
   * Force cleanup of all transactions (emergency use)
   */
  async forceCleanupAll() {
    console.warn(`Force cleaning up ${this.activeTransactions.size} active transactions`);
    
    const cleanupPromises = [];
    for (const [transactionId, data] of this.activeTransactions.entries()) {
      cleanupPromises.push(this.forceRollback(transactionId, data.connection));
    }
    
    await Promise.allSettled(cleanupPromises);
    this.activeTransactions.clear();
  }
}

export default new TransactionManager();