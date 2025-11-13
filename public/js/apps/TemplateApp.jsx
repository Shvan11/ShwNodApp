/**
 * Template Management Application
 * React-based template designer and management system using GrapesJS
 *
 * Note: Uses shared history instance for consistent navigation across all apps
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';
import { Router } from 'react-router';
import { Routes, Route, Navigate } from 'react-router-dom';
import { sharedHistory } from '/single-spa/shared-history.js';
import TemplateManagement from '../components/templates/TemplateManagement.jsx';
import TemplateDesigner from '../components/templates/TemplateDesigner.jsx';

const TemplateApp = () => {
    return (
        <Router location={sharedHistory.location} navigator={sharedHistory}>
            <div id="app">
                <Routes>
                    <Route path="/templates" element={<TemplateManagement />} />
                    <Route path="/templates/designer/:templateId" element={<TemplateDesigner />} />
                    <Route path="/templates/designer" element={<TemplateDesigner />} />
                    <Route path="*" element={<Navigate to="/templates" replace />} />
                </Routes>
            </div>
        </Router>
    );
};

// Single-SPA Lifecycle Exports

const lifecycles = singleSpaReact({
    React,
    ReactDOM,
    rootComponent: TemplateApp,
    renderType: 'createRoot', // React 18 API
  domElementGetter: () => {
    let el = document.getElementById('template-app-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'template-app-container';
      document.getElementById('app-container')?.appendChild(el) || document.body.appendChild(el);
    }
    return el;
  },
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
