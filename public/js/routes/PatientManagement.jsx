import React from 'react';
import PatientManagement from '../components/react/PatientManagement.jsx';

// Patient management styles
import '../../css/pages/patient-management.css';
import '../../css/pages/grid.css';

/**
 * Patient Management Route
 * Provides patient search, grid view, and quick access to patient records
 */
export default function PatientManagementRoute() {
  return <PatientManagement />;
}
