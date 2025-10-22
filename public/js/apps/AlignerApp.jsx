// AlignerApp.jsx - Aligner Management Router (LOCAL APP)
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DoctorsList from '../pages/aligner/DoctorsList.jsx';
import PatientsList from '../pages/aligner/PatientsList.jsx';
import PatientSets from '../pages/aligner/PatientSets.jsx';
import SearchPatient from '../pages/aligner/SearchPatient.jsx';

/**
 * Aligner Management Application with React Router
 *
 * Routes:
 * - /aligner → Doctors list
 * - /aligner/doctor/:doctorId → Doctor's patients list
 * - /aligner/doctor/:doctorId/patient/:workId → Patient's aligner sets
 * - /aligner/search → Search interface
 * - /aligner/patient/:workId → Direct patient access from search
 */
const AlignerApp = () => {
    return (
        <BrowserRouter>
            <Routes>
                {/* Doctors List */}
                <Route path="/aligner" element={<DoctorsList />} />

                {/* Doctor's Patients List */}
                <Route path="/aligner/doctor/:doctorId" element={<PatientsList />} />

                {/* Patient's Aligner Sets (from doctor browse) */}
                <Route path="/aligner/doctor/:doctorId/patient/:workId" element={<PatientSets />} />

                {/* Search Interface */}
                <Route path="/aligner/search" element={<SearchPatient />} />

                {/* Patient's Aligner Sets (from search) */}
                <Route path="/aligner/patient/:workId" element={<PatientSets />} />

                {/* Redirect unknown routes to default */}
                <Route path="*" element={<Navigate to="/aligner" replace />} />
            </Routes>
        </BrowserRouter>
    );
};

export default AlignerApp;
