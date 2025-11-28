/**
 * Centralized route configuration for Data Router migration
 *
 * This file will gradually replace the Routes/Route structure in App.jsx
 * During migration, we'll move routes from App.jsx to this file one section at a time
 *
 * Phase 0: Infrastructure setup (empty config)
 * Phase 1: Simple routes (Dashboard, Statistics, Expenses, PatientManagement, TestCompiler)
 * Phase 2+: Nested routes will be added in subsequent phases
 */
import React from 'react';
import { Navigate } from 'react-router-dom';

// Layouts
import RootLayout from '../layouts/RootLayout.jsx';
import AlignerLayout from '../layouts/AlignerLayout.jsx';

// Error boundaries
import { RouteErrorBoundary } from '../components/error-boundaries/RouteErrorBoundary.jsx';
import { RouteError } from '../components/error-boundaries/RouteError.jsx';

// Loaders (Phase 2+)
import {
  withAuth,
  templateListLoader,
  templateDesignerLoader,
  alignerDoctorsLoader,
  alignerPatientWorkLoader,
  patientShellLoader,
  patientManagementLoader,
  dailyAppointmentsLoader
} from './loaders.js';

// CSS imports for Phase 2
import '../../css/pages/settings.css';
import '../../css/pages/cost-presets-settings.css';
import '../../css/pages/user-management.css';
import '../../css/pages/template-management.css';
import '../../css/pages/template-designer.css';

// CSS imports for Phase 3
import '../../css/pages/aligner.css';
import '../../css/components/aligner-set-card.css';
import '../../css/components/aligner-drawer-form.css';

// CSS imports for Phase 4 (Patient Portal - comprehensive)
import '../../css/pages/patient-shell.css';
import '../../css/layout/sidebar-navigation.css';
import '../../css/pages/patient-info.css';
import '../../css/pages/add-patient.css';
import '../../css/pages/edit-patient.css';
import '../../css/pages/grid.css';
import '../../css/pages/xrays.css';
import '../../css/pages/canvas.css';
import '../../css/components/dental-chart.css';
import '../../css/components/timepoints-selector.css';
import '../../css/components/comparison-viewer.css';
import '../../css/pages/work-management.css';
import '../../css/pages/work-payments.css';
import '../../css/components/work-card.css';
import '../../css/components/new-work-component.css';
import '../../css/components/invoice-form.css';
import '../../css/components/payment-modal.css';
import '../../css/pages/visits-summary.css';
import '../../css/pages/visits-spacing.css';
import '../../css/components/visits-component.css';
import '../../css/components/new-visit-component.css';
import '../../css/components/appointment-form.css';
import '../../css/components/calendar-picker-modal.css';
import '../../css/components/simplified-calendar-picker.css';
import '../../css/components/patient-appointments.css';

// CSS imports for Phase 5 (Messaging & Appointments - WebSocket-heavy)
import '../../css/pages/appointments.css';
import '../../css/pages/send.css';
import '../../css/components/appointment-calendar.css';
import '../../css/components/monthly-calendar-view.css';
import '../../css/components/whatsapp-auth.css';

// Lazy-loaded route components (Phase 1)
const Dashboard = React.lazy(() => import('../routes/Dashboard.jsx'));
const Statistics = React.lazy(() => import('../routes/Statistics.jsx'));
const Expenses = React.lazy(() => import('../routes/Expenses.jsx'));
const PatientManagement = React.lazy(() => import('../routes/PatientManagement.jsx'));
const CompilerTest = React.lazy(() => import('../test-compiler.jsx'));

// Lazy-loaded route components (Phase 2)
const SettingsComponent = React.lazy(() => import('../components/react/SettingsComponent.jsx'));
const TemplateManagement = React.lazy(() => import('../components/templates/TemplateManagement.jsx'));
const TemplateDesigner = React.lazy(() => import('../components/templates/TemplateDesigner.jsx'));

// Lazy-loaded route components (Phase 3)
const DoctorsList = React.lazy(() => import('../pages/aligner/DoctorsList.jsx'));
const PatientsList = React.lazy(() => import('../pages/aligner/PatientsList.jsx'));
const PatientSets = React.lazy(() => import('../pages/aligner/PatientSets.jsx'));
const SearchPatient = React.lazy(() => import('../pages/aligner/SearchPatient.jsx'));
const AllSetsList = React.lazy(() => import('../pages/aligner/AllSetsList.jsx'));

