/**
 * Template Management Application
 * React-based template designer and management system using GrapesJS
 *
 * Note: BrowserRouter is provided by index.html at root level
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
