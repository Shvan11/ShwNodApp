import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PatientShell from '../components/react/PatientShell.jsx';

/**
 * Patient Portal Routes
 *
 * Routes:
 * - /patient/:patientId/works → Patient works/treatment records
 * - /patient/:patientId/grid → Patient photos grid
 * - /patient/:patientId/compare → Photo comparison view
 * - /patient/:patientId/xrays → X-rays view
 * - /patient/:patientId/visits → Visit summary (with ?workId query param)
 * - /patient/:patientId/new-visit → New visit form (with ?workId query param)
 * - /patient/:patientId/payments → Payment records
 * - /patient/:patientId/new-appointment → New appointment form
 * - /patient/:patientId/edit-appointment/:appointmentId → Edit appointment
 * - /patient/:patientId/edit → Edit patient information
 */
export default function PatientRoutes() {
  return (
    <Routes>
      {/* Patient routes with page parameter - handles both simple and nested pages */}
      <Route path=":patientId/:page/*" element={<PatientShell />} />

      {/* Default patient route - redirect to works page */}
      <Route path=":patientId" element={<Navigate to="works" replace />} />

      {/* Redirect unknown routes to patient management */}
      <Route path="*" element={<Navigate to="/patient-management" replace />} />
    </Routes>
  );
}
