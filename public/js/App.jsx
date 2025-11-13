/**
 * Unified React Application
 * Single monolithic React app with one BrowserRouter and all routes
 *
 * This replaces the previous single-spa micro-frontend architecture
 * with a traditional React application structure.
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GlobalStateProvider } from './contexts/GlobalStateContext.jsx';
import UniversalHeader from './components/react/UniversalHeader.jsx';
import { GlobalErrorBoundary } from './components/error-boundaries/GlobalErrorBoundary.jsx';
import { RouteErrorBoundary } from './components/error-boundaries/RouteErrorBoundary.jsx';

// Import all route components
import Dashboard from './routes/Dashboard.jsx';
import PatientRoutes from './routes/PatientRoutes.jsx';
import Expenses from './routes/Expenses.jsx';
import WhatsAppSend from './routes/WhatsAppSend.jsx';
import WhatsAppAuth from './routes/WhatsAppAuth.jsx';
import AlignerRoutes from './routes/AlignerRoutes.jsx';
import SettingsRoutes from './routes/SettingsRoutes.jsx';
import TemplateRoutes from './routes/TemplateRoutes.jsx';
import DailyAppointments from './routes/DailyAppointments.jsx';
import PatientManagement from './routes/PatientManagement.jsx';
import Calendar from './routes/Calendar.jsx';
import Statistics from './routes/Statistics.jsx';

/**
 * Main Application Component
 *
 * Structure:
 * - GlobalStateProvider: Shared state (WebSocket, patient, appointments)
 * - UniversalHeader: Persistent header (always visible)
 * - Routes: All application routes in a single routing configuration
 */
export default function App() {
  return (
    <GlobalErrorBoundary>
      <GlobalStateProvider>
        {/* Persistent header - always mounted */}
        <div id="universal-header-root">
          <UniversalHeader />
        </div>

        {/* Main application content */}
        <div id="app-container">
          <Routes>
            {/* Dashboard - Landing page */}
            <Route
              path="/"
              element={
                <RouteErrorBoundary routeName="Dashboard">
                  <Dashboard />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RouteErrorBoundary routeName="Dashboard">
                  <Dashboard />
                </RouteErrorBoundary>
              }
            />

            {/* Patient Portal - Nested routes */}
            <Route
              path="/patient/*"
              element={
                <RouteErrorBoundary routeName="Patient Portal">
                  <PatientRoutes />
                </RouteErrorBoundary>
              }
            />

            {/* Patient Management - Search and grid */}
            <Route
              path="/patient-management"
              element={
                <RouteErrorBoundary routeName="Patient Management">
                  <PatientManagement />
                </RouteErrorBoundary>
              }
            />

            {/* Appointments */}
            <Route
              path="/appointments"
              element={
                <RouteErrorBoundary routeName="Daily Appointments">
                  <DailyAppointments />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/calendar"
              element={
                <RouteErrorBoundary routeName="Calendar">
                  <Calendar />
                </RouteErrorBoundary>
              }
            />

            {/* WhatsApp Messaging */}
            <Route
              path="/send"
              element={
                <RouteErrorBoundary routeName="WhatsApp Send">
                  <WhatsAppSend />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/auth"
              element={
                <RouteErrorBoundary routeName="WhatsApp Auth">
                  <WhatsAppAuth />
                </RouteErrorBoundary>
              }
            />

            {/* Aligner Management - Nested routes */}
            <Route
              path="/aligner/*"
              element={
                <RouteErrorBoundary routeName="Aligner Management">
                  <AlignerRoutes />
                </RouteErrorBoundary>
              }
            />

            {/* Expenses */}
            <Route
              path="/expenses"
              element={
                <RouteErrorBoundary routeName="Expenses">
                  <Expenses />
                </RouteErrorBoundary>
              }
            />

            {/* Settings - Nested routes */}
            <Route
              path="/settings/*"
              element={
                <RouteErrorBoundary routeName="Settings">
                  <SettingsRoutes />
                </RouteErrorBoundary>
              }
            />

            {/* Templates - Nested routes */}
            <Route
              path="/templates/*"
              element={
                <RouteErrorBoundary routeName="Templates">
                  <TemplateRoutes />
                </RouteErrorBoundary>
              }
            />

            {/* Financial Statistics */}
            <Route
              path="/statistics"
              element={
                <RouteErrorBoundary routeName="Statistics">
                  <Statistics />
                </RouteErrorBoundary>
              }
            />

            {/* Fallback - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </GlobalStateProvider>
    </GlobalErrorBoundary>
  );
}
