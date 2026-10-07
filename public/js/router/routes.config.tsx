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
import RootLayout, { LoadingFallback } from '../layouts/RootLayout';
import AlignerLayout from '../layouts/AlignerLayout';

import { lazyWithPreload } from './lazyWithPreload';

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
 * Every route screen is its own chunk, and every route loader awaits that chunk
 * (see `withPreload`), so a screen mounts already loaded: no Suspense fallback,
 * and so none of React's 300 ms fallback throttle. `lazyWithPreload` has the why.
 */
const lazyRoute = lazyWithPreload;

/**
 * Wrap a route loader so the route's chunk downloads *in parallel* with the
 * loader's data and the navigation commits once both are in. The chunk is
 * awaited, not just started: a screen that mounts before its chunk has settled
 * suspends, and the fallback it shows then costs 300 ms (audit FE-F26-3). Adds no
 * request: the chunk loads anyway. `preload()` never rejects, so a chunk that
 * cannot load still fails on the render path, where the self-heal lives.
 */
function withPreload(
  component: { preload: () => Promise<void> },
  loader: LoaderFunction
): LoaderFunction {
  return async (args) => {
    const chunk = component.preload();
    const data: unknown = await loader(args);
    await chunk;
    return data;
  };
}

/**
 * The route fields for a screen with no data loader of its own: wait for the
 * chunk on the way in, and never again. `shouldRevalidate: false` matters. A
 * route with a loader navigates asynchronously, and these screens change their
 * own `?query` as the user types and filters; without it every such change would
 * re-run the loader and turn a synchronous URL update into an asynchronous one.
 */
function chunkLoader(component: { preload: () => Promise<void> }): Pick<
  RouteObject,
  'loader' | 'shouldRevalidate'
> {
  return {
    loader: async () => {
      await component.preload();
      return null;
    },
    shouldRevalidate: () => false,
  };
}

/**
 * What a route shows while its first loader runs on a cold load (React Router's
 * `hydrateFallbackElement`): the same spinner the Suspense fallback draws, inside
 * the layout, so the header paints at once and the page swaps in when its chunk
 * and data arrive. Added to every route that has a loader.
 */
function withHydrateFallback(routes: RouteObject[]): RouteObject[] {
  return routes.map((route): RouteObject => {
    const fallback =
      route.loader && route.hydrateFallbackElement === undefined
        ? { hydrateFallbackElement: <LoadingFallback /> }
        : {};
    // An index route has no children (and the two shapes are a union, so each
    // branch is rebuilt as its own type).
    if (route.index) return { ...route, ...fallback };
    return {
      ...route,
      ...fallback,
      ...(route.children ? { children: withHydrateFallback(route.children) } : {}),
    };
  });
}

// Lazy-loaded route components - Core routes
const Dashboard = lazyRoute(() => import('../routes/Dashboard'));
const Statistics = lazyRoute(() => import('../routes/Statistics'));
const Expenses = lazyRoute(() => import('../routes/Expenses'));
const Videos = lazyRoute(() => import('../routes/Videos'));
const PatientManagement = lazyRoute(() => import('../routes/PatientManagement'));
const TasksHistory = lazyRoute(() => import('../routes/TasksHistory'));
const ApprovalsHistory = lazyRoute(() => import('../routes/ApprovalsHistory'));

// Lazy-loaded route components - Settings & Templates
const SettingsComponent = lazyRoute(() => import('../components/react/SettingsComponent'));
const TemplateManagement = lazyRoute(
  () => import('../components/templates/TemplateManagement')
);
const TemplateDesigner = lazyRoute(() => import('../components/templates/TemplateDesigner'));

// Lazy-loaded route components - Lab case tracker
const LabTracking = lazyRoute(() => import('../routes/LabTracking'));

// Lazy-loaded route components - Aligner
const DoctorsList = lazyRoute(() => import('../pages/aligner/DoctorsList'));
const PatientsList = lazyRoute(() => import('../pages/aligner/PatientsList'));
const PatientSets = lazyRoute(() => import('../pages/aligner/PatientSets'));
const SearchPatient = lazyRoute(() => import('../pages/aligner/SearchPatient'));
const AllSetsList = lazyRoute(() => import('../pages/aligner/AllSetsList'));
const ArchformMatcher = lazyRoute(() => import('../pages/aligner/ArchformMatcher'));
const Announcements = lazyRoute(() => import('../pages/aligner/Announcements'));

// Lazy-loaded route components - Patient
const PatientShell = lazyRoute(() => import('../components/react/PatientShell'));

// Lazy-loaded route components - Chair-side public display (open access, no auth)
const ChairDisplay = lazyRoute(() => import('../routes/ChairDisplay'));

// Lazy-loaded route components - Stand / Mini Pharmacy
const Stand = lazyRoute(() => import('../routes/Stand'));
const StandInventory = lazyRoute(() => import('../routes/StandInventory'));
const StandPOS = lazyRoute(() => import('../routes/StandPOS'));
const StandSalesHistory = lazyRoute(() => import('../routes/StandSalesHistory'));
const StandReports = lazyRoute(() => import('../routes/StandReports'));

