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
 * A queued lock acquirer, resolved by releaseLock via direct hand-off.
 */
interface LockWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
  // FIFO queue of acquirers blocked on a held key. Drained by releaseLock.
  private lockWaiters: Map<string, LockWaiter[]> = new Map();
  private operations = 0;
  // Safety valve: a contended acquirer waits this long before rejecting, so a
  // never-released lock (a bug) surfaces as an error instead of a permanent hang.
  // Generous vs. the sub-ms critical sections this guards, so normal contention
  // never trips it.
  private lockWaitTimeout = 30_000; // milliseconds

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
    this.rejectWaiters(key, `State key '${key}' deleted`);
    return this.state.delete(key);
  }

  /**
   * Reject and clear any queued lock acquirers for a key (used when the key/state
   * goes away under them, so they fail fast instead of hanging until timeout).
   */
  private rejectWaiters(key: string, reason: string): void {
    const waiters = this.lockWaiters.get(key);
    if (!waiters) return;
    this.lockWaiters.delete(key);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(reason));
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state.clear();
    this.locks.clear();
    for (const key of [...this.lockWaiters.keys()]) {
      this.rejectWaiters(key, 'State cleared');
    }
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
    // Fast path: the lock is free. has→set has no await between it, so it's an
    // atomic critical section on the single-threaded event loop — no double-grant.
    if (!this.locks.has(key)) {
      this.locks.set(key, { acquired: Date.now(), operationId: ++this.operations });
      return;
    }

    // Contended: join the FIFO queue and wait for releaseLock to hand off to us.
    // The lock entry is transferred to us *by releaseLock* (it stays held the
    // whole time), so we must NOT set it ourselves on resume — that's what keeps
    // a newcomer from stealing the lock in the gap before this promise resolves.
    const waiters = this.lockWaiters.get(key) ?? [];
    this.lockWaiters.set(key, waiters);
    log.debug(`Lock contended for key '${key}' — queued (depth ${waiters.length + 1})`);

    await new Promise<void>((resolve, reject) => {
      const waiter: LockWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const queue = this.lockWaiters.get(key);
          if (queue) {
            const i = queue.indexOf(waiter);
            if (i >= 0) queue.splice(i, 1);
            if (queue.length === 0) this.lockWaiters.delete(key);
          }
          reject(new Error(`Failed to acquire lock for key: ${key} after ${this.lockWaitTimeout}ms`));
        }, this.lockWaitTimeout),
      };
      waiters.push(waiter);
    });
  }

  /**
   * Release a lock for a key. If acquirers are queued, hand the lock directly to
   * the next one (the entry stays held, re-stamped) rather than freeing it — this
   * prevents a newcomer from jumping the queue between release and resume.
   */
  releaseLock(key: string): void {
    const waiters = this.lockWaiters.get(key);
    if (waiters && waiters.length > 0) {
      const next = waiters.shift()!;
      if (waiters.length === 0) this.lockWaiters.delete(key);
      clearTimeout(next.timer);
      this.locks.set(key, { acquired: Date.now(), operationId: ++this.operations });
      next.resolve();
    } else {
      this.locks.delete(key);
    }
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
      // Force-release rather than raw-delete so any queued acquirers receive the
      // lock (hand-off) and the queue keeps draining past a stuck holder.
      expiredKeys.forEach((key) => this.releaseLock(key));
    }

    return expiredKeys.length;
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

    // Estimate memory usage with a single serialization pass over the raw state,
    // rather than JSON.stringify(getSnapshot()) which deep-clones every value via
    // JSON.parse(JSON.stringify(...)) and then re-serializes the whole snapshot.
    try {
      let bytes = 0;
      for (const [key, value] of this.state.entries()) {
        bytes += Buffer.byteLength(key, 'utf8');
        try {
          bytes += Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
        } catch {
          // Circular / non-serializable value — skip its contribution.
        }
      }
      stats.memoryUsage = bytes;
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

// Set up periodic cleanup of expired locks. unref() so this module-scoped
// timer doesn't hold the event loop open and block a clean process exit.
const lockCleanupTimer = setInterval(() => {
  stateManagerInstance.cleanupExpiredLocks();
}, 60000); // Every minute
lockCleanupTimer.unref();

// Export singleton as default
export default stateManagerInstance;
