// AlignerLayout.jsx - Layout wrapper for aligner section with persistent mode toggle
import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';

// Aligner section CSS (loaded when any aligner route is visited)
import '../../css/pages/aligner.css';
import '../../css/components/aligner-set-card.css';
import '../../css/components/aligner-drawer-form.css';
import AlignerModeToggle from '../components/react/AlignerModeToggle.jsx';

/**
 * Layout component for aligner section
 * Renders the mode toggle once at the layout level so it doesn't re-render on navigation
 */
const AlignerLayout = () => {
    const location = useLocation();

    // Determine active mode based on current route
    const getActiveMode = () => {
        if (location.pathname.includes('/search')) {
            return 'search';
        } else if (location.pathname.includes('/all-sets')) {
            return 'all-sets';
        } else {
            return 'doctors';
        }
    };

    return (
        <div className="aligner-container">
            <AlignerModeToggle activeMode={getActiveMode()} />
            <Outlet />
        </div>
    );
};

export default AlignerLayout;
