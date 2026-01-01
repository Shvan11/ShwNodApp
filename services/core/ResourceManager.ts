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

class ResourceManager {
  private resources: Map<string, RegisteredResource> = new Map();
  private cleanupTasks: Set<() => Promise<void> | void> = new Set();
  private _isShuttingDown = false;

  constructor() {
    this.setupProcessHandlers();
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  private setupProcessHandlers(): void {
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('uncaughtException', (error: Error) => {
      log.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.gracefulShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      log.error('Unhandled rejection', { reason: String(reason) });
    });
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
   * Perform graceful shutdown
   */
  async gracefulShutdown(signal: string): Promise<void> {
    if (this._isShuttingDown) {
      log.info('Shutdown already in progress...');
      return;
    }

    this._isShuttingDown = true;
    log.info('Graceful shutdown initiated', { signal });

    try {
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

      log.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      log.error('Error during graceful shutdown', { error: (error as Error).message });
      process.exit(1);
    }
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
