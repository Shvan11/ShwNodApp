/**
 * Date Selector Component
 * Dropdown for selecting appointment date with controls
 */
import React from 'react';

export default function DateSelector({ currentDate, dateOptions, onDateChange, displayMessage, onRefresh, onReset, onSendEmail, loading }) {
    const handleRefreshClick = async (e) => {
        e.preventDefault();
        if (onRefresh) await onRefresh();
    };

    const handleResetClick = async (e) => {
        e.preventDefault();
        if (onReset) await onReset();
    };

    const handleSendEmailClick = async (e) => {
        e.preventDefault();
        if (onSendEmail) await onSendEmail();
    };

    return (
        <section className="controls-area">
            <fieldset className="date-selection-panel">
                <legend className="sr-only">Date and Message Controls</legend>
                <div className="date-controls">
                    <label htmlFor="dateSelector">Select Date:</label>
                    <select
                        id="dateSelector"
                        className="date-dropdown"
                        value={currentDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        aria-label="Select date for messaging"
                        aria-describedby="messageCount"
                    >
                        {dateOptions.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <button
                        id="refreshDateBtn"
                        className="btn btn-secondary"
                        onClick={handleRefreshClick}
                        disabled={loading}
                        aria-label="Refresh message count for selected date"
                    >
                        <span className="btn-icon" aria-hidden="true">🔄</span>
                        <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                    </button>
                    <button
                        id="resetMessagingBtn"
                        className="btn btn-danger"
                        onClick={handleResetClick}
                        disabled={loading}
                        aria-label="Reset all messages for selected date"
                    >
                        <span className="btn-icon" aria-hidden="true">🔄</span>
                        <span>Reset Messages</span>
                    </button>
                    <button
                        id="sendEmailBtn"
                        className="btn btn-success"
                        onClick={handleSendEmailClick}
                        disabled={loading}
                        aria-label="Email appointment list to staff"
                    >
                        <span className="btn-icon" aria-hidden="true">📧</span>
                        <span>Email to Staff</span>
                    </button>
                </div>

                <div
                    id="messageCount"
                    className="message-count-info"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {loading && <span className="loading-spinner" aria-hidden="true"></span>}
                    <span>{displayMessage || 'Loading message count...'}</span>
                </div>
            </fieldset>
        </section>
    );
}
