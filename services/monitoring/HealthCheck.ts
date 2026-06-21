// services/monitoring/HealthCheck.ts
import EventEmitter from 'events';
import ResourceManager from '../core/ResourceManager.js';
import { getDatabaseStats } from '../database/index.js';
import messageState from '../state/messageState.js';
import whatsapp from '../messaging/whatsapp.js';
import { log } from '../../utils/logger.js';

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  name: string;
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

/**
 * Health check function type
 */
type HealthCheckFn = () => Promise<{
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}>;

/**
 * Health status interface
 */
export interface HealthStatus {
  overall: boolean;
  timestamp: number;
  checks: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
  };
}

/**
 * Detailed health report interface
 */
export interface DetailedHealthReport extends HealthStatus {
  systemInfo: {
    uptime: number;
    nodeVersion: string;
    platform: NodeJS.Platform;
    pid: number;
  };
  resourceStats: {
    resourceCount: number;
    cleanupTaskCount: number;
    isShuttingDown: boolean;
    resources: string[];
  };
  databaseStats: Record<string, unknown>;
}

/**
 * Health check service stats interface
 */
export interface HealthCheckStats {
  isRunning: boolean;
  totalChecks: number;
  activeIntervals: number;
  lastResults: number;
}

/**
 * Health check system for monitoring system components
 */
class HealthCheckService extends EventEmitter {
  private checks: Map<string, HealthCheckFn> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private isRunning = false;

  constructor() {
    super();

    // Register with resource manager
    ResourceManager.register('health-check', this, () => this.stop());

    this.setupDefaultChecks();
  }