// Lazy-loaded route components (Phase 4)
const PatientShell = React.lazy(() => import('../components/react/PatientShell.jsx'));

// Lazy-loaded route components (Phase 5 - WebSocket-heavy)
const DailyAppointments = React.lazy(() => import('../routes/DailyAppointments.jsx'));
const Calendar = React.lazy(() => import('../routes/Calendar.jsx'));
const WhatsAppSend = React.lazy(() => import('../routes/WhatsAppSend.jsx'));
const SendMessage = React.lazy(() => import('../components/react/SendMessage.jsx'));
const WhatsAppAuth = React.lazy(() => import('../routes/WhatsAppAuth.jsx'));

/**
 * Route configuration array for createBrowserRouter
 * Structure: Each object represents a route with path, element, loader (optional), errorElement
 *
 * Phase 1: Simple routes (no loaders, just structure conversion)
 */
export const routesConfig = [
  {
    // Root layout wraps all routes
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      // ============================================================
      // PHASE 1: SIMPLE ROUTES (No loaders)
      // ============================================================

      // Dashboard (root)
      {
        path: '/',
        element: (
          <RouteErrorBoundary routeName="Dashboard">
            <Dashboard />
          </RouteErrorBoundary>
        ),
      },

      // Dashboard (explicit path)
      {
        path: '/dashboard',
        element: (
          <RouteErrorBoundary routeName="Dashboard">
            <Dashboard />
          </RouteErrorBoundary>
        ),
      },

      // Test Compiler
      {
        path: '/test-compiler',
        element: (
          <RouteErrorBoundary routeName="Compiler Test">
            <CompilerTest />
          </RouteErrorBoundary>
        ),
      },

      // Statistics
      {
        path: '/statistics',
        element: (
          <RouteErrorBoundary routeName="Statistics">
            <Statistics />
          </RouteErrorBoundary>
        ),
      },

      // Expenses
      {
        path: '/expenses',
        element: (
          <RouteErrorBoundary routeName="Expenses">
            <Expenses />
          </RouteErrorBoundary>
        ),
      },

      // Patient Management (search/grid with native scroll restoration)
      {
        path: '/patient-management',
        element: (
          <RouteErrorBoundary routeName="Patient Management">
            <PatientManagement />
          </RouteErrorBoundary>
        ),
        loader: patientManagementLoader, // Pre-fetch filter data
      },

      // ============================================================
      // PHASE 2: SETTINGS & TEMPLATES (With loaders)
      // ============================================================

      // Settings (nested routes with loader)
      {
        path: '/settings',
        children: [
          {
            index: true,
            element: <Navigate to="/settings/general" replace />,
          },
          {
            path: ':tab',
            element: (
              <RouteErrorBoundary routeName="Settings">
                <SettingsComponent />
              </RouteErrorBoundary>
            ),
            // No loader needed - SettingsComponent fetches user role independently
          },
          {
            path: '*',
            element: <Navigate to="/settings/general" replace />,
          },
        ],
      },

      // Templates (nested routes with loaders)
      {
        path: '/templates',
        children: [
          {
            index: true,
            element: (
              <RouteErrorBoundary routeName="Template Management">
                <TemplateManagement />
              </RouteErrorBoundary>
            ),
            loader: templateListLoader, // Load template list
          },
          {
            path: 'designer',
            element: (
              <RouteErrorBoundary routeName="Template Designer">
                <TemplateDesigner />
              </RouteErrorBoundary>
            ),
            loader: templateDesignerLoader, // Load template for editing (create mode)
          },
          {
            path: 'designer/:templateId',
            element: (
              <RouteErrorBoundary routeName="Template Designer">
                <TemplateDesigner />
              </RouteErrorBoundary>
            ),
            loader: templateDesignerLoader, // Load template for editing
          },
          {
            path: '*',
            element: <Navigate to="/templates" replace />,
          },
        ],
      },

      // ============================================================
      // PHASE 3: ALIGNER MANAGEMENT (With layout wrapper and loaders)
      // ============================================================

      // Aligner Management (nested routes with AlignerLayout wrapper)
      {
        path: '/aligner',
        element: <AlignerLayout />, // Layout wrapper with mode toggle
        children: [
          {
            index: true,
            element: (
              <RouteErrorBoundary routeName="Doctors List">
                <DoctorsList />
              </RouteErrorBoundary>
            ),
            loader: alignerDoctorsLoader, // Load doctors before rendering
          },
          {
            path: 'all-sets',
            element: (
              <RouteErrorBoundary routeName="All Sets">
                <AllSetsList />
              </RouteErrorBoundary>
            ),
            // No loader - loads data in component (complex filtering)
          },
          {
            path: 'doctor/:doctorId',
            element: (
              <RouteErrorBoundary routeName="Patients List">
                <PatientsList />
              </RouteErrorBoundary>
            ),
            // No loader - PatientsList fetches doctor and patients independently
          },
          {
            path: 'doctor/:doctorId/patient/:workId',
            element: (
              <RouteErrorBoundary routeName="Patient Sets">
                <PatientSets />
              </RouteErrorBoundary>
            ),
            loader: alignerPatientWorkLoader, // Load patient + work details
          },
          {
            path: 'search',
            element: (
              <RouteErrorBoundary routeName="Search Patient">
                <SearchPatient />
              </RouteErrorBoundary>
            ),
            // No loader - search is user-driven
          },
          {
            path: 'patient/:workId',
            element: (
              <RouteErrorBoundary routeName="Patient Sets">
                <PatientSets />
              </RouteErrorBoundary>
            ),
            loader: alignerPatientWorkLoader, // Same loader as browse path
          },
          {
            path: '*',
            element: <Navigate to="/aligner" replace />,
          },
        ],
      },

      // ============================================================
      // PHASE 4: PATIENT PORTAL (Most complex - 14 nested pages)
      // ============================================================

      // Patient Portal (nested routes with comprehensive loader)
      {
        path: '/patient',
        children: [
          // Specific route for diagnosis with workId in path
          {
            path: ':patientId/work/:workId/diagnosis',
            element: (
              <RouteErrorBoundary routeName="Patient Diagnosis">
                <PatientShell />
              </RouteErrorBoundary>
            ),
            loader: patientShellLoader, // Load patient + work details
          },

          // Generic patient routes (handles all 14 pages with wildcard)
          // Pages: works, photos/tp0-tp9, compare, xrays, visits, new-visit,
          //        payments, new-appointment, edit-appointment/:id,
          //        patient-info, edit-patient
          {
            path: ':patientId/:page/*',
            element: (
              <RouteErrorBoundary routeName="Patient Portal">
                <PatientShell />
              </RouteErrorBoundary>
            ),
            loader: patientShellLoader, // Load patient demographics + optional data
          },

          // Default patient route - redirect to works
          {
            path: ':patientId',
            element: <Navigate to="works" replace />,
          },

          // Redirect unknown routes to patient management
          {
            path: '*',
            element: <Navigate to="/patient-management" replace />,
          },
        ],
      },

      // ============================================================
      // PHASE 5: MESSAGING & APPOINTMENTS (WebSocket-heavy, NO loaders)
      // ============================================================

      // Daily Appointments (Hybrid: Loader + WebSocket)
      {
        path: '/appointments',
        element: (
          <RouteErrorBoundary routeName="Daily Appointments">
            <DailyAppointments />
          </RouteErrorBoundary>
        ),
        loader: dailyAppointmentsLoader, // Pre-fetch initial data for scroll restoration
      },

      // Monthly Calendar (100% WebSocket-driven)
      {
        path: '/calendar',
        element: (
          <RouteErrorBoundary routeName="Calendar">
            <Calendar />
          </RouteErrorBoundary>
        ),
        // No loader - 100% WebSocket-driven real-time data
      },

      // WhatsApp Send (100% WebSocket-driven)
      {
        path: '/send',
        element: (
          <RouteErrorBoundary routeName="WhatsApp Send">
            <WhatsAppSend />
          </RouteErrorBoundary>
        ),
        // No loader - 100% WebSocket-driven real-time data
      },

      // Send Message (100% WebSocket-driven)
      {
        path: '/send-message',
        element: (
          <RouteErrorBoundary routeName="Send Message">
            <SendMessage />
          </RouteErrorBoundary>
        ),
        // No loader - 100% WebSocket-driven real-time data
      },

      // WhatsApp Authentication (100% WebSocket-driven)
      {
        path: '/auth',
        element: (
          <RouteErrorBoundary routeName="WhatsApp Auth">
            <WhatsAppAuth />
          </RouteErrorBoundary>
        ),
        // No loader - 100% WebSocket-driven real-time data
      },

      // ============================================================
      // ALL ROUTES MIGRATED! 🎉
      // ============================================================

      // Fallback (404) - redirect to dashboard
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
];

export default routesConfig;