// Lazy-loaded route components - Appointments & WhatsApp
const DailyAppointments = lazyRoute(() => import('../routes/DailyAppointments'));
const Calendar = lazyRoute(() => import('../routes/Calendar'));
const WhatsAppSend = lazyRoute(() => import('../routes/WhatsAppSend'));
const SendMessage = lazyRoute(() => import('../components/react/SendMessage'));
const WhatsAppAuth = lazyRoute(() => import('../routes/WhatsAppAuth'));

/**
 * Route configuration array for createBrowserRouter
 * Each route object includes: path, element, loader (optional), errorElement
 */
const routes: RouteObject[] = [
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
    ...chunkLoader(ChairDisplay),
    // No layout above the kiosk to draw a spinner in: stay blank, as before.
    hydrateFallbackElement: <div />,
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
        ...chunkLoader(Dashboard),
      },

      // Dashboard (explicit path)
      {
        path: '/dashboard',
        element: (
          <RouteErrorBoundary routeName="Dashboard">
            <Dashboard />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(Dashboard),
      },

      // Statistics
      {
        path: '/statistics',
        element: (
          <RouteErrorBoundary routeName="Statistics">
            <Statistics />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(Statistics),
      },

      // Expenses
      {
        path: '/expenses',
        element: (
          <RouteErrorBoundary routeName="Expenses">
            <Expenses />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(Expenses),
      },

      // Videos (educational content)
      {
        path: '/videos',
        element: (
          <RouteErrorBoundary routeName="Videos">
            <Videos />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(Videos),
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
        ...chunkLoader(TasksHistory),
      },

      // Decided approvals + notices (admin; linked from the Approvals bell)
      {
        path: '/approvals/history',
        element: (
          <RouteErrorBoundary routeName="Approval History">
            <ApprovalsHistory />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(ApprovalsHistory),
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
            ...chunkLoader(SettingsComponent),
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
            ...chunkLoader(AllSetsList),
            // No loader - loads data in component (complex filtering)
          },
          {
            path: 'doctor/:doctorId',
            element: (
              <RouteErrorBoundary routeName="Patients List">
                <PatientsList />
              </RouteErrorBoundary>
            ),
            ...chunkLoader(PatientsList),
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
            ...chunkLoader(SearchPatient),
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
            ...chunkLoader(ArchformMatcher),
            // No loader - loads data in component
          },
          {
            path: 'announcements',
            element: (
              <RouteErrorBoundary routeName="Announcements">
                <Announcements />
              </RouteErrorBoundary>
            ),
            ...chunkLoader(Announcements),
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
              <RouteErrorBoundary routeName="patient record">
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
        ...chunkLoader(Stand),
      },
      {
        path: '/stand/inventory',
        element: (
          <RouteErrorBoundary routeName="Stand Inventory">
            <StandInventory />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(StandInventory),
      },
      {
        path: '/stand/pos',
        element: (
          <RouteErrorBoundary routeName="Stand POS">
            <StandPOS />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(StandPOS),
      },
      {
        path: '/stand/sales',
        element: (
          <RouteErrorBoundary routeName="Stand Sales History">
            <StandSalesHistory />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(StandSalesHistory),
      },
      {
        path: '/stand/reports',
        element: (
          <RouteErrorBoundary routeName="Stand Reports">
            <StandReports />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(StandReports),
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
        // The loader only warms the first paint; after that the page's own query,
        // keyed by the date, does the fetching. Re-running the loader on every
        // `?date=`/`?dr=` change fetched the day a second time (a doctor-filter
        // change refetched it too; audit FE-F11-12).
        shouldRevalidate: ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
          currentUrl.pathname !== nextUrl.pathname ? defaultShouldRevalidate : false,
      },

      // Monthly Calendar
      {
        path: '/calendar',
        element: (
          <RouteErrorBoundary routeName="Calendar">
            <Calendar />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(Calendar),
        // No loader — the screen fetches through React Query on mount
        // (calendarRangeQuery/calendarMonthQuery). It subscribes
        // to NO SSE and has no refetchInterval, so every appointment write — from
        // here or from any patient screen — must invalidate `qk.calendar.all()`
        // itself. (This comment used to read "100% SSE-driven", which is why five
        // write sites shipped with no calendar invalidation at all.)
      },

      // WhatsApp Send (100% SSE-driven)
      {
        path: '/send',
        element: (
          <RouteErrorBoundary routeName="WhatsApp Send">
            <WhatsAppSend />
          </RouteErrorBoundary>
        ),
        ...chunkLoader(WhatsAppSend),
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
        ...chunkLoader(SendMessage),
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
        ...chunkLoader(WhatsAppAuth),
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

export const routesConfig: RouteObject[] = withHydrateFallback(routes);

export default routesConfig;
