// PatientManagementApp.jsx - Patient Search and Management
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { BrowserRouter } from 'react-router-dom';
import PatientManagement from '../components/react/PatientManagement.jsx';

/**
 * Patient Management Application
 * Provides patient search, grid view, and quick access to patient records
 *
 * Route: /patient-management
 */
const PatientManagementApp = () => {
    return (
        <BrowserRouter>
            <PatientManagement />
        </BrowserRouter>
    );
};


// Single-SPA Lifecycle - React 18 Compatible
const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: PatientManagementApp,
    renderType: 'createRoot',
    domElementGetter: () => {
        let el = document.getElementById('patient-management-app-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'patient-management-app-container';
            document.getElementById('app-container')?.appendChild(el) || document.body.appendChild(el);
        }
        return el;
    },
    errorBoundary(err, info, props) {
        console.error('[PatientManagementApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Patient Management Error</h2>
                <p>Failed to load patient management. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount } = lifecycles;
