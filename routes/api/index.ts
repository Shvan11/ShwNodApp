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
import patientTimepointRoutes from './patient-timepoint.routes.js';
import alertRoutes from './alert.routes.js';
import patientPortalAdminRoutes from './patient-portal-admin.routes.js';
import appointmentRoutes, { setWebSocketEmitter as setAppointmentWS } from './appointment.routes.js';
import chairDisplayRoutes, { setWebSocketEmitter as setChairDisplayWS } from './chair-display.routes.js';
import paymentRoutes from './payment.routes.js';
import workRoutes from './work.routes.js';
import workItemRoutes from './work-item.routes.js';
import diagnosisRoutes from './diagnosis.routes.js';
import workTransferRoutes from './work-transfer.routes.js';
import visitRoutes from './visit.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import whatsappMediaRoutes from './whatsapp-media.routes.js';
import whatsappSessionRoutes from './whatsapp-session.routes.js';
import messagingRoutes from './messaging.routes.js';
import alignerRoutes from './aligner.routes.js';
import alignerNoteRoutes from './aligner-note.routes.js';
import alignerBatchRoutes from './aligner-batch.routes.js';
import alignerFileRoutes from './aligner-file.routes.js';
import alignerArchformRoutes from './aligner-archform.routes.js';
import alignerLabelRoutes from './aligner-label.routes.js';
import alignerDoctorRoutes from './aligner-doctor.routes.js';
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
import slideshowRoutes from './slideshow.routes.js';
import localsendRoutes from './localsend.routes.js';
import telegramRoutes from './telegram.routes.js';
import shareRoutes from './share.routes.js';
import brandingRoutes from './branding.routes.js';
import integrationsRoutes from './integrations.routes.js';
import threeshapeRoutes from './threeshape.routes.js';
import taskRoutes from './task.routes.js';
import monitoringRoutes from './monitoring.routes.js';
import approvalRoutes from './approval.routes.js';
import labCaseRoutes from './lab-case.routes.js';
import portalActivityRoutes from './portal-activity.routes.js';
import announcementRoutes from './announcement.routes.js';
import tvDisplayRoutes from './tv-display.routes.js';

// Import template routes (already modular)
import templateRouter from './template.routes.js';

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
// The three routers below were split out of patient.routes.ts (C1) and are
// mounted at the same prefix. They claim disjoint paths (/patients/:id/timepoints*,
// /patients/:id/alerts + /alerts/*, /patients/:id/portal* + /photos/visibility),
// none of which any sibling matches, so this order is not load-bearing — but keep
// them adjacent to patientRoutes so the grouping stays readable.
router.use('/', patientTimepointRoutes);     // Time points, gallery, X-ray
router.use('/', alertRoutes);                // Patient alerts / header tasks
router.use('/', patientPortalAdminRoutes);   // Staff-side portal access + photo privacy
router.use('/', fileExplorerRoutes);  // Per-patient file explorer (/patients/:id/files*)
router.use('/', slideshowRoutes);     // Saved slideshow configurations (/slideshow-configs*)
router.use('/', appointmentRoutes);   // Appointment scheduling
router.use('/', chairDisplayRoutes);  // Chair-side public display events
router.use('/', paymentRoutes);       // Payments and invoices
router.use('/', workRoutes);          // Treatment work/plans
// The three routers below were split out of work.routes.ts (S2/C5) and mount at the
// same prefix, in the order their sections appeared in the file — so the registration
// order of the route table is byte-identical to before the split. They claim disjoint
// paths (/getworkdetailslist + /addworkdetail…, /diagnosis*, /work/:workId/transfer*),
// none of which any sibling matches.
router.use('/', workItemRoutes);      // Work items (treatment details) + their teeth
router.use('/', diagnosisRoutes);     // Comprehensive orthodontic diagnosis (1 per work)
router.use('/', workTransferRoutes);  // Move a work to another patient (admin only)
router.use('/', visitRoutes);         // Visit tracking

// Messaging routes (prefixed)
router.use('/wa', whatsappRoutes);              // WhatsApp (mounted at /wa)
// Split out of whatsapp.routes.ts (S2/C6); mounted at the same `/wa` prefix in the
// order their sections appeared in that file, so the registration order of the route
// table is unchanged by the split.
router.use('/wa', whatsappMediaRoutes);         // /sendmedia, /sendmedia2
router.use('/wa', whatsappSessionRoutes);       // QR/status + client lifecycle
router.use('/messaging', messagingRoutes);      // Messaging system (mounted at /messaging)

// Aligner routes. Every route in alignerRoutes self-prefixes its full path
// (`/aligner/*` or `/aligner-doctors*`), so a SINGLE root mount yields the
// canonical `/api/aligner/*` + `/api/aligner-doctors*` the FE actually calls.
// (A second `/aligner` mount would only produce dead `/api/aligner/aligner/*`
// paths nothing calls — same self-prefix trap as the expense mount above.)
router.use('/', alignerRoutes);
// The six routers below were split out of aligner.routes.ts (S2/C4) and mount at the
// same prefix, in the order their sections appeared in that file — so the registration
// order of the route table is unchanged by the split. Like alignerRoutes they
// self-prefix their full paths, hence the single root mount each.
router.use('/', alignerNoteRoutes);      // Lab↔Doctor note thread on a set
router.use('/', alignerBatchRoutes);     // Batch CRUD + manufacture/deliver lifecycle
router.use('/', alignerFileRoutes);      // Set attachments: treatment-plan PDF + portal photos
router.use('/', alignerArchformRoutes);  // Archform SQLite patient matching
router.use('/', alignerLabelRoutes);     // Printable aligner-label PDF
router.use('/', alignerDoctorRoutes);    // /aligner-doctors* CRUD

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

// Share staging — persist browser-generated images so the targets above can send them
router.use('/share', shareRoutes);

// Clinic branding — header logo + display name (routes define their /branding* prefix)
router.use('/', brandingRoutes);

// Integrations — manage external-service auth (Telegram now; WhatsApp/Google later)
router.use('/integrations', integrationsRoutes);

// 3Shape Unite Web Service — per-patient scan actions (routes self-prefix /threeshape/*)
router.use('/', threeshapeRoutes);

// Tasks — the app-wide header surface of the alerts table (/api/tasks)
router.use('/', taskRoutes);

// Monitoring — browser-side error sink (/api/client-error)
router.use('/', monitoringRoutes);

// Approvals — maker-checker approval/notice queue (/api/approvals*)
router.use('/', approvalRoutes);

// Lab case tracker — prosthetic case stage tracking (/api/lab-cases*)
router.use('/', labCaseRoutes);

// Portal activity — the staff header bell over portal-written aligner flags (/api/portal-activity*)
router.use('/', portalActivityRoutes);

// Doctor announcements — staff-composed + auto batch events for the aligner portal (/api/announcements*)
router.use('/', announcementRoutes);

// Waiting-room TV signage — Settings → TV Display (/api/tv-display*). The TV's
// own session-less endpoints are mounted pre-auth in index.ts (/tv-display).
router.use('/', tvDisplayRoutes);

export default router;
