import { registerApplication, start } from 'single-spa';

/**
 * Single-SPA Root Configuration
 *
 * This file orchestrates all micro-frontends (apps) in the Shwan Orthodontics
 * practice management system. Each app is registered with:
 * - A unique name (@clinic/app-name)
 * - A loader function (imports the app)
 * - An activity function (determines when app is active based on route)
 */

console.log('[Single-SPA] Initializing root configuration');

/**
 * App Registry - All 9 micro-apps
 */
const apps = [
  {
    name: '@clinic/dashboard',
    app: () => import('/js/apps/DashboardApp.jsx'),
    activeWhen: (location) => location.pathname === '/' || location.pathname === '/dashboard',
  },
  {
    name: '@clinic/patient',
    app: () => import('/js/apps/PatientApp.jsx'),
    activeWhen: (location) => location.pathname.startsWith('/patient'),
  },
  {
    name: '@clinic/expenses',
    app: () => import('/js/apps/ExpensesApp.jsx'),
    activeWhen: (location) => location.pathname === '/expenses',
  },
  {
    name: '@clinic/whatsapp-send',
    app: () => import('/js/apps/WhatsAppSendApp.jsx'),
    activeWhen: (location) => location.pathname === '/send',
  },
  {
    name: '@clinic/whatsapp-auth',
    app: () => import('/js/apps/WhatsAppAuthApp.jsx'),
    activeWhen: (location) => location.pathname === '/auth',
  },
  {
    name: '@clinic/aligner',
    app: () => import('/js/apps/AlignerApp.jsx'),
    activeWhen: (location) => location.pathname.startsWith('/aligner'),
  },
  {
    name: '@clinic/settings',
    app: () => import('/js/apps/SettingsApp.jsx'),
    activeWhen: (location) => location.pathname.startsWith('/settings'),
  },
  {
    name: '@clinic/templates',
    app: () => import('/js/apps/TemplateApp.jsx'),
    activeWhen: (location) => location.pathname.startsWith('/templates'),
  },
  {
    name: '@clinic/appointments',
    app: () => import('/js/apps/DailyAppointmentsApp.jsx'),
    activeWhen: (location) => location.pathname === '/appointments',
  },
];

/**
 * Register all applications with single-spa
 */
apps.forEach((appConfig) => {
  console.log(`[Single-SPA] Registering ${appConfig.name}`);

  registerApplication({
    name: appConfig.name,
    app: appConfig.app,
    activeWhen: appConfig.activeWhen,
    customProps: {
      // Props passed to all apps
      domElement: null, // Will be set by single-spa-react
    },
  });
});

/**
 * Start single-spa routing system
 *
 * Options:
 * - urlRerouteOnly: Only reroute on URL changes (more performant)
 */
start({
  urlRerouteOnly: true,
});

console.log('[Single-SPA] Root configuration complete - all apps registered');

/**
 * Handle navigation errors
 */
window.addEventListener('single-spa:routing-event', (evt) => {
  console.log('[Single-SPA] Routing event:', {
    oldUrl: evt.detail.oldUrl,
    newUrl: evt.detail.newUrl,
    navigationIsCanceled: evt.detail.navigationIsCanceled,
  });
});

window.addEventListener('single-spa:app-change', (evt) => {
  console.log('[Single-SPA] App change:', {
    appsByNewStatus: evt.detail.appsByNewStatus,
    totalAppChanges: evt.detail.totalAppChanges,
  });
});

// Error handling for mount failures
window.addEventListener('single-spa:before-app-change', (evt) => {
  console.log('[Single-SPA] Before app change');
});

// Log any routing errors
window.addEventListener('single-spa:routing-error', (evt) => {
  console.error('[Single-SPA] Routing error:', evt.detail);
});
