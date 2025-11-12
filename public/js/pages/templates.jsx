/**
 * Templates Page Entry Point
 * Mounts the React Template Management App
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import TemplateApp from '../apps/TemplateApp.jsx';
import tabManager from '../utils/tab-manager.js';

// Name this window so tabManager can reuse it
window.name = 'clinic_templates';

// Register this tab with heartbeat system
tabManager.register('templates');

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <TemplateApp />
    </React.StrictMode>
);
