import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AlignerLayout from '../layouts/AlignerLayout.jsx';
import DoctorsList from '../pages/aligner/DoctorsList.jsx';
import PatientsList from '../pages/aligner/PatientsList.jsx';
import PatientSets from '../pages/aligner/PatientSets.jsx';
import SearchPatient from '../pages/aligner/SearchPatient.jsx';
import AllSetsList from '../pages/aligner/AllSetsList.jsx';

/**
 * Aligner Management Routes
 *
 * Uses AlignerLayout wrapper to prevent mode toggle from re-rendering on navigation
 *
 * Routes:
 * - /aligner → Doctors list
 * - /aligner/all-sets → All sets overview with v_allsets data
 * - /aligner/doctor/:doctorId → Doctor's patients list
 * - /aligner/doctor/:doctorId/patient/:workId → Patient's aligner sets
 * - /aligner/search → Search interface
 * - /aligner/patient/:workId → Direct patient access from search
 */
export default function AlignerRoutes() {
  return (
    <Routes>
      <Route element={<AlignerLayout />}>
        {/* Doctors List */}
        <Route path="/" element={<DoctorsList />} />

        {/* All Sets Overview */}
        <Route path="/all-sets" element={<AllSetsList />} />

        {/* Doctor's Patients List */}
        <Route path="/doctor/:doctorId" element={<PatientsList />} />

        {/* Patient's Aligner Sets (from doctor browse) */}
        <Route path="/doctor/:doctorId/patient/:workId" element={<PatientSets />} />

        {/* Search Interface */}
        <Route path="/search" element={<SearchPatient />} />

        {/* Patient's Aligner Sets (from search) */}
        <Route path="/patient/:workId" element={<PatientSets />} />

        {/* Redirect unknown routes to default */}
        <Route path="*" element={<Navigate to="/aligner" replace />} />
      </Route>
    </Routes>
  );
}
