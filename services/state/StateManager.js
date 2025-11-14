// services/state/StateManager.js
import { log } from '../../utils/logger.js';

/**
 * Thread-safe state manager with atomic operations
 */
class StateManager {
  constructor() {
    this.state = new Map();
    this.locks = new Map();
    this.operations = 0;
    this.maxRetries = 10;
    this.retryDelay = 10; // milliseconds
  }

  /**
   * Get a value from state
   * @param {string} key - State key
   * @returns {any} - State value
   */
  get(key) {
    return this.state.get(key);
  }

  /**
   * Set a value in state
   * @param {string} key - State key
   * @param {any} value - State value
   */
  set(key, value) {
    this.state.set(key, value);
  }

  /**
   * Check if a key exists in state
   * @param {string} key - State key
   * @returns {boolean} - Whether key exists
   */
  has(key) {
    return this.state.has(key);
  }

  /**
   * Delete a key from state
   * @param {string} key - State key
   * @returns {boolean} - Whether key was deleted
   */
  delete(key) {
    // Also clean up any locks for this key
    this.locks.delete(key);
    return this.state.delete(key);
  }

  /**
   * Clear all state
   */
  clear() {
    this.state.clear();
    this.locks.clear();
  }

  /**
   * Get all keys
   * @returns {string[]} - Array of all keys
   */
  keys() {
    return Array.from(this.state.keys());
  }

  /**
   * Get state size
   * @returns {number} - Number of state entries
   */
  size() {
    return this.state.size;
  }

  /**
   * Acquire a lock for a key
   * @param {string} key - Key to lock
   * @returns {Promise<void>}
   */
  async acquireLock(key) {
    let retries = 0;
    
    while (this.locks.has(key) && retries < this.maxRetries) {
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      retries++;
    }
    
    if (this.locks.has(key)) {
      throw new Error(`Failed to acquire lock for key: ${key} after ${this.maxRetries} retries`);
    }
    
    this.locks.set(key, {
      acquired: Date.now(),
      operationId: ++this.operations
    });
  }

  /**
   * Release a lock for a key
   * @param {string} key - Key to unlock
   */
  releaseLock(key) {
    this.locks.delete(key);
  }

  /**
   * Perform an atomic operation on state
   * @param {string} key - State key
   * @param {Function} operation - Operation function that receives current value and returns new value
   * @returns {Promise<any>} - New state value
   */
  async atomicOperation(key, operation) {
    await this.acquireLock(key);
    
    try {
      const currentValue = this.state.get(key);
      const newValue = await operation(currentValue);
      this.state.set(key, newValue);
      return newValue;
    } finally {
      this.releaseLock(key);
    }
  }

  /**
   * Perform multiple atomic operations
   * @param {Object} operations - Object with key-operation pairs
   * @returns {Promise<Object>} - Object with key-result pairs
   */
  async batchAtomicOperations(operations) {
    const keys = Object.keys(operations);
    const results = {};
    
    // Acquire all locks first (in sorted order to prevent deadlocks)
    const sortedKeys = keys.sort();
    for (const key of sortedKeys) {
      await this.acquireLock(key);
    }
    
    try {
      // Execute all operations
      for (const key of keys) {
        const currentValue = this.state.get(key);
        const newValue = await operations[key](currentValue);
        this.state.set(key, newValue);
        results[key] = newValue;
      }
      
      return results;
    } finally {
      // Release all locks
      for (const key of sortedKeys) {
        this.releaseLock(key);
      }
    }
  }

  /**
   * Get current lock status
   * @returns {Object} - Lock status information
   */
  getLockStatus() {
    const locks = {};
    for (const [key, lockInfo] of this.locks.entries()) {
      locks[key] = {
        ...lockInfo,
        duration: Date.now() - lockInfo.acquired
      };
    }
    
    return {
      activeLocks: this.locks.size,
      locks,
      totalOperations: this.operations
    };
  }

