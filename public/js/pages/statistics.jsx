import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import StatisticsComponent from '../components/react/StatisticsComponent.jsx';

// Mount the React app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <StatisticsComponent />
        </BrowserRouter>
    </React.StrictMode>
);
