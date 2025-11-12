import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import StatisticsComponent from '../components/react/StatisticsComponent.jsx';
import tabManager from '../utils/tab-manager.js';

// Name this window so tabManager can reuse it
window.name = 'clinic_statistics';

// Register this tab with heartbeat system
tabManager.register('statistics');

// Mount the React app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <StatisticsComponent />
        </BrowserRouter>
    </React.StrictMode>
);