  /**
   * Clean up expired locks (safety mechanism)
   * @param {number} maxAge - Maximum age in milliseconds (default: 30 seconds)
   */
  cleanupExpiredLocks(maxAge = 30000) {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, lockInfo] of this.locks.entries()) {
      if (now - lockInfo.acquired > maxAge) {
        expiredKeys.push(key);
      }
    }
    
    if (expiredKeys.length > 0) {
      log.warn(`Cleaning up ${expiredKeys.length} expired locks:`, expiredKeys);
      expiredKeys.forEach(key => this.locks.delete(key));
    }
    
    return expiredKeys.length;
  }

  /**
   * Get state snapshot for debugging
   * @returns {Object} - Current state snapshot
   */
  getSnapshot() {
    const snapshot = {};
    for (const [key, value] of this.state.entries()) {
      try {
        // Handle circular references and non-serializable objects
        snapshot[key] = JSON.parse(JSON.stringify(value));
      } catch (error) {
        snapshot[key] = `[Non-serializable: ${typeof value}]`;
      }
    }
    
    return {
      state: snapshot,
      locks: this.getLockStatus(),
      timestamp: Date.now()
    };
  }

  /**
   * Validate state integrity
   * @returns {Object} - Validation results
   */
  validateState() {
    const issues = [];
    const stats = {
      totalKeys: this.state.size,
      totalLocks: this.locks.size,
      memoryUsage: 0
    };
    
    // Check for orphaned locks
    for (const key of this.locks.keys()) {
      if (!this.state.has(key)) {
        issues.push(`Orphaned lock for non-existent key: ${key}`);
      }
    }
    
    // Estimate memory usage
    try {
      const serialized = JSON.stringify(this.getSnapshot());
      stats.memoryUsage = Buffer.byteLength(serialized, 'utf8');
    } catch (error) {
      issues.push(`Cannot calculate memory usage: ${error.message}`);
    }
    
    return {
      valid: issues.length === 0,
      issues,
      stats
    };
  }

  /**
   * Backup current state
   * @returns {Object} - State backup
   */
  backup() {
    return {
      state: new Map(this.state),
      timestamp: Date.now(),
      operations: this.operations
    };
  }

  /**
   * Restore state from backup
   * @param {Object} backup - State backup
   */
  restore(backup) {
    if (!backup || !backup.state) {
      throw new Error('Invalid backup data');
    }
    
    // Clear current state and locks
    this.clear();
    
    // Restore state
    for (const [key, value] of backup.state.entries()) {
      this.state.set(key, value);
    }
    
    // Restore operation counter if available
    if (backup.operations) {
      this.operations = backup.operations;
    }

    log.info(`State restored from backup (${backup.timestamp}), ${this.state.size} keys restored`);
  }

  /**
   * Export state as JSON
   * @returns {string} - JSON representation of state
   */
  exportState() {
    const exportData = {
      state: Object.fromEntries(this.state),
      metadata: {
        timestamp: Date.now(),
        operations: this.operations,
        size: this.state.size
      }
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import state from JSON
   * @param {string} jsonData - JSON state data
   */
  importState(jsonData) {
    try {
      const importData = JSON.parse(jsonData);
      
      if (!importData.state) {
        throw new Error('Invalid state data format');
      }
      
      // Clear current state
      this.clear();
      
      // Import state
      for (const [key, value] of Object.entries(importData.state)) {
        this.state.set(key, value);
      }
      
      // Import metadata if available
      if (importData.metadata?.operations) {
        this.operations = importData.metadata.operations;
      }

      log.info(`State imported, ${this.state.size} keys loaded`);
    } catch (error) {
      throw new Error(`Failed to import state: ${error.message}`);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    log.info('Cleaning up StateManager...');

    // Log final statistics
    const validation = this.validateState();
    log.info('Final state validation:', validation);

    // Clear everything
    this.clear();

    log.info('StateManager cleanup completed');
  }

  /**
   * Get performance statistics
   * @returns {Object} - Performance stats
   */
  getStats() {
    const validation = this.validateState();
    
    return {
      stateSize: this.state.size,
      activeLocks: this.locks.size,
      totalOperations: this.operations,
      memoryUsage: validation.stats.memoryUsage,
      isHealthy: validation.valid,
      issues: validation.issues
    };
  }
}

// ===== FIXED: Export StateManager class first, then create singleton =====
// Export the StateManager class for direct use
export { StateManager };

// Create and export singleton instance
const stateManagerInstance = new StateManager();

// ===== FIXED: Set up cleanup interval after instance creation =====
// Set up periodic cleanup of expired locks
setInterval(() => {
  stateManagerInstance.cleanupExpiredLocks();
}, 60000); // Every minute

// Export singleton as default
export default stateManagerInstance;