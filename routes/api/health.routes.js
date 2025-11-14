/**
 * Health & Monitoring Routes
 *
 * Provides endpoints for system health checks and health monitoring control.
 * Includes basic health status, detailed health reports, and operations to
 * start/stop health monitoring.
 */

import express from 'express';
import HealthCheck from '../../services/monitoring/HealthCheck.js';

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
        console.error('Error getting health status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get health status',
            error: error.message
        });
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
        console.error('Error getting detailed health report:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get detailed health report',
            error: error.message
        });
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
        console.error('Error starting health monitoring:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start health monitoring',
            error: error.message
        });
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
        console.error('Error stopping health monitoring:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to stop health monitoring',
            error: error.message
        });
    }
});

export default router;
