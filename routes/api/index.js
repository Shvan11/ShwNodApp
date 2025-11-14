/**
 * API Routes Aggregator
 *
 * This file aggregates all modular API routes and mounts them at the appropriate paths.
 * Refactored from a monolithic 6,772-line api.js file into 17 organized modules.
 *
 * Module Organization:
 * - patient.routes.js (15 endpoints) - Patient data, search, CRUD
 * - appointment.routes.js (14 endpoints) - Appointment scheduling and management
 * - payment.routes.js (11 endpoints) - Payments, invoices, exchange rates
 * - work.routes.js (15 endpoints) - Treatment work/plans management
 * - visit.routes.js (13 endpoints) - Visit tracking and wire management
 * - whatsapp.routes.js (12 endpoints) - WhatsApp messaging integration
 * - messaging.routes.js (7 endpoints) - Message status and circuit breaker
 * - aligner.routes.js (30 endpoints) - Aligner treatment management
 * - employee.routes.js (6 endpoints) - Employee CRUD operations
 * - expense.routes.js (12 endpoints) - Expense tracking
 * - health.routes.js (4 endpoints) - Health monitoring
 * - settings.routes.js (14 endpoints) - System configuration
 * - staff.routes.js (2 endpoints) - Doctors and operators
 * - media.routes.js (6 endpoints) - Photo server and WebCeph
 * - lookup.routes.js (4 endpoints) - Reference data for dropdowns
 * - reports.routes.js (2 endpoints) - Financial statistics and reports
 * - utility.routes.js (6 endpoints) - Miscellaneous utilities
 *
 * Total: ~173 endpoints
 */
import express from 'express';

// Import all route modules
import patientRoutes, { setWebSocketEmitter as setPatientWS } from './patient.routes.js';
import appointmentRoutes, { setWebSocketEmitter as setAppointmentWS } from './appointment.routes.js';
import paymentRoutes from './payment.routes.js';
import workRoutes from './work.routes.js';
import visitRoutes from './visit.routes.js';
import whatsappRoutes, { setWebSocketEmitter as setWhatsappWS } from './whatsapp.routes.js';
import messagingRoutes, { setWebSocketEmitter as setMessagingWS } from './messaging.routes.js';
import alignerRoutes from './aligner.routes.js';
import employeeRoutes from './employee.routes.js';
import expenseRoutes from './expense.routes.js';
import healthRoutes from './health.routes.js';
import settingsRoutes from './settings.routes.js';
import staffRoutes from './staff.routes.js';
import mediaRoutes from './media.routes.js';
import lookupRoutes from './lookup.routes.js';
import reportsRoutes from './reports.routes.js';
import utilityRoutes from './utility.routes.js';

// Import template routes (already modular)
import templateRouter from '../template-api.js';

const router = express.Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference for all modules that need it
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;

    // Inject WebSocket emitter into modules that need it
    setPatientWS(emitter);
    setAppointmentWS(emitter);
    setWhatsappWS(emitter);
    setMessagingWS(emitter);
}

// Mount template routes
router.use('/templates', templateRouter);

// Mount all route modules
// Note: Order matters for routes with similar patterns - most specific routes first

// Core entity routes
router.use('/', patientRoutes);       // Patient management
router.use('/', appointmentRoutes);   // Appointment scheduling
router.use('/', paymentRoutes);       // Payments and invoices
router.use('/', workRoutes);          // Treatment work/plans
router.use('/', visitRoutes);         // Visit tracking

// Messaging routes (prefixed)
router.use('/wa', whatsappRoutes);              // WhatsApp (mounted at /wa)
router.use('/messaging', messagingRoutes);      // Messaging system (mounted at /messaging)

// Aligner routes (prefixed)
router.use('/aligner', alignerRoutes);          // Aligner management (mounted at /aligner)
router.use('/', alignerRoutes);                 // Also mount at root for /aligner-doctors routes

// Employee and expense routes
router.use('/', employeeRoutes);      // Employee management
router.use('/expenses', expenseRoutes); // Expense tracking (some mounted at /expenses, some at root)
router.use('/', expenseRoutes);        // Legacy expense routes at root

// System and configuration routes
router.use('/health', healthRoutes);   // Health monitoring (mounted at /health)
router.use('/', settingsRoutes);       // Settings and configuration

// Lookup and reference data
router.use('/', staffRoutes);          // Doctors and operators
router.use('/', mediaRoutes);          // Photo server and WebCeph
router.use('/', lookupRoutes);         // Reference data

// Reports and utilities
router.use('/', reportsRoutes);        // Financial reports and statistics
router.use('/', utilityRoutes);        // Miscellaneous utilities

export default router;
