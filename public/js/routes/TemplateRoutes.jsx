import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import TemplateManagement from '../components/templates/TemplateManagement.jsx';
import TemplateDesigner from '../components/templates/TemplateDesigner.jsx';

// Template management styles
import '../../css/pages/template-management.css';
import '../../css/pages/template-designer.css';

/**
 * Template Management Routes
 *
 * Routes:
 * - /templates → Template management list
 * - /templates/designer/:templateId → Edit existing template
 * - /templates/designer → Create new template
 */
export default function TemplateRoutes() {
  return (
    <div id="app">
      <Routes>
        <Route path="/" element={<TemplateManagement />} />
        <Route path="/designer/:templateId" element={<TemplateDesigner />} />
        <Route path="/designer" element={<TemplateDesigner />} />
        <Route path="*" element={<Navigate to="/templates" replace />} />
      </Routes>
    </div>
  );
}
