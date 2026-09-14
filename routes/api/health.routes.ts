/**
 * Health & Monitoring Routes
 *
 * Provides endpoints for system health checks and health monitoring control.
 * Includes basic health status, detailed health reports, and operations to
 * start/stop health monitoring.
 */

import { Router, type Request, type Response } from 'express';
import HealthCheck from '../../services/monitoring/HealthCheck.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';

const router = Router();

// Paths are relative to the router's OWN mount (`/api/health`, routes/api/index.ts).
// They used to re-declare the `/health` prefix here as well, so the real URLs were
// `/api/health/health…` — unreachable at their documented paths and called by
// nothing. Do not reintroduce the prefix.
const adminOnly = authorize(ADMIN_ROLES);

/**
 * Basic health status endpoint
 */
router.get('/', (_req: Request, res: Response): void => {
  try {
    const health = HealthCheck.getHealthStatus();
    const statusCode = health.overall ? 200 : 503;

    res.status(statusCode).json({
      status: health.overall ? 'healthy' : 'unhealthy',
      ...health
    });
  } catch (error) {
    log.error('Error getting health status:', error);
    ErrorResponses.internalError(res, 'Failed to get health status', error as Error);
  }
});

/**
 * Detailed health report endpoint
 */
router.get('/detailed', (_req: Request, res: Response): void => {
  try {
    const report = HealthCheck.getDetailedReport();
    res.json(report);
  } catch (error) {
    log.error('Error getting detailed health report:', error);
    ErrorResponses.internalError(res, 'Failed to get detailed health report', error as Error);
  }
});

/**
 * Start health monitoring
 */
router.post('/start', adminOnly, (_req: Request, res: Response): void => {
  try {
    HealthCheck.start();
    res.json({
      success: true,
      message: 'Health monitoring started'
    });
  } catch (error) {
    log.error('Error starting health monitoring:', error);
    ErrorResponses.internalError(res, 'Failed to start health monitoring', error as Error);
  }
});

/**
 * Stop health monitoring
 */
router.post('/stop', adminOnly, (_req: Request, res: Response): void => {
  try {
    HealthCheck.stop();
    res.json({
      success: true,
      message: 'Health monitoring stopped'
    });
  } catch (error) {
    log.error('Error stopping health monitoring:', error);
    ErrorResponses.internalError(res, 'Failed to stop health monitoring', error as Error);
  }
});

export default router;
