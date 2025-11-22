/**
 * TransactionManager - Database Transaction Control
 *
 * Provides explicit transaction management for SQL Server operations
 * to ensure atomicity and prevent race conditions between DB writes
 * and WebSocket broadcasts.
 */

import { Request, ISOLATION_LEVEL } from 'tedious';
import { log } from '../../utils/logger.js';

export class Transaction {
    constructor(connection, transactionId) {
        this.connection = connection;
        this.transactionId = transactionId;
        this.isActive = true;
        this.isCommitted = false;
        this.isRolledBack = false;
    }

    /**
     * Commit the transaction
     * @returns {Promise<void>}
     */
    commit() {
        return new Promise((resolve, reject) => {
            if (!this.isActive) {
                reject(new Error('Transaction is not active'));
                return;
            }

            if (this.isCommitted || this.isRolledBack) {
                reject(new Error('Transaction already finalized'));
                return;
            }

            const request = new Request('COMMIT TRANSACTION', (err) => {
                if (err) {
                    log.error('Transaction commit failed', {
                        error: err,
                        transactionId: this.transactionId
                    });
                    this.isActive = false;
                    reject(err);
                } else {
                    this.isCommitted = true;
                    this.isActive = false;
                    log.debug('Transaction committed successfully', {
                        transactionId: this.transactionId
                    });
                    resolve();
                }
            });

            this.connection.execSql(request);
        });
    }

    /**
     * Rollback the transaction
     * @returns {Promise<void>}
     */
    rollback() {
        return new Promise((resolve, reject) => {
            if (!this.isActive) {
                // Already rolled back or committed, just resolve
                resolve();
                return;
            }

            if (this.isCommitted) {
                reject(new Error('Cannot rollback committed transaction'));
                return;
            }

            const request = new Request('ROLLBACK TRANSACTION', (err) => {
                if (err) {
                    log.error('Transaction rollback failed', {
                        error: err,
                        transactionId: this.transactionId
                    });
                    this.isActive = false;
                    reject(err);
                } else {
                    this.isRolledBack = true;
                    this.isActive = false;
                    log.debug('Transaction rolled back successfully', {
                        transactionId: this.transactionId
                    });
                    resolve();
                }
            });

            this.connection.execSql(request);
        });
    }

    /**
     * Execute a query within this transaction
     * @param {Request} request - Tedious request object
     * @returns {Promise}
     */
    executeRequest(request) {
        return new Promise((resolve, reject) => {
            if (!this.isActive) {
                reject(new Error('Transaction is not active'));
                return;
            }

            const rows = [];
            const columns = [];

            request.on('columnMetadata', (columnsMetadata) => {
                columnsMetadata.forEach(column => columns.push(column));
            });

            request.on('row', (rowColumns) => {
                const row = {};
                rowColumns.forEach((column, index) => {
                    row[columns[index].colName] = column.value;
                });
                rows.push(row);
            });

            request.on('requestCompleted', () => {
                resolve(rows);
            });

            request.on('error', (err) => {
                log.error('Query execution error in transaction', {
                    error: err,
                    transactionId: this.transactionId
                });
                reject(err);
            });

            this.connection.execSql(request);
        });
    }
}

export class TransactionManager {
    constructor(connectionPool) {
        this.connectionPool = connectionPool;
        this.transactionCounter = 0;
    }

    /**
     * Begin a new transaction
     * @param {string} isolationLevel - Transaction isolation level (default: READ_COMMITTED)
     * @returns {Promise<Transaction>}
     */
    async beginTransaction(isolationLevel = ISOLATION_LEVEL.READ_COMMITTED) {
        const connection = await this.connectionPool.getConnection();
        const transactionId = `txn_${Date.now()}_${++this.transactionCounter}`;

        return new Promise((resolve, reject) => {
            const isolationLevelMap = {
                [ISOLATION_LEVEL.READ_UNCOMMITTED]: 'READ UNCOMMITTED',
                [ISOLATION_LEVEL.READ_COMMITTED]: 'READ COMMITTED',
                [ISOLATION_LEVEL.REPEATABLE_READ]: 'REPEATABLE READ',
                [ISOLATION_LEVEL.SERIALIZABLE]: 'SERIALIZABLE',
                [ISOLATION_LEVEL.SNAPSHOT]: 'SNAPSHOT'
            };

            const isolationLevelStr = isolationLevelMap[isolationLevel] || 'READ COMMITTED';
            const sql = `SET TRANSACTION ISOLATION LEVEL ${isolationLevelStr}; BEGIN TRANSACTION`;

            const request = new Request(sql, (err) => {
                if (err) {
                    log.error('Failed to begin transaction', {
                        error: err,
                        transactionId,
                        isolationLevel: isolationLevelStr
                    });
                    this.connectionPool.releaseConnection(connection);
                    reject(err);
                } else {
                    log.debug('Transaction begun', {
                        transactionId,
                        isolationLevel: isolationLevelStr
                    });
                    const transaction = new Transaction(connection, transactionId);

                    // Wrap commit to release connection
                    const originalCommit = transaction.commit.bind(transaction);
                    transaction.commit = async () => {
                        try {
                            await originalCommit();
                        } finally {
                            this.connectionPool.releaseConnection(connection);
                        }
                    };

                    // Wrap rollback to release connection
                    const originalRollback = transaction.rollback.bind(transaction);
                    transaction.rollback = async () => {
                        try {
                            await originalRollback();
                        } finally {
                            this.connectionPool.releaseConnection(connection);
                        }
                    };

                    resolve(transaction);
                }
            });

            connection.execSql(request);
        });
    }

    /**
     * Execute a function within a transaction with automatic commit/rollback
     * @param {Function} callback - Async function that receives the transaction
     * @param {string} isolationLevel - Transaction isolation level
     * @returns {Promise} - Result from callback
     */
    async executeInTransaction(callback, isolationLevel = ISOLATION_LEVEL.READ_COMMITTED) {
        const transaction = await this.beginTransaction(isolationLevel);

        try {
            const result = await callback(transaction);
            await transaction.commit();
            return result;
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                log.error('Rollback failed after error', {
                    error: rollbackError,
                    originalError: error.message,
                    transactionId: transaction.transactionId
                });
            }
            throw error;
        }
    }
}

export default TransactionManager;
