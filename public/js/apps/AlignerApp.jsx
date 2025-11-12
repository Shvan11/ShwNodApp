// AlignerApp.jsx - Aligner Management Router (LOCAL APP)
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DoctorsList from '../pages/aligner/DoctorsList.jsx';
import PatientsList from '../pages/aligner/PatientsList.jsx';
import PatientSets from '../pages/aligner/PatientSets.jsx';
import SearchPatient from '../pages/aligner/SearchPatient.jsx';
import AllSetsList from '../pages/aligner/AllSetsList.jsx';

/**
 * Aligner Management Application with React Router
 *
 * Routes:
 * - /aligner → Doctors list
 * - /aligner/all-sets → All sets overview with v_allsets data
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

                {/* All Sets Overview */}
                <Route path="/aligner/all-sets" element={<AllSetsList />} />

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

// Single-SPA Lifecycle Exports

const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: AlignerApp,
    renderType: 'createRoot', // React 18 API
  domElementGetter: () => {
    let el = document.getElementById('aligner-app-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aligner-app-container';
      document.getElementById('app-container')?.appendChild(el) || document.body.appendChild(el);
    }
    return el;
  },
    errorBoundary(err, info, props) {
        console.error('[AlignerApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Aligner Management Error</h2>
                <p>Failed to load aligner management. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
