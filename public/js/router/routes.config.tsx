/**
 * Centralized route configuration for Data Router
 *
 * All application routes are defined here with:
 * - Lazy-loaded components for code splitting
 * - Route loaders for data prefetching
 * - Error boundaries per route
 */
import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

// Layouts
import RootLayout from '../layouts/RootLayout';
import AlignerLayout from '../layouts/AlignerLayout';

// Error boundaries
import { RouteErrorBoundary } from '../components/error-boundaries/RouteErrorBoundary';
import { RouteError } from '../components/error-boundaries/RouteError';

// Route loaders
import {
  templateListLoader,
  templateDesignerLoader,
  alignerDoctorsLoader,
  alignerPatientWorkLoader,
  patientShellLoader,
  patientManagementLoader,
  dailyAppointmentsLoader,
} from './loaders';

// NOTE: CSS imports moved to co-located components (Hybrid Co-location Strategy)
// - Global CSS: App.tsx
// - Route CSS: Each route/layout component imports its own CSS
// - Component CSS: Each component imports its dedicated CSS
// See CLAUDE.md "CSS Import Strategy" for details

// Lazy-loaded route components - Core routes
const Dashboard = React.lazy(() => import('../routes/Dashboard'));
const Statistics = React.lazy(() => import('../routes/Statistics'));
const Expenses = React.lazy(() => import('../routes/Expenses'));
const Videos = React.lazy(() => import('../routes/Videos'));
const PatientManagement = React.lazy(() => import('../routes/PatientManagement'));
const CompilerTest = React.lazy(() => import('../test-compiler'));

// Lazy-loaded route components - Settings & Templates
const SettingsComponent = React.lazy(() => import('../components/react/SettingsComponent'));
const TemplateManagement = React.lazy(
  () => import('../components/templates/TemplateManagement')
);
const TemplateDesigner = React.lazy(() => import('../components/templates/TemplateDesigner'));

// Lazy-loaded route components - Aligner
const DoctorsList = React.lazy(() => import('../pages/aligner/DoctorsList'));
const PatientsList = React.lazy(() => import('../pages/aligner/PatientsList'));
const PatientSets = React.lazy(() => import('../pages/aligner/PatientSets'));
const SearchPatient = React.lazy(() => import('../pages/aligner/SearchPatient'));
const AllSetsList = React.lazy(() => import('../pages/aligner/AllSetsList'));

// Lazy-loaded route components - Patient
const PatientShell = React.lazy(() => import('../components/react/PatientShell'));

// Lazy-loaded route components - Appointments & WhatsApp
const DailyAppointments = React.lazy(() => import('../routes/DailyAppointments'));
const Calendar = React.lazy(() => import('../routes/Calendar'));
const WhatsAppSend = React.lazy(() => import('../routes/WhatsAppSend'));
const SendMessage = React.lazy(() => import('../components/react/SendMessage'));
const WhatsAppAuth = React.lazy(() => import('../routes/WhatsAppAuth'));

/**
 * Route configuration array for createBrowserRouter
 * Each route object includes: path, element, loader (optional), errorElement
 */
export const routesConfig: RouteObject[] = [
  {
    // Root layout wraps all routes
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      // ============================================================
      // CORE ROUTES
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

      // Videos (educational content)
      {
        path: '/videos',
        element: (
          <RouteErrorBoundary routeName="Videos">
            <Videos />
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
      // SETTINGS & TEMPLATES
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
      // ALIGNER MANAGEMENT
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
      // PATIENT PORTAL
      // ============================================================

      // Patient Portal (nested routes with comprehensive loader)
      {
        path: '/patient',
        children: [
          // Specific route for diagnosis with workId in path
          {
            path: ':personId/work/:workId/diagnosis',
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
            path: ':personId/:page/*',
            element: (
              <RouteErrorBoundary routeName="Patient Portal">
                <PatientShell />
              </RouteErrorBoundary>
            ),
            loader: patientShellLoader, // Load patient demographics + optional data
          },

          // Default patient route - redirect to works
          {
            path: ':personId',
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
      // MESSAGING & APPOINTMENTS
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
      // ALL ROUTES MIGRATED!
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
