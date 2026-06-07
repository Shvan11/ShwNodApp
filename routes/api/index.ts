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
import { Router } from 'express';
import type { EventEmitter } from 'events';

// Import all route modules
// note: Routes that haven't been migrated yet use .js, migrated ones use .js (ESM resolution)
import patientRoutes from './patient.routes.js';
import appointmentRoutes, { setWebSocketEmitter as setAppointmentWS } from './appointment.routes.js';
import chairDisplayRoutes, { setWebSocketEmitter as setChairDisplayWS } from './chair-display.routes.js';
import paymentRoutes from './payment.routes.js';
import workRoutes from './work.routes.js';
import visitRoutes from './visit.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import messagingRoutes from './messaging.routes.js';
import alignerRoutes from './aligner.routes.js';
import employeeRoutes from './employee.routes.js';
import expenseRoutes from './expense.routes.js';
import healthRoutes from './health.routes.js';
import settingsRoutes from './settings.routes.js';
import staffRoutes from './staff.routes.js';
import mediaRoutes from './media.routes.js';
// lookupRoutes + costPresetRoutes are mounted pre-auth in index.ts (public reference
// data / self-guarded mutations) and intentionally NOT remounted on this post-auth router.
import reportsRoutes from './reports.routes.js';
import utilityRoutes from './utility.routes.js';
import photoEditorRoutes, { setWebSocketEmitter as setPhotoEditorWS } from './photo-editor.routes.js';
import holidayRoutes from './holiday.routes.js';
import videoRoutes from './video.routes.js';
import standRoutes from './stand.routes.js';
import fileExplorerRoutes from './file-explorer.routes.js';
import localsendRoutes from './localsend.routes.js';
import telegramRoutes from './telegram.routes.js';
import integrationsRoutes from './integrations.routes.js';

// Import template routes (already modular)
import templateRouter from '../template-api.js';

const router = Router();

/**
 * Set the WebSocket emitter reference for all modules that need it
 * @param emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter: EventEmitter): void {
  // Inject WebSocket emitter into modules that need it
  setAppointmentWS(emitter);
  setChairDisplayWS(emitter);
  setPhotoEditorWS(emitter);
}

// Mount template routes
router.use('/templates', templateRouter);

// Mount all route modules
// note: Order matters for routes with similar patterns - most specific routes first

// Core entity routes
router.use('/', patientRoutes);       // Patient management
router.use('/', fileExplorerRoutes);  // Per-patient file explorer (/patients/:id/files*)
router.use('/', appointmentRoutes);   // Appointment scheduling
router.use('/', chairDisplayRoutes);  // Chair-side public display events
router.use('/', paymentRoutes);       // Payments and invoices
router.use('/', workRoutes);          // Treatment work/plans
router.use('/', visitRoutes);         // Visit tracking

// Messaging routes (prefixed)
router.use('/wa', whatsappRoutes);              // WhatsApp (mounted at /wa)
router.use('/messaging', messagingRoutes);      // Messaging system (mounted at /messaging)

// Aligner routes. Every route in alignerRoutes self-prefixes its full path
// (`/aligner/*` or `/aligner-doctors*`), so a SINGLE root mount yields the
// canonical `/api/aligner/*` + `/api/aligner-doctors*` the FE actually calls.
// (A second `/aligner` mount would only produce dead `/api/aligner/aligner/*`
// paths nothing calls — same self-prefix trap as the expense mount above.)
router.use('/', alignerRoutes);

// Employee and expense routes
router.use('/', employeeRoutes);      // Employee management
// All expense endpoints define their own `/expenses` prefix internally, so they
// mount at root → `/api/expenses*`. (A second `/expenses` mount would resolve to
// the dead `/api/expenses/expenses`, so there is intentionally only one mount.)
router.use('/', expenseRoutes);        // Expense tracking (routes define /expenses* prefix)

// System and configuration routes
router.use('/health', healthRoutes);   // Health monitoring (mounted at /health)
router.use('/', settingsRoutes);       // Settings and configuration
// costPresetRoutes is mounted pre-auth in index.ts (its GETs are public reference
// data; its mutations self-guard with inline authenticate/authorize) — no mount here.

// Lookup and reference data
router.use('/', staffRoutes);          // Doctors and operators
router.use('/', mediaRoutes);          // Photo server and WebCeph
// lookupRoutes is mounted pre-auth in index.ts (read-only public reference data) — no mount here.

// Reports and utilities
router.use('/', reportsRoutes);        // Financial reports and statistics
router.use('/', utilityRoutes);        // Miscellaneous utilities

// Holiday routes
router.use('/holidays', holidayRoutes); // Holiday management

// Photo sessions
router.use('/photo-editor', photoEditorRoutes); // Native photo layout manager / photo sessions

// Video management
router.use('/videos', videoRoutes); // Educational videos

// Stand / Mini-Pharmacy
router.use('/', standRoutes); // Stand inventory, POS, reports (routes define /stand/* prefix)

// LocalSend — share patient files/images to LAN devices (mounted at /localsend)
router.use('/localsend', localsendRoutes);

// Telegram — share patient files/images to a contact via Telegram (mounted at /telegram)
router.use('/telegram', telegramRoutes);

// Integrations — manage external-service auth (Telegram now; WhatsApp/Google later)
router.use('/integrations', integrationsRoutes);

export default router;
