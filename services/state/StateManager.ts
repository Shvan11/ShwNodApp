// services/state/StateManager.ts
import { log } from '../../utils/logger.js';

/**
 * Lock information interface
 */
interface LockInfo {
  acquired: number;
  operationId: number;
}

/**
 * Lock status interface
 */
interface LockStatus {
  activeLocks: number;
  locks: Record<string, LockInfo & { duration: number }>;
  totalOperations: number;
}

/**
 * State snapshot interface
 */
interface StateSnapshot {
  state: Record<string, unknown>;
  locks: LockStatus;
  timestamp: number;
}

/**
 * State validation interface
 */
interface StateValidation {
  valid: boolean;
  issues: string[];
  stats: {
    totalKeys: number;
    totalLocks: number;
    memoryUsage: number;
    [key: string]: number;
  };
  [key: string]: boolean | string[] | StateValidation['stats'];
}

/**
 * State backup interface
 */
interface StateBackup {
  state: Map<string, unknown>;
  timestamp: number;
  operations: number;
}

/**
 * State export interface
 */
interface StateExport {
  state: Record<string, unknown>;
  metadata: {
    timestamp: number;
    operations: number;
    size: number;
  };
}

/**
 * State manager stats interface
 */
interface StateStats {
  stateSize: number;
  activeLocks: number;
  totalOperations: number;
  memoryUsage: number;
  isHealthy: boolean;
  issues: string[];
}

/**
 * Thread-safe state manager with atomic operations
 */
export class StateManager {
  private state: Map<string, unknown> = new Map();
  private locks: Map<string, LockInfo> = new Map();
  private operations = 0;
  private maxRetries = 10;
  private retryDelay = 10; // milliseconds

  /**
   * Get a value from state
   */
  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  /**
   * Set a value in state
   */
  set<T>(key: string, value: T): void {
    this.state.set(key, value);
  }

  /**
   * Check if a key exists in state
   */
  has(key: string): boolean {
    return this.state.has(key);
  }

  /**
   * Delete a key from state
   */
  delete(key: string): boolean {
    // Also clean up any locks for this key
    this.locks.delete(key);
    return this.state.delete(key);
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state.clear();
    this.locks.clear();
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.state.keys());
  }

  /**
   * Get state size
   */
  size(): number {
    return this.state.size;
  }

  /**
   * Acquire a lock for a key
   */
  async acquireLock(key: string): Promise<void> {
    let retries = 0;

    while (this.locks.has(key) && retries < this.maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      retries++;
    }

    if (this.locks.has(key)) {
      throw new Error(`Failed to acquire lock for key: ${key} after ${this.maxRetries} retries`);
    }

    this.locks.set(key, {
      acquired: Date.now(),
      operationId: ++this.operations,
    });
  }

  /**
   * Release a lock for a key
   */
  releaseLock(key: string): void {
    this.locks.delete(key);
  }

  /**
   * Perform an atomic operation on state
   */
  async atomicOperation<T>(
    key: string,
    operation: (currentValue: T | undefined) => T | Promise<T>
  ): Promise<T> {
    await this.acquireLock(key);

    try {
      const currentValue = this.state.get(key) as T | undefined;
      const newValue = await operation(currentValue);
      this.state.set(key, newValue);
      return newValue;
    } finally {
      this.releaseLock(key);
    }
  }

  /**
   * Perform multiple atomic operations
   */
  async batchAtomicOperations<T extends Record<string, unknown>>(
    operations: Record<keyof T, (currentValue: unknown) => unknown | Promise<unknown>>
  ): Promise<T> {
    const keys = Object.keys(operations) as Array<keyof T>;
    const results = {} as T;

    // Acquire all locks first (in sorted order to prevent deadlocks)
    const sortedKeys = [...keys].sort() as Array<keyof T>;
    for (const key of sortedKeys) {
      await this.acquireLock(key as string);
    }

    try {
      // Execute all operations
      for (const key of keys) {
        const currentValue = this.state.get(key as string);
        const newValue = await operations[key](currentValue);
        this.state.set(key as string, newValue);
        results[key] = newValue as T[keyof T];
      }

      return results;
    } finally {
      // Release all locks
      for (const key of sortedKeys) {
        this.releaseLock(key as string);
      }
    }
  }

  /**
   * Get current lock status
   */
  getLockStatus(): LockStatus {
    const locks: Record<string, LockInfo & { duration: number }> = {};
    for (const [key, lockInfo] of this.locks.entries()) {
      locks[key] = {
        ...lockInfo,
        duration: Date.now() - lockInfo.acquired,
      };
    }

    return {
      activeLocks: this.locks.size,
      locks,
      totalOperations: this.operations,
    };
  }

  /**
   * Clean up expired locks (safety mechanism)
   */
  cleanupExpiredLocks(maxAge = 30000): number {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, lockInfo] of this.locks.entries()) {
      if (now - lockInfo.acquired > maxAge) {
        expiredKeys.push(key);
      }
    }

    if (expiredKeys.length > 0) {
      log.warn(`Cleaning up ${expiredKeys.length} expired locks:`, expiredKeys);
      expiredKeys.forEach((key) => this.locks.delete(key));
    }

    return expiredKeys.length;
  }

  /**
   * Get state snapshot for debugging
   */
  getSnapshot(): StateSnapshot {
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of this.state.entries()) {
      try {
        // Handle circular references and non-serializable objects
        snapshot[key] = JSON.parse(JSON.stringify(value));
      } catch {
        snapshot[key] = `[Non-serializable: ${typeof value}]`;
      }
    }

    return {
      state: snapshot,
      locks: this.getLockStatus(),
      timestamp: Date.now(),
    };
  }

  /**
   * Validate state integrity
   */
  validateState(): StateValidation {
    const issues: string[] = [];
    const stats = {
      totalKeys: this.state.size,
      totalLocks: this.locks.size,
      memoryUsage: 0,
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
      issues.push(`Cannot calculate memory usage: ${(error as Error).message}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      stats,
    };
  }

  /**
   * Backup current state
   */
  backup(): StateBackup {
    return {
      state: new Map(this.state),
      timestamp: Date.now(),
      operations: this.operations,
    };
  }

  /**
   * Restore state from backup
   */
  restore(backup: StateBackup): void {
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
   */
  exportState(): string {
    const exportData: StateExport = {
      state: Object.fromEntries(this.state),
      metadata: {
        timestamp: Date.now(),
        operations: this.operations,
        size: this.state.size,
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import state from JSON
   */
  importState(jsonData: string): void {
    try {
      const importData = JSON.parse(jsonData) as StateExport;

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
      throw new Error(`Failed to import state: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
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
   */
  getStats(): StateStats {
    const validation = this.validateState();

    return {
      stateSize: this.state.size,
      activeLocks: this.locks.size,
      totalOperations: this.operations,
      memoryUsage: validation.stats.memoryUsage,
      isHealthy: validation.valid,
      issues: validation.issues,
    };
  }
}

// Create and export singleton instance
const stateManagerInstance = new StateManager();

// Set up periodic cleanup of expired locks
setInterval(() => {
  stateManagerInstance.cleanupExpiredLocks();
}, 60000); // Every minute

// Export singleton as default
export default stateManagerInstance;
