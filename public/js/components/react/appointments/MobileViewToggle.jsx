import React from 'react';

/**
 * MobileViewToggle Component
 * Toggle between "All Appointments" and "Checked-In" views on mobile
 */
const MobileViewToggle = ({ activeView, onViewChange }) => {
    return (
        <div className="mobile-view-toggle">
            <button
                className={`toggle-btn ${activeView === 'all' ? 'active' : ''}`}
                data-view="all"
                onClick={() => onViewChange('all')}
            >
                <i className="fas fa-calendar-alt"></i>
                <span>All</span>
            </button>
            <button
                className={`toggle-btn ${activeView === 'checked-in' ? 'active' : ''}`}
                data-view="checked-in"
                onClick={() => onViewChange('checked-in')}
            >
                <i className="fas fa-user-check"></i>
                <span>Checked-In</span>
            </button>
        </div>
    );
};

export default MobileViewToggle;
