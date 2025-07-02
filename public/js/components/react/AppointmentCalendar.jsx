import React, { useState, useEffect, useCallback, useMemo } from 'react'
import CalendarGrid from './CalendarGrid.jsx'

/**
 * AppointmentCalendar Main Component
 * 
 * The primary calendar component that orchestrates all calendar functionality
 * Integrates with existing tblcalender system via optimized API endpoints
 */

const AppointmentCalendar = ({ initialDate, initialViewMode = 'week' }) => {
    // State management
    const [currentDate, setCurrentDate] = useState(initialDate ? new Date(initialDate) : new Date());
    const [calendarData, setCalendarData] = useState(null);
    const [calendarStats, setCalendarStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [viewMode, setViewMode] = useState(initialViewMode);
    
    // Utility functions
    const getWeekStart = (date) => {
        const start = new Date(date);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        return start;
    };
    
    const getWeekEnd = (weekStart) => {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return end;
    };
    
    const validateCalendarData = (calendarResult) => {
        if (!calendarResult) {
            return { days: [], timeSlots: [] };
        }
        
        return {
            days: calendarResult.days || [],
            timeSlots: calendarResult.timeSlots || []
        };
    };
    
    // Computed values
    const weekStart = useMemo(() => {
        return getWeekStart(currentDate);
    }, [currentDate]);
    
    const weekEnd = useMemo(() => {
        return getWeekEnd(weekStart);
    }, [weekStart]);
    
    const weekDisplayText = useMemo(() => {
        const start = new Date(weekStart);
        const end = new Date(weekEnd);
        
        if (viewMode === 'day') {
            return currentDate.toLocaleDateString('en-US', { 
                weekday: 'long',
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
            });
        }
        
        return `Week of ${start.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        })} - ${end.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        })}`;
    }, [weekStart, weekEnd, currentDate, viewMode]);
    
    // API functions
    const fetchCalendarData = useCallback(async (date) => {
        setLoading(true);
        setError(null);
        
        try {
            const targetDate = date.toISOString().split('T')[0];
            
            // Fetch both calendar data and stats in parallel
            const [calendarResponse, statsResponse] = await Promise.all([
                fetch(`/api/calendar/week?date=${targetDate}`),
                fetch(`/api/calendar/stats?date=${targetDate}`)
            ]);
            
            if (!calendarResponse.ok) {
                throw new Error(`Calendar API error: ${calendarResponse.status}`);
            }
            
            if (!statsResponse.ok) {
                throw new Error(`Stats API error: ${statsResponse.status}`);
            }
            
            const calendarResult = await calendarResponse.json();
            const statsResult = await statsResponse.json();
            
            if (!calendarResult.success) {
                throw new Error(calendarResult.error || 'Failed to fetch calendar data');
            }
            
            if (!statsResult.success) {
                throw new Error(statsResult.error || 'Failed to fetch calendar stats');
            }
            
            // Validate and set calendar data
            const validatedCalendarData = validateCalendarData(calendarResult);
            setCalendarData(validatedCalendarData);
            setCalendarStats(statsResult.stats);
            
            
        } catch (err) {
            console.error('❌ Calendar fetch error:', err);
            setError(err.message);
            setCalendarData(null);
            setCalendarStats(null);
        } finally {
            setLoading(false);
        }
    }, []);
    
    // Navigation handlers
    const navigateWeek = useCallback((direction) => {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        setCurrentDate(newDate);
    }, [currentDate]);
    
    const goToToday = useCallback(() => {
        setCurrentDate(new Date());
    }, []);
    
    // Event handlers
    const handleViewModeChange = useCallback((newViewMode) => {
        setViewMode(newViewMode);
    }, []);
    
    const handleSlotClick = useCallback((slot) => {
        setSelectedSlot(slot);
    }, []);
    
    // Effects
    useEffect(() => {
        fetchCalendarData(currentDate);
    }, [currentDate, fetchCalendarData]);
    
    // WebSocket integration for real-time updates
    useEffect(() => {
        const handleWebSocketMessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'appointments_updated') {
                    fetchCalendarData(currentDate);
                }
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        };
        
        // Check if WebSocket is available
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.addEventListener('message', handleWebSocketMessage);
            
            return () => {
                window.socket.removeEventListener('message', handleWebSocketMessage);
            };
        }
    }, [currentDate, fetchCalendarData]);
    
    // Loading state
    if (loading) {
        return (
            <div className="appointment-calendar loading">
                <div className="calendar-loading">
                    <div className="loading-spinner">
                        <i className="fas fa-spinner fa-spin"></i>
                    </div>
                    <h3>Loading Calendar...</h3>
                    <p>Fetching appointment data for {weekDisplayText}</p>
                </div>
            </div>
        );
    }
    
    // Error state
    if (error) {
        return (
            <div className="appointment-calendar error">
                <div className="calendar-error">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h3>Calendar Loading Error</h3>
                    <p className="error-message">{error}</p>
                    <div className="error-actions">
                        <button 
                            className="btn btn-primary"
                            onClick={() => fetchCalendarData(currentDate)}
                        >
                            <i className="fas fa-refresh"></i>
                            Retry
                        </button>
                        <button 
                            className="btn btn-secondary"
                            onClick={goToToday}
                        >
                            <i className="fas fa-calendar-day"></i>
                            Go to Today
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    
    // Main render
    return (
        <div className="appointment-calendar">
            {/* Calendar Header */}
            <CalendarHeader
                viewMode={viewMode}
                weekDisplayText={weekDisplayText}
                calendarStats={calendarStats}
                onNavigateWeek={navigateWeek}
                onGoToToday={goToToday}
                onViewModeChange={handleViewModeChange}
            />
            
            {/* Calendar Grid */}
            <CalendarGrid
                calendarData={calendarData}
                selectedSlot={selectedSlot}
                onSlotClick={handleSlotClick}
            />
        </div>
    );
};

// Placeholder components that should be imported when converted
const CalendarHeader = ({ viewMode, weekDisplayText, calendarStats, onNavigateWeek, onGoToToday, onViewModeChange }) => (
    <div className="calendar-header">
        <div className="calendar-navigation">
            <button onClick={() => onNavigateWeek('prev')}>
                <i className="fas fa-chevron-left"></i>
            </button>
            <h2>{weekDisplayText}</h2>
            <button onClick={() => onNavigateWeek('next')}>
                <i className="fas fa-chevron-right"></i>
            </button>
        </div>
        <div className="calendar-controls">
            <button onClick={onGoToToday}>Today</button>
            <select value={viewMode} onChange={(e) => onViewModeChange(e.target.value)}>
                <option value="week">Week</option>
                <option value="day">Day</option>
            </select>
        </div>
        {calendarStats && (
            <div className="calendar-stats">
                <span>Utilization: {calendarStats.utilizationPercent}%</span>
            </div>
        )}
    </div>
);

export default AppointmentCalendar;