/**
 * CalendarHeader Component for Appointment Calendar
 * 
 * Renders the calendar header with navigation, view controls, and statistics
 * Handles week navigation and view mode switching
 */

import React from 'react'

const CalendarHeader = ({
    weekDisplayText,
    onPreviousWeek,
    onNextWeek,
    onTodayClick,
    viewMode,
    onViewModeChange,
    calendarStats,
    loading
}) => {
    
    return (
        <div className="calendar-header">
            {/* Week navigation section */}
            <div className="calendar-navigation">
                <button
                    className="nav-button prev-week"
                    onClick={onPreviousWeek}
                    disabled={loading}
                    title="Previous Week"
                    aria-label="Go to previous week"
                >
                    <i className="fas fa-chevron-left" />
                </button>
                
                <div className="week-display">
                    <h2 className="week-text">{weekDisplayText}</h2>
                    <button
                        className="today-button"
                        onClick={onTodayClick}
                        disabled={loading}
                        title="Go to current week"
                        aria-label="Navigate to current week"
                    >
                        Today
                    </button>
                </div>
                
                <button
                    className="nav-button next-week"
                    onClick={onNextWeek}
                    disabled={loading}
                    title="Next Week"
                    aria-label="Go to next week"
                >
                    <i className="fas fa-chevron-right" />
                </button>
            </div>
            
            {/* View mode toggle section */}
            <div className="view-controls">
                <div 
                    className="view-mode-toggle"
                    role="tablist"
                    aria-label="Calendar view mode"
                >
                    {[
                        ['week', 'Week View'],
                        ['day', 'Day View']
                    ].map(([mode, label]) => (
                        <button
                            key={mode}
                            className={`view-mode-btn ${viewMode === mode ? 'active' : ''}`}
                            onClick={() => onViewModeChange(mode)}
                            disabled={loading}
                            role="tab"
                            aria-selected={viewMode === mode}
                            aria-label={label}
                            title={label}
                        >
                            {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                    ))}
                </div>
            </div>
            
            {/* Calendar statistics section */}
            {calendarStats && (
                <div 
                    className="calendar-stats"
                    aria-label="Calendar statistics"
                >
                    <div
                        className="stat-item utilization"
                        title={`${calendarStats.utilizationPercent}% of available slots are booked`}
                    >
                        <span className="stat-label">Utilization</span>
                        <span className="stat-value">{calendarStats.utilizationPercent}%</span>
                    </div>
                    
                    <div
                        className="stat-item available"
                        title={`${calendarStats.availableSlots} slots available for booking`}
                    >
                        <span className="stat-label">Available</span>
                        <span className="stat-value">{calendarStats.availableSlots}</span>
                    </div>
                    
                    <div
                        className="stat-item booked"
                        title={`${calendarStats.bookedSlots} slots currently booked`}
                    >
                        <span className="stat-label">Booked</span>
                        <span className="stat-value">{calendarStats.bookedSlots}</span>
                    </div>
                    
                    <div
                        className="stat-item total"
                        title={`${calendarStats.totalSlots} total slots in this week`}
                    >
                        <span className="stat-label">Total</span>
                        <span className="stat-value">{calendarStats.totalSlots}</span>
                    </div>
                </div>
            )}
            
            {/* Loading indicator in header */}
            {loading && (
                <div className="header-loading">
                    <span className="loading-text">Updating...</span>
                    <div className="loading-spinner-small" />
                </div>
            )}
        </div>
    );
};

export default CalendarHeader;