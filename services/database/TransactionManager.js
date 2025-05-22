// services/database/TransactionManager.js
import { Connection, Request, TYPES } from 'tedious';
import config from '../../config/config.js';

/**
 * Database transaction manager for atomic operations
 */
class TransactionManager {
  constructor() {
    this.activeTransactions = new Map();
  }

  /**
   * Execute operations within a transaction
   */
  async withTransaction(operations) {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let connection = null;

    try {
      connection = new Connection(config.database);
      await this.connectAsync(connection);

      // Begin transaction
      await this.beginTransactionAsync(connection);
      this.activeTransactions.set(transactionId, connection);

      // Execute operations
      const results = [];
      for (const operation of operations) {
        const result = await operation(connection);
        results.push(result);
      }

      // Commit transaction
      await this.commitTransactionAsync(connection);
      return results;

    } catch (error) {
      // Rollback on error
      if (connection) {
        try {
          await this.rollbackTransactionAsync(connection);
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
      }
      throw error;

    } finally {
      // Cleanup
      this.activeTransactions.delete(transactionId);
      if (connection) {
        connection.close();
      }
    }
  }

  /**
   * Helper to promisify connection.connect()
   */
  connectAsync(connection) {
    return new Promise((resolve, reject) => {
      connection.on('connect', (err) => {
        if (err) reject(err);
        else resolve();
      });
      connection.connect();
    });
  }

  /**
   * Begin transaction
   */
  beginTransactionAsync(connection) {
    return new Promise((resolve, reject) => {
      const request = new Request('BEGIN TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
      connection.execSql(request);
    });
  }

  /**
   * Commit transaction
   */
  commitTransactionAsync(connection) {
    return new Promise((resolve, reject) => {
      const request = new Request('COMMIT TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
      connection.execSql(request);
    });
  }

  /**
   * Rollback transaction
   */
  rollbackTransactionAsync(connection) {
    return new Promise((resolve, reject) => {
      const request = new Request('ROLLBACK TRANSACTION', (err) => {
        if (err) reject(err);
        else resolve();
      });
      connection.execSql(request);
    });
  }
}

export default new TransactionManager();