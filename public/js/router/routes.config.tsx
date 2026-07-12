/**
 * Centralized route configuration for Data Router
 *
 * All application routes are defined here with:
 * - Lazy-loaded components for code splitting
 * - Route loaders for data prefetching
 * - Error boundaries per route
 */
import React from 'react';
import { Navigate, type RouteObject, type LoaderFunction } from 'react-router-dom';

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
  labTrackingLoader,
} from './loaders';

// NOTE: CSS imports moved to co-located components (Hybrid Co-location Strategy)
// - Global CSS: App.tsx
// - Route CSS: Each route/layout component imports its own CSS
// - Component CSS: Each component imports its dedicated CSS
// See CLAUDE.md "CSS Import Strategy" for details

/**
 * Like `React.lazy`, but the returned component also exposes `.preload()` —
 * calling it kicks off the dynamic import (chunk download) ahead of render.
 * Mirrors React's own `lazy` typing so `<Component />` type-checks unchanged.
 */
function lazyRoute<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> & { preload: () => void } {
  const Component = React.lazy(factory) as React.LazyExoticComponent<T> & {
    preload: () => void;
  };
  // Fire-and-forget: warm the browser's module cache. React.lazy reuses the
  // same in-flight module promise when it renders, so there's no double fetch.
  // Swallow rejections here — this is a speculative warm-up; a genuinely
  // unloadable chunk still surfaces on the render path (React.lazy → Suspense →
  // error boundary), where the chunk self-heal (core/chunk-reload.ts) reloads
  // once and reports persistent failures.
  // Without this, a failed preload would log spurious [client-error] noise.
  Component.preload = () => {
    void factory().catch(() => {});
  };
  return Component;
}

/**
 * Wrap a route loader so the route's lazy component chunk starts downloading
 * *in parallel* with the loader's data fetch — collapsing the
 * loader→lazy-chunk waterfall (fetch data, THEN fetch chunk) into one
 * concurrent wait. Adds no requests: the chunk loads anyway, just sooner.
 */
function withPreload(
  component: { preload: () => void },
  loader: LoaderFunction
): LoaderFunction {
  return (args) => {
    component.preload();
    return loader(args);
  };
}

// Lazy-loaded route components - Core routes
const Dashboard = React.lazy(() => import('../routes/Dashboard'));
const Statistics = React.lazy(() => import('../routes/Statistics'));
const Expenses = React.lazy(() => import('../routes/Expenses'));
const Videos = React.lazy(() => import('../routes/Videos'));
const PatientManagement = lazyRoute(() => import('../routes/PatientManagement'));
const TasksHistory = React.lazy(() => import('../routes/TasksHistory'));

// Lazy-loaded route components - Settings & Templates
const SettingsComponent = React.lazy(() => import('../components/react/SettingsComponent'));
const TemplateManagement = lazyRoute(
  () => import('../components/templates/TemplateManagement')
);
const TemplateDesigner = lazyRoute(() => import('../components/templates/TemplateDesigner'));

// Lazy-loaded route components - Lab case tracker
const LabTracking = lazyRoute(() => import('../routes/LabTracking'));

// Lazy-loaded route components - Aligner
const DoctorsList = lazyRoute(() => import('../pages/aligner/DoctorsList'));
const PatientsList = React.lazy(() => import('../pages/aligner/PatientsList'));
const PatientSets = lazyRoute(() => import('../pages/aligner/PatientSets'));
const SearchPatient = React.lazy(() => import('../pages/aligner/SearchPatient'));
const AllSetsList = React.lazy(() => import('../pages/aligner/AllSetsList'));
const ArchformMatcher = React.lazy(() => import('../pages/aligner/ArchformMatcher'));
const Announcements = React.lazy(() => import('../pages/aligner/Announcements'));

// Lazy-loaded route components - Patient
const PatientShell = lazyRoute(() => import('../components/react/PatientShell'));

// Lazy-loaded route components - Chair-side public display (open access, no auth)
const ChairDisplay = React.lazy(() => import('../routes/ChairDisplay'));

// Lazy-loaded route components - Stand / Mini Pharmacy
const Stand = React.lazy(() => import('../routes/Stand'));
const StandInventory = React.lazy(() => import('../routes/StandInventory'));
const StandPOS = React.lazy(() => import('../routes/StandPOS'));
const StandSalesHistory = React.lazy(() => import('../routes/StandSalesHistory'));
const StandReports = React.lazy(() => import('../routes/StandReports'));

// Lazy-loaded route components - Appointments & WhatsApp
const DailyAppointments = lazyRoute(() => import('../routes/DailyAppointments'));
const Calendar = React.lazy(() => import('../routes/Calendar'));
const WhatsAppSend = React.lazy(() => import('../routes/WhatsAppSend'));
const SendMessage = React.lazy(() => import('../components/react/SendMessage'));
const WhatsAppAuth = React.lazy(() => import('../routes/WhatsAppAuth'));

/**
 * Route configuration array for createBrowserRouter
 * Each route object includes: path, element, loader (optional), errorElement
 */
export const routesConfig: RouteObject[] = [
  // Chair-side public display — top-level route OUTSIDE RootLayout so it has no
  // header, no auth, no global providers. The kiosk browser bookmarks
  // `/chair-display?chair=N` and runs in fullscreen kiosk mode.
  {
    path: '/chair-display',
    element: (
      <React.Suspense fallback={<div />}>
        <ChairDisplay />
      </React.Suspense>
    ),
    errorElement: <RouteError />,
  },
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

      // Lab case tracker board (Crown/Bridge + Veneers stage tracking)
      {
        path: '/lab-tracking',
        element: (
          <RouteErrorBoundary routeName="Lab Tracking">
            <LabTracking />
          </RouteErrorBoundary>
        ),
        loader: withPreload(LabTracking, labTrackingLoader),
      },

      // Patient Management (search/grid with native scroll restoration)
      {
        path: '/patient-management',
        element: (
          <RouteErrorBoundary routeName="Patient Management">
            <PatientManagement />
          </RouteErrorBoundary>
        ),
        loader: withPreload(PatientManagement, patientManagementLoader), // Pre-fetch filter data + chunk
      },

      // Completed-tasks history (the read-back of the alerts done-stamps)
      {
        path: '/tasks/history',
        element: (
          <RouteErrorBoundary routeName="Completed Tasks">
            <TasksHistory />
          </RouteErrorBoundary>
        ),
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
            loader: withPreload(TemplateManagement, templateListLoader), // Load template list
          },
          {
            path: 'designer',
            element: (
              <RouteErrorBoundary routeName="Template Designer">
                <TemplateDesigner />
              </RouteErrorBoundary>
            ),
            loader: withPreload(TemplateDesigner, templateDesignerLoader), // Load template for editing (create mode)
          },
          {
            path: 'designer/:templateId',
            element: (
              <RouteErrorBoundary routeName="Template Designer">
                <TemplateDesigner />
              </RouteErrorBoundary>
            ),
            loader: withPreload(TemplateDesigner, templateDesignerLoader), // Load template for editing
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
            loader: withPreload(DoctorsList, alignerDoctorsLoader), // Load doctors before rendering
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
            loader: withPreload(PatientSets, alignerPatientWorkLoader), // Load patient + work details
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
            loader: withPreload(PatientSets, alignerPatientWorkLoader), // Same loader as browse path
          },
          {
            path: 'archform-match',
            element: (
              <RouteErrorBoundary routeName="Archform Matcher">
                <ArchformMatcher />
              </RouteErrorBoundary>
            ),
            // No loader - loads data in component
          },
          {
            path: 'announcements',
            element: (
              <RouteErrorBoundary routeName="Announcements">
                <Announcements />
              </RouteErrorBoundary>
            ),
            // No loader - list + doctors load in component (includeExpired toggle)
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
            loader: withPreload(PatientShell, patientShellLoader), // Load patient + work details
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
            loader: withPreload(PatientShell, patientShellLoader), // Load patient demographics + optional data
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
      // STAND / MINI PHARMACY
      // ============================================================

      {
        path: '/stand',
        element: (
          <RouteErrorBoundary routeName="Stand">
            <Stand />
          </RouteErrorBoundary>
        ),
      },
      {
        path: '/stand/inventory',
        element: (
          <RouteErrorBoundary routeName="Stand Inventory">
            <StandInventory />
          </RouteErrorBoundary>
        ),
      },
      {
        path: '/stand/pos',
        element: (
          <RouteErrorBoundary routeName="Stand POS">
            <StandPOS />
          </RouteErrorBoundary>
        ),
      },
      {
        path: '/stand/sales',
        element: (
          <RouteErrorBoundary routeName="Stand Sales History">
            <StandSalesHistory />
          </RouteErrorBoundary>
        ),
      },
      {
        path: '/stand/reports',
        element: (
          <RouteErrorBoundary routeName="Stand Reports">
            <StandReports />
          </RouteErrorBoundary>
        ),
      },

      // ============================================================
      // MESSAGING & APPOINTMENTS
      // ============================================================

      // Daily Appointments (Hybrid: Loader + SSE)
      {
        path: '/appointments',
        element: (
          <RouteErrorBoundary routeName="Daily Appointments">
            <DailyAppointments />
          </RouteErrorBoundary>
        ),
        loader: withPreload(DailyAppointments, dailyAppointmentsLoader), // Pre-fetch initial data + chunk
      },

      // Monthly Calendar (100% SSE-driven)
      {
        path: '/calendar',
        element: (
          <RouteErrorBoundary routeName="Calendar">
            <Calendar />
          </RouteErrorBoundary>
        ),
        // No loader - 100% SSE-driven real-time data
      },

      // WhatsApp Send (100% SSE-driven)
      {
        path: '/send',
        element: (
          <RouteErrorBoundary routeName="WhatsApp Send">
            <WhatsAppSend />
          </RouteErrorBoundary>
        ),
        // No loader - 100% SSE-driven real-time data
      },

      // Send Message (100% SSE-driven)
      {
        path: '/send-message',
        element: (
          <RouteErrorBoundary routeName="Send Message">
            <SendMessage />
          </RouteErrorBoundary>
        ),
        // No loader - 100% SSE-driven real-time data
      },

      // WhatsApp Authentication (100% SSE-driven)
      {
        path: '/auth',
        element: (
          <RouteErrorBoundary routeName="WhatsApp Auth">
            <WhatsAppAuth />
          </RouteErrorBoundary>
        ),
        // No loader - 100% SSE-driven real-time data
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
