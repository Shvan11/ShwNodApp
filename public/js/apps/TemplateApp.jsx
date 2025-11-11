/**
 * Template Management Application
 * React-based template designer and management system using GrapesJS
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import TemplateManagement from '../components/templates/TemplateManagement.jsx';
import TemplateDesigner from '../components/templates/TemplateDesigner.jsx';
import UniversalHeader from '../components/react/UniversalHeader.jsx';

const TemplateApp = () => {
    return (
        <Router>
            <div id="app">
                <UniversalHeader />
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

export default TemplateApp;
