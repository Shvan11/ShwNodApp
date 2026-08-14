// services/messaging/StateManager.ts
import { log } from '../../utils/logger.js';

/**
 * Lock information interface
 */
interface LockInfo {
  acquired: number;
  operationId: number;
}

/**
 * A queued lock acquirer, resolved by releaseLock via direct hand-off. Resolves
 * with the fencing token minted for the hand-off (see acquireLock).
 */
interface LockWaiter {
  resolve: (token: number) => void;
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
 * Thread-safe state manager with atomic operations
 */
class StateManager {
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
   * Clear all state. Locks are dropped wholesale and queued acquirers rejected;
   * any still-running holder's eventual release is a no-op (its fencing token no
   * longer matches anything), so it cannot evict a lock taken after the clear.
   */
  clear(): void {
    this.state.clear();
    this.locks.clear();
    for (const key of [...this.lockWaiters.keys()]) {
      this.rejectWaiters(key, 'State cleared');
    }
  }

  /**
   * Acquire a lock for a key. Returns a **fencing token** identifying this
   * particular grant; it must be passed back to releaseLock, which ignores any
   * release that doesn't match the current holder. Without that check a holder
   * whose lock was taken away (by the reaper, or by clear()) would, on finishing,
   * release whoever holds it *now* — desynchronizing ownership for that key from
   * then on. Always release via try/finally.
   */
  async acquireLock(key: string): Promise<number> {
    // Fast path: the lock is free. has→set has no await between it, so it's an
    // atomic critical section on the single-threaded event loop — no double-grant.
    if (!this.locks.has(key)) {
      const token = ++this.operations;
      this.locks.set(key, { acquired: Date.now(), operationId: token });
      return token;
    }

    // Contended: join the FIFO queue and wait for releaseLock to hand off to us.
    // The lock entry is transferred to us *by releaseLock* (it stays held the
    // whole time), so we must NOT set it ourselves on resume — that's what keeps
    // a newcomer from stealing the lock in the gap before this promise resolves.
    // releaseLock mints our token as part of the hand-off and resolves us with it.
    const waiters = this.lockWaiters.get(key) ?? [];
    this.lockWaiters.set(key, waiters);
    log.debug(`Lock contended for key '${key}' — queued (depth ${waiters.length + 1})`);

    return await new Promise<number>((resolve, reject) => {
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
   * Release a lock for a key, identified by the token acquireLock returned. A
   * token that doesn't match the current holder is a stale release (the lock was
   * revoked under this caller) and is ignored — never blindly freed, or the
   * caller would evict the rightful holder.
   *
   * If acquirers are queued, hand the lock directly to the next one (the entry
   * stays held, re-stamped with a fresh token) rather than freeing it — this
   * prevents a newcomer from jumping the queue between release and resume.
   */
  releaseLock(key: string, token: number): void {
    const held = this.locks.get(key);
    if (!held) {
      // Lock already gone (clear() wiped it). Any waiters were rejected there.
      return;
    }
    if (held.operationId !== token) {
      log.warn(
        `Ignoring stale lock release for key '${key}' (token ${token}, current holder ${held.operationId}) — the lock was revoked under its holder`
      );
      return;
    }

    const waiters = this.lockWaiters.get(key);
    if (waiters && waiters.length > 0) {
      const next = waiters.shift()!;
      if (waiters.length === 0) this.lockWaiters.delete(key);
      clearTimeout(next.timer);
      const nextToken = ++this.operations;
      this.locks.set(key, { acquired: Date.now(), operationId: nextToken });
      next.resolve(nextToken);
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
    const token = await this.acquireLock(key);

    try {
      const currentValue = this.state.get(key) as T | undefined;
      const newValue = await operation(currentValue);
      this.state.set(key, newValue);
      return newValue;
    } finally {
      this.releaseLock(key, token);
    }
  }

  /**
   * Report locks held longer than maxAge. Diagnostic only — it deliberately does
   * NOT force-release them.
   *
   * A lock can only be held across a timer tick if some `operation` passed to
   * atomicOperation awaits something slow; force-releasing it would admit a second
   * body into the critical section the lock exists to protect, which is strictly
   * worse than the stall. The stall itself is already surfaced to callers: each
   * queued acquirer rejects after lockWaitTimeout with the offending key. This
   * adds the holder-side half of that signal (which key, how long, how many are
   * queued behind it) so the underlying hung operation can be found and fixed.
   */
  reportStuckLocks(maxAge = 30000): number {
    const now = Date.now();
    const stuck: string[] = [];

    for (const [key, lockInfo] of this.locks.entries()) {
      const heldMs = now - lockInfo.acquired;
      if (heldMs > maxAge) {
        stuck.push(`${key} (held ${heldMs}ms, ${this.lockWaiters.get(key)?.length ?? 0} queued)`);
      }
    }

    if (stuck.length > 0) {
      log.warn(
        `${stuck.length} state lock(s) held longer than ${maxAge}ms — a slow/hung atomicOperation callback is blocking them:`,
        stuck
      );
    }

    return stuck.length;
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
}

// Create and export singleton instance
const stateManagerInstance = new StateManager();

// Periodically report (never force-release) locks stuck under a slow holder.
// unref() so this module-scoped timer doesn't hold the event loop open and block
// a clean process exit.
const stuckLockTimer = setInterval(() => {
  stateManagerInstance.reportStuckLocks();
}, 60000); // Every minute
stuckLockTimer.unref();

// Export singleton as default
export default stateManagerInstance;
