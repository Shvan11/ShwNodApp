/**
 * Unified React Application
 * Single monolithic React app with one BrowserRouter and all routes
 *
 * This replaces the previous single-spa micro-frontend architecture
 * with a traditional React application structure.
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GlobalStateProvider } from '/single-spa/contexts/GlobalStateContext.jsx';
import UniversalHeader from './components/react/UniversalHeader.jsx';

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
    <GlobalStateProvider>
      {/* Persistent header - always mounted */}
      <div id="universal-header-root">
        <UniversalHeader />
      </div>

      {/* Main application content */}
      <div id="app-container">
        <Routes>
          {/* Dashboard - Landing page */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Patient Portal - Nested routes */}
          <Route path="/patient/*" element={<PatientRoutes />} />

          {/* Patient Management - Search and grid */}
          <Route path="/patient-management" element={<PatientManagement />} />

          {/* Appointments */}
          <Route path="/appointments" element={<DailyAppointments />} />
          <Route path="/calendar" element={<Calendar />} />

          {/* WhatsApp Messaging */}
          <Route path="/send" element={<WhatsAppSend />} />
          <Route path="/auth" element={<WhatsAppAuth />} />

          {/* Aligner Management - Nested routes */}
          <Route path="/aligner/*" element={<AlignerRoutes />} />

          {/* Expenses */}
          <Route path="/expenses" element={<Expenses />} />

          {/* Settings - Nested routes */}
          <Route path="/settings/*" element={<SettingsRoutes />} />

          {/* Templates - Nested routes */}
          <Route path="/templates/*" element={<TemplateRoutes />} />

          {/* Financial Statistics */}
          <Route path="/statistics" element={<Statistics />} />

          {/* Fallback - redirect to dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </GlobalStateProvider>
  );
}
