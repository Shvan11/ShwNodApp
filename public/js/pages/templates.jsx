/**
 * Templates Page Entry Point
 * Mounts the React Template Management App
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import TemplateApp from '../apps/TemplateApp.jsx';

// Name this window so tabManager can reuse it
window.name = 'clinic_templates';

// Register this tab with heartbeat system

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <TemplateApp />
    </React.StrictMode>
);
