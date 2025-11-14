// services/monitoring/HealthCheck.js
import EventEmitter from 'events';
import ResourceManager from '../core/ResourceManager.js';
import ConnectionPool from '../database/ConnectionPool.js';
import messageState from '../state/messageState.js';
import { log } from '../../utils/logger.js';

/**
 * Health check system for monitoring system components
 */
class HealthCheckService extends EventEmitter {
  constructor() {
    super();
    this.checks = new Map();
    this.intervals = new Map();
    this.lastResults = new Map();
    this.isRunning = false;

    // Register with resource manager
    ResourceManager.register('health-check', this, this.stop.bind(this));

    this.setupDefaultChecks();
  }

  setupDefaultChecks() {
    // Database health check
    this.registerCheck('database', async () => {
      const stats = ConnectionPool.getStats();
      const healthy = stats.totalConnections > 0 && !stats.isShuttingDown;
      
      return {
        healthy,
        details: stats,
        message: healthy ? 'Database pool is healthy' : 'Database pool is unhealthy'
      };
    }, 30000); // Check every 30 seconds

    // WhatsApp client health check
    this.registerCheck('whatsapp', async () => {
      const clientReady = messageState.clientReady;
      const activeViewers = messageState.activeQRViewers;
      const stateDump = messageState.dump();
      
      // Consider healthy if:
      // 1. Client is ready, OR
      // 2. No active viewers (client doesn't need to be ready)
      const healthy = clientReady || activeViewers === 0;
      
      let message;
      if (clientReady) {
        message = 'WhatsApp client is ready';
      } else if (activeViewers === 0) {
        message = 'WhatsApp client idle (no viewers)';
      } else {
        message = 'WhatsApp client is not ready but has viewers';
      }
      
      return {
        healthy,
        details: {
          clientReady,
          activeQRViewers: activeViewers,
          lastActivity: stateDump.lastActivity,
          inactiveFor: Date.now() - stateDump.lastActivity,
          status: clientReady ? 'ready' : (activeViewers === 0 ? 'idle' : 'initializing')
        },
        message
      };
    }, 15000); // Check every 15 seconds

    // Memory health check
    this.registerCheck('memory', async () => {
      const usage = process.memoryUsage();
      const totalMB = Math.round(usage.rss / 1024 / 1024);
      const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
      const healthy = totalMB < 1000; // Alert if using more than 1GB
      
      return {
        healthy,
        details: {
          totalMB,
          heapMB,
          external: Math.round(usage.external / 1024 / 1024)
        },
        message: healthy ? `Memory usage is normal (${totalMB}MB)` : `High memory usage (${totalMB}MB)`
      };
    }, 60000); // Check every minute

    // System uptime check
    this.registerCheck('system', async () => {
      const uptime = process.uptime();
      const uptimeHours = Math.floor(uptime / 3600);
      const healthy = uptime > 0; // Always healthy if process is running
      
      return {
        healthy,
        details: {
          uptimeSeconds: uptime,
          uptimeHours,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid
        },
        message: `System running for ${uptimeHours} hours`
      };
    }, 300000); // Check every 5 minutes
  }

  /**
   * Register a health check
   */
  registerCheck(name, checkFn, interval = 30000) {
    this.checks.set(name, checkFn);
    
    if (this.isRunning) {
      this.startCheck(name, interval);
    }
    
    log.info(`Health check registered: ${name} (interval: ${interval}ms)`);
  }

  /**
   * Start a specific health check
   */
  startCheck(name, interval) {
    const checkFn = this.checks.get(name);
    if (!checkFn) return;

    // Clear existing interval
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
    }

    // Run initial check
    this.runCheck(name);

    // Set up interval
    const intervalId = setInterval(() => {
      this.runCheck(name);
    }, interval);

    this.intervals.set(name, intervalId);
  }

  /**
   * Run a specific health check
   */
  async runCheck(name) {
    const checkFn = this.checks.get(name);
    if (!checkFn) return;

    try {
      const result = await checkFn();
      const checkResult = {
        name,
        ...result,
        timestamp: Date.now()
      };

      this.lastResults.set(name, checkResult);

      // Emit events
      this.emit('check-completed', checkResult);
      
      if (!result.healthy) {
        this.emit('check-failed', checkResult);
        log.warn(`Health check failed: ${name} - ${result.message}`);
      }

    } catch (error) {
      const errorResult = {
        name,
        healthy: false,
        error: error.message,
        timestamp: Date.now(),
        message: `Health check error: ${error.message}`
      };

      this.lastResults.set(name, errorResult);
      this.emit('check-error', errorResult);
      log.error(`Health check error for ${name}:`, error);
    }
  }

  /**
   * Start all health checks
   */
  start() {
    if (this.isRunning) {
      log.info('Health checks already running');
      return;
    }

    log.info('Starting health check service');
    this.isRunning = true;

    // Start all registered checks with their default intervals
    const defaultIntervals = {
      database: 30000,
      whatsapp: 15000,
      memory: 60000,
      system: 300000
    };

    for (const [name] of this.checks) {
      const interval = defaultIntervals[name] || 30000;
      this.startCheck(name, interval);
    }

    this.emit('started');
  }

  /**
   * Stop all health checks
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping health check service');
    this.isRunning = false;

    // Clear all intervals
    for (const [name, intervalId] of this.intervals) {
      clearInterval(intervalId);
    }
    this.intervals.clear();

    this.emit('stopped');
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const results = Array.from(this.lastResults.values());
    const overall = results.length > 0 ? results.every(r => r.healthy) : false;

    return {
      overall,
      timestamp: Date.now(),
      checks: results,
      summary: {
        total: results.length,
        healthy: results.filter(r => r.healthy).length,
        unhealthy: results.filter(r => !r.healthy).length
      }
    };
  }

  /**
   * Get detailed health report
   */
  getDetailedReport() {
    const status = this.getHealthStatus();
    
    return {
      ...status,
      systemInfo: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
      },
      resourceStats: ResourceManager.getStats(),
      databaseStats: ConnectionPool.getStats()
    };
  }

  /**
   * Get health check statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      totalChecks: this.checks.size,
      activeIntervals: this.intervals.size,
      lastResults: this.lastResults.size
    };
  }

  /**
   * Remove a health check
   */
  removeCheck(name) {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
      this.intervals.delete(name);
    }
    
    this.checks.delete(name);
    this.lastResults.delete(name);

    log.info(`Health check removed: ${name}`);
  }

  /**
   * Update check interval
   */
  updateCheckInterval(name, newInterval) {
    if (!this.checks.has(name)) {
      log.warn(`Health check ${name} not found`);
      return;
    }

    if (this.isRunning) {
      this.startCheck(name, newInterval);
      log.info(`Health check interval updated: ${name} -> ${newInterval}ms`);
    }
  }
}

export default new HealthCheckService();