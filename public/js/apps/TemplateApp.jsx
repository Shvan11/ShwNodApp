/**
 * Template Management Application
 * React-based template designer and management system using GrapesJS
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import TemplateManagement from '../components/templates/TemplateManagement.jsx';
import TemplateDesigner from '../components/templates/TemplateDesigner.jsx';

const TemplateApp = () => {
    return (
        <div id="app">
            <Routes>
                <Route path="/templates" element={<TemplateManagement />} />
                <Route path="/templates/designer/:templateId" element={<TemplateDesigner />} />
                <Route path="/templates/designer" element={<TemplateDesigner />} />
                <Route path="*" element={<Navigate to="/templates" replace />} />
            </Routes>
        </div>
    );
};

// Single-SPA Lifecycle Exports
const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: TemplateApp,
    errorBoundary(err, info, props) {
        console.error('[TemplateApp] Error:', err);
        return (
            <div className="error-boundary">
                <h2>Template Error</h2>
                <p>Failed to load template management. Please refresh the page.</p>
            </div>
        );
    },
});

export const { bootstrap, mount, unmount} = lifecycles;
export default TemplateApp;
