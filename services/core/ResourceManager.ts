// services/core/ResourceManager.ts
/**
 * Resource manager for proper cleanup and disposal
 */

import { log } from '../../utils/logger.js';

type CleanupFn<T> = (resource: T) => Promise<void> | void;

interface RegisteredResource<T = unknown> {
  resource: T;
  cleanup: CleanupFn<T>;
  registered: number;
}

interface ResourceStats {
  resourceCount: number;
  cleanupTaskCount: number;
  isShuttingDown: boolean;
  resources: string[];
}

// Process-wide signal/uncaught handlers live in index.ts. ResourceManager
// only owns its registered resources — it runs cleanups when index.ts calls
// gracefulShutdown(), and does NOT call process.exit itself.
class ResourceManager {
  private resources: Map<string, RegisteredResource> = new Map();
  private cleanupTasks: Set<() => Promise<void> | void> = new Set();
  private _isShuttingDown = false;

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /**
   * Register a resource for cleanup
   */
  register<T>(name: string, resource: T, cleanupFn: CleanupFn<T>): void {
    if (this._isShuttingDown) {
      log.warn('Cannot register resource during shutdown', { name });
      return;
    }

    this.resources.set(name, {
      resource,
      cleanup: cleanupFn as CleanupFn<unknown>,
      registered: Date.now(),
    });

    log.info('Resource registered', { name });
  }

  /**
   * Unregister a resource
   */
  unregister(name: string): RegisteredResource | null {
    const resource = this.resources.get(name);
    if (resource) {
      this.resources.delete(name);
      log.info('Resource unregistered', { name });
      return resource;
    }
    return null;
  }

  /**
   * Add a cleanup task
   */
  addCleanupTask(task: () => Promise<void> | void): void {
    this.cleanupTasks.add(task);
  }

  /**
   * Run cleanup tasks and tear down registered resources. Caller (index.ts
   * gracefulShutdown) is responsible for the final process.exit.
   */
  async gracefulShutdown(signal: string): Promise<void> {
    if (this._isShuttingDown) {
      log.info('ResourceManager shutdown already in progress...');
      return;
    }

    this._isShuttingDown = true;
    log.info('ResourceManager cleanup initiated', { signal });

    // Execute cleanup tasks first
    log.info('Executing cleanup tasks', { count: this.cleanupTasks.size });
    const cleanupPromises = Array.from(this.cleanupTasks).map(async (task) => {
      try {
        await task();
      } catch (error) {
        log.error('Error in cleanup task', { error: (error as Error).message });
      }
    });

    await Promise.allSettled(cleanupPromises);

    // Clean up registered resources
    log.info('Cleaning up registered resources', { count: this.resources.size });
    const resourcePromises = Array.from(this.resources.entries()).map(
      async ([name, { resource, cleanup }]) => {
        try {
          log.info('Cleaning up resource', { name });
          await cleanup(resource);
        } catch (error) {
          log.error('Error cleaning up resource', { name, error: (error as Error).message });
        }
      }
    );

    await Promise.allSettled(resourcePromises);

    log.info('ResourceManager cleanup completed');
  }

  /**
   * Get resource statistics
   */
  getStats(): ResourceStats {
    return {
      resourceCount: this.resources.size,
      cleanupTaskCount: this.cleanupTasks.size,
      isShuttingDown: this._isShuttingDown,
      resources: Array.from(this.resources.keys()),
    };
  }
}

export default new ResourceManager();
