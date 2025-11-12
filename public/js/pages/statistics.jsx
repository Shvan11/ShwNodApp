import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import StatisticsComponent from '../components/react/StatisticsComponent.jsx';

// Name this window so tabManager can reuse it
window.name = 'clinic_statistics';

// Register this tab with heartbeat system

// Mount the React app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <StatisticsComponent />
        </BrowserRouter>
    </React.StrictMode>
);
