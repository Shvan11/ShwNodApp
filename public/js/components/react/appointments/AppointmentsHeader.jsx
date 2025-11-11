import React from 'react';
import ConnectionStatus from './ConnectionStatus.jsx';

/**
 * AppointmentsHeader Component
 * Header with title, date picker, and connection status
 */
const AppointmentsHeader = ({ selectedDate, onDateChange, connectionStatus, showFlash }) => {
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
            <div className="date-picker-container">
                <div className="date-picker-left">
                    <label htmlFor="date-picker">Select Date:</label>
                    <input
                        type="date"
                        id="date-picker"
                        value={selectedDate}
                        onChange={(e) => onDateChange(e.target.value)}
                    />
                </div>
            </div>
            <ConnectionStatus status={connectionStatus} showFlash={showFlash} />
        </div>
    );
};

export default AppointmentsHeader;
