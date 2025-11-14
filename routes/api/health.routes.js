/**
 * Health & Monitoring Routes
 *
 * Provides endpoints for system health checks and health monitoring control.
 * Includes basic health status, detailed health reports, and operations to
 * start/stop health monitoring.
 */

import express from 'express';
import HealthCheck from '../../services/monitoring/HealthCheck.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = express.Router();

/**
 * Basic health status endpoint
 */
router.get('/health', (req, res) => {
    try {
        const health = HealthCheck.getHealthStatus();
        const statusCode = health.overall ? 200 : 503;

        res.status(statusCode).json({
            status: health.overall ? 'healthy' : 'unhealthy',
            ...health
        });
    } catch (error) {
        log.error('Error getting health status:', error);
        ErrorResponses.internalError(res, 'Failed to get health status', error);
    }
});

/**
 * Detailed health report endpoint
 */
router.get('/health/detailed', (req, res) => {
    try {
        const report = HealthCheck.getDetailedReport();
        res.json(report);
    } catch (error) {
        log.error('Error getting detailed health report:', error);
        ErrorResponses.internalError(res, 'Failed to get detailed health report', error);
    }
});

/**
 * Start health monitoring
 */
router.post('/health/start', (req, res) => {
    try {
        HealthCheck.start();
        res.json({
            success: true,
            message: 'Health monitoring started'
        });
    } catch (error) {
        log.error('Error starting health monitoring:', error);
        ErrorResponses.internalError(res, 'Failed to start health monitoring', error);
    }
});

/**
 * Stop health monitoring
 */
router.post('/health/stop', (req, res) => {
    try {
        HealthCheck.stop();
        res.json({
            success: true,
            message: 'Health monitoring stopped'
        });
    } catch (error) {
        log.error('Error stopping health monitoring:', error);
        ErrorResponses.internalError(res, 'Failed to stop health monitoring', error);
    }
});

export default router;
