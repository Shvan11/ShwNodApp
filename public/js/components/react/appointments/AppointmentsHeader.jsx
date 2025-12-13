import React from 'react';
import ConnectionStatus from './ConnectionStatus.jsx';

/**
 * AppointmentsHeader Component
 * Header with title, date picker, refresh button, search box, and connection status
 */
const AppointmentsHeader = ({ selectedDate, onDateChange, onRefresh, isRefreshing, searchTerm, onSearchChange, connectionStatus, showFlash }) => {
    // Format date for display
    const formatDateForDisplay = (dateString) => {
        if (!dateString) return 'Today';

        const date = new Date(dateString + 'T12:00:00'); // Add time to avoid timezone issues
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <div className="header-section">
            <h1 id="title">Appointments for {formatDateForDisplay(selectedDate)}</h1>
            <div className="header-controls">
                <div className="date-picker-container">
                    <div className="date-picker-left">
                        <label htmlFor="date-picker">Select Date:</label>
                        <input
                            type="date"
                            id="date-picker"
                            value={selectedDate}
                            onChange={(e) => onDateChange(e.target.value)}
                        />
                        <button
                            className="btn-refresh"
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            title="Refresh today's appointments"
                        >
                            <i className={`fas fa-sync-alt ${isRefreshing ? 'spinning' : ''}`}></i>
                        </button>
                    </div>
                </div>
                <div className="search-input-wrapper">
                    <i className="fas fa-search search-icon"></i>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search patient..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            className="search-clear"
                            onClick={() => onSearchChange('')}
                            title="Clear search"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            </div>
            <ConnectionStatus status={connectionStatus} showFlash={showFlash} />
        </div>
    );
};

export default AppointmentsHeader;