  private setupDefaultChecks(): void {
    // Database health check
    this.registerCheck(
      'database',
      async () => {
        const stats = getDatabaseStats().connectionPool;
        const healthy = !stats.isShuttingDown;

        return {
          healthy,
          details: stats as unknown as Record<string, unknown>,
          message: healthy ? 'Database pool is healthy' : 'Database pool is unhealthy',
        };
      },
      30000
    ); // Check every 30 seconds

    // WhatsApp client health check.
    //
    // A fresh start is SLOW by design: the client can spend up to ~2 min
    // restoring a LocalAuth session (or sitting on a QR) before `ready`. That
    // preparing window is normal, not a failure — warning every 15s through it
    // (which floods the logs after every restart, because the app-wide SSE keeps
    // activeViewers > 0) just cries wolf. So this check stays HEALTHY and quiet
    // while the client is actively initializing OR still inside a startup grace
    // window, and only reports unhealthy once it's been not-ready with viewers
    // watching for longer than that — i.e. genuinely stuck or errored.
    const WHATSAPP_READY_GRACE_MS = 180000; // 3 min: covers SESSION_RESTORATION_TIMEOUT (120s) + buffer
    let whatsappNotReadySince: number | null = null;

    this.registerCheck(
      'whatsapp',
      async () => {
        const clientReady = messageState.clientReady;
        const activeViewers = messageState.activeQRViewers;
        const stateDump = messageState.dump();
        // WHATSAPP_AUTO_INIT=false intentionally leaves the client off until a
        // manual start; the app-wide SSE keeps activeViewers > 0 for every
        // logged-in user, so this off state must not warn.
        const autoInitDisabled = process.env.WHATSAPP_AUTO_INIT === 'false';

        const svcStatus = whatsapp.getStatus() as { state?: string; initializing?: boolean };
        const clientState = svcStatus.state ?? 'UNKNOWN';
        // Actively spinning up / restoring session / waiting on a scan — expected,
        // time-bounded, and self-healing (the ready-watchdog covers a stuck scan).
        const initializing = clientState === 'INITIALIZING' || svcStatus.initializing === true;

        // "Not ready" stopwatch — runs only while we'd otherwise care (viewers
        // present, auto-init on, client not ready); reset the moment that clears.
        const settled = clientReady || activeViewers === 0 || autoInitDisabled;
        if (settled) {
          whatsappNotReadySince = null;
        } else if (whatsappNotReadySince === null) {
          whatsappNotReadySince = Date.now();
        }
        const notReadyForMs = whatsappNotReadySince === null ? 0 : Date.now() - whatsappNotReadySince;
        const withinGrace = notReadyForMs < WHATSAPP_READY_GRACE_MS;

        // Healthy (no alarm) when ready, idle, disabled, still preparing, or
        // inside the grace window. Only a prolonged not-ready-with-viewers warns.
        const healthy = settled || initializing || withinGrace;

        let status: string;
        let message: string;
        if (clientReady) {
          status = 'ready';
          message = 'WhatsApp client is ready';
        } else if (autoInitDisabled) {
          status = 'disabled';
          message = 'WhatsApp client not started (WHATSAPP_AUTO_INIT=false — manual start)';
        } else if (activeViewers === 0) {
          status = 'idle';
          message = 'WhatsApp client idle (no viewers)';
        } else if (initializing || withinGrace) {
          status = 'initializing';
          message = `WhatsApp client is preparing (${clientState.toLowerCase()}, ${Math.round(notReadyForMs / 1000)}s)`;
        } else {
          status = 'stuck';
          message = `WhatsApp client not ready after ${Math.round(notReadyForMs / 1000)}s (state: ${clientState})`;
        }

        return {
          healthy,
          details: {
            clientReady,
            activeQRViewers: activeViewers,
            clientState,
            notReadyForMs,
            lastActivity: stateDump.lastActivity,
            inactiveFor: Date.now() - stateDump.lastActivity,
            status,
          },
          message,
        };
      },
      15000
    ); // Check every 15 seconds

    // Memory health check
    this.registerCheck(
      'memory',
      async () => {
        const usage = process.memoryUsage();
        const totalMB = Math.round(usage.rss / 1024 / 1024);
        const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
        const healthy = totalMB < 1000; // Alert if using more than 1GB

        return {
          healthy,
          details: {
            totalMB,
            heapMB,
            external: Math.round(usage.external / 1024 / 1024),
          },
          message: healthy
            ? `Memory usage is normal (${totalMB}MB)`
            : `High memory usage (${totalMB}MB)`,
        };
      },
      60000
    ); // Check every minute

    // System uptime check
    this.registerCheck(
      'system',
      async () => {
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
            pid: process.pid,
          },
          message: `System running for ${uptimeHours} hours`,
        };
      },
      300000
    ); // Check every 5 minutes
  }

  /**
   * Register a health check
   */
  registerCheck(name: string, checkFn: HealthCheckFn, interval = 30000): void {
    this.checks.set(name, checkFn);

    if (this.isRunning) {
      this.startCheck(name, interval);
    }

    log.info(`Health check registered: ${name} (interval: ${interval}ms)`);
  }

  /**
   * Start a specific health check
   */
  private startCheck(name: string, interval: number): void {
    const checkFn = this.checks.get(name);
    if (!checkFn) return;

    // Clear existing interval
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name)!);
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
  async runCheck(name: string): Promise<void> {
    const checkFn = this.checks.get(name);
    if (!checkFn) return;

    try {
      const result = await checkFn();
      const checkResult: HealthCheckResult = {
        name,
        ...result,
        timestamp: Date.now(),
      };

      this.lastResults.set(name, checkResult);

      // Emit events
      this.emit('check-completed', checkResult);

      if (!result.healthy) {
        this.emit('check-failed', checkResult);
        log.warn(`Health check failed: ${name} - ${result.message}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorResult: HealthCheckResult = {
        name,
        healthy: false,
        error: errorMessage,
        timestamp: Date.now(),
        message: `Health check error: ${errorMessage}`,
      };

      this.lastResults.set(name, errorResult);
      this.emit('check-error', errorResult);
      log.error(`Health check error for ${name}:`, { error: errorMessage });
    }
  }

  /**
   * Start all health checks
   */
  start(): void {
    if (this.isRunning) {
      log.info('Health checks already running');
      return;
    }

    log.info('Starting health check service');
    this.isRunning = true;

    // Start all registered checks with their default intervals
    const defaultIntervals: Record<string, number> = {
      database: 30000,
      whatsapp: 15000,
      memory: 60000,
      system: 300000,
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
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping health check service');
    this.isRunning = false;

    // Clear all intervals
    for (const [, intervalId] of this.intervals) {
      clearInterval(intervalId);
    }
    this.intervals.clear();

    this.emit('stopped');
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    const results = Array.from(this.lastResults.values());
    const overall = results.length > 0 ? results.every((r) => r.healthy) : false;

    return {
      overall,
      timestamp: Date.now(),
      checks: results,
      summary: {
        total: results.length,
        healthy: results.filter((r) => r.healthy).length,
        unhealthy: results.filter((r) => !r.healthy).length,
      },
    };
  }

  /**
   * Get detailed health report
   */
  getDetailedReport(): DetailedHealthReport {
    const status = this.getHealthStatus();

    return {
      ...status,
      systemInfo: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
      },
      resourceStats: ResourceManager.getStats(),
      databaseStats: getDatabaseStats().connectionPool as unknown as Record<string, unknown>,
    };
  }

  /**
   * Get health check statistics
   */
  getStats(): HealthCheckStats {
    return {
      isRunning: this.isRunning,
      totalChecks: this.checks.size,
      activeIntervals: this.intervals.size,
      lastResults: this.lastResults.size,
    };
  }

  /**
   * Remove a health check
   */
  removeCheck(name: string): void {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name)!);
      this.intervals.delete(name);
    }

    this.checks.delete(name);
    this.lastResults.delete(name);

    log.info(`Health check removed: ${name}`);
  }

  /**
   * Update check interval
   */
  updateCheckInterval(name: string, newInterval: number): void {
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
