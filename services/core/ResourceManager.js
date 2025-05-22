// services/core/ResourceManager.js
/**
 * Resource manager for proper cleanup and disposal
 */
class ResourceManager {
    constructor() {
      this.resources = new Map();
      this.cleanupTasks = new Set();
      this.isShuttingDown = false;
      this.setupProcessHandlers();
    }
  
    setupProcessHandlers() {
      // Handle process termination
      process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
      process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
        this.gracefulShutdown('uncaughtException');
      });
      process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled rejection at:', promise, 'reason:', reason);
      });
    }
  
    /**
     * Register a resource for cleanup
     */
    register(name, resource, cleanupFn) {
      if (this.isShuttingDown) {
        console.warn(`Cannot register resource ${name} during shutdown`);
        return;
      }
  
      this.resources.set(name, {
        resource,
        cleanup: cleanupFn,
        registered: Date.now()
      });
  
      console.log(`Resource registered: ${name}`);
    }
  
    /**
     * Unregister a resource
     */
    unregister(name) {
      const resource = this.resources.get(name);
      if (resource) {
        this.resources.delete(name);
        console.log(`Resource unregistered: ${name}`);
        return resource;
      }
      return null;
    }
  
    /**
     * Add a cleanup task
     */
    addCleanupTask(task) {
      this.cleanupTasks.add(task);
    }
  
    /**
     * Perform graceful shutdown
     */
    async gracefulShutdown(signal) {
      if (this.isShuttingDown) {
        console.log('Shutdown already in progress...');
        return;
      }
  
      this.isShuttingDown = true;
      console.log(`Graceful shutdown initiated by ${signal}`);
  
      try {
        // Execute cleanup tasks first
        console.log(`Executing ${this.cleanupTasks.size} cleanup tasks`);
        const cleanupPromises = Array.from(this.cleanupTasks).map(async (task) => {
          try {
            await task();
          } catch (error) {
            console.error('Error in cleanup task:', error);
          }
        });
  
        await Promise.allSettled(cleanupPromises);
  
        // Clean up registered resources
        console.log(`Cleaning up ${this.resources.size} registered resources`);
        const resourcePromises = Array.from(this.resources.entries()).map(async ([name, { resource, cleanup }]) => {
          try {
            console.log(`Cleaning up resource: ${name}`);
            await cleanup(resource);
          } catch (error) {
            console.error(`Error cleaning up resource ${name}:`, error);
          }
        });
  
        await Promise.allSettled(resourcePromises);
  
        console.log('Graceful shutdown completed');
        process.exit(0);
  
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    }
  
    /**
     * Get resource statistics
     */
    getStats() {
      return {
        resourceCount: this.resources.size,
        cleanupTaskCount: this.cleanupTasks.size,
        isShuttingDown: this.isShuttingDown,
        resources: Array.from(this.resources.keys())
      };
    }
  }
  
  export default new ResourceManager();