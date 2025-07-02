/**
 * MiniCalendar Component - Mini calendar widget for date selection
 * 
 * Provides a compact calendar interface for date selection with navigation
 */

import React, { useState, useEffect, useMemo } from 'react'

const MiniCalendar = ({ 
    selectedDate, 
    onDateSelect, 
    className = '',
    showHeader = true,
    highlightToday = true 
}) => {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [isVisible, setIsVisible] = useState(false);
    
    // Initialize current month based on selected date
    useEffect(() => {
        if (selectedDate) {
            const date = new Date(selectedDate);
            setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        }
    }, [selectedDate]);
    
    // Helper functions
    const isToday = (date) => {
        const today = new Date();
        return isSameDay(date, today);
    };
    
    const isSameDay = (date1, date2) => {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    };
    
    // Calculate calendar days
    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        
        // First day of the month
        const firstDay = new Date(year, month, 1);
        // Last day of the month
        const lastDay = new Date(year, month + 1, 0);
        // First day to show (may be from previous month)
        const startDate = new Date(firstDay);
        startDate.setDate(firstDay.getDate() - firstDay.getDay());
        // Last day to show (may be from next month)
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 41); // 6 weeks * 7 days
        
        const days = [];
        const current = new Date(startDate);
        
        while (current <= endDate) {
            days.push({
                date: new Date(current),
                isCurrentMonth: current.getMonth() === month,
                isToday: highlightToday && isToday(current),
                isSelected: selectedDate && isSameDay(current, new Date(selectedDate))
            });
            current.setDate(current.getDate() + 1);
        }
        
        return days;
    }, [currentMonth, selectedDate, highlightToday]);
    
    const formatDateForInput = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    const handleDateClick = (day) => {
        if (onDateSelect) {
            const dateString = formatDateForInput(day.date);
            onDateSelect(dateString, day.date);
        }
        setIsVisible(false);
    };
    
    const navigateMonth = (direction) => {
        setCurrentMonth(prev => {
            const newMonth = new Date(prev);
            newMonth.setMonth(prev.getMonth() + direction);
            return newMonth;
        });
    };
    
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    return (
        <div 
            className={`mini-calendar ${className}`}
            style={{
                position: 'relative',
                display: 'inline-block'
            }}
        >
            {/* Calendar toggle button */}
            <button
                className="mini-calendar-toggle"
                onClick={() => setIsVisible(!isVisible)}
                style={{
                    padding: '8px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}
            >
                <i 
                    className="fas fa-calendar-alt"
                    style={{ color: '#666' }}
                />
                <span>
                    {selectedDate ? 
                        new Date(selectedDate).toLocaleDateString('en-US', { 
                            weekday: 'short', 
                            month: 'short', 
                            day: 'numeric' 
                        }) : 
                        'Select Date'
                    }
                </span>
            </button>
            
            {/* Calendar popup */}
            {isVisible && (
                <div 
                    className="mini-calendar-popup"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: '0',
                        zIndex: 1000,
                        backgroundColor: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        padding: '16px',
                        minWidth: '280px',
                        marginTop: '4px'
                    }}
                >
                    {/* Header with navigation */}
                    {showHeader && (
                        <div 
                            className="mini-calendar-header"
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '16px'
                            }}
                        >
                            <button
                                onClick={() => navigateMonth(-1)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '16px'
                                }}
                            >
                                <i className="fas fa-chevron-left" />
                            </button>
                            
                            <h4
                                style={{
                                    margin: '0',
                                    fontSize: '16px',
                                    fontWeight: '600'
                                }}
                            >
                                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                            </h4>
                            
                            <button
                                onClick={() => navigateMonth(1)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '16px'
                                }}
                            >
                                <i className="fas fa-chevron-right" />
                            </button>
                        </div>
                    )}
                    
                    {/* Day names header */}
                    <div 
                        className="mini-calendar-day-names"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, 1fr)',
                            gap: '2px',
                            marginBottom: '8px'
                        }}
                    >
                        {dayNames.map((day, index) => (
                            <div
                                key={index}
                                style={{
                                    textAlign: 'center',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#666',
                                    padding: '4px'
                                }}
                            >
                                {day}
                            </div>
                        ))}
                    </div>
                    
                    {/* Calendar grid */}
                    <div 
                        className="mini-calendar-grid"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, 1fr)',
                            gap: '2px'
                        }}
                    >
                        {calendarDays.map((day, index) => {
                            const isCurrentMonth = day.isCurrentMonth;
                            const isToday = day.isToday;
                            const isSelected = day.isSelected;
                            
                            return (
                                <button
                                    key={index}
                                    onClick={() => handleDateClick(day)}
                                    style={{
                                        border: 'none',
                                        padding: '8px 4px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: isToday || isSelected ? '600' : '400',
                                        backgroundColor: 
                                            isSelected ? '#007bff' :
                                            isToday ? '#e3f2fd' :
                                            '#fff',
                                        color: 
                                            isSelected ? '#fff' :
                                            isToday ? '#007bff' :
                                            isCurrentMonth ? '#333' : '#ccc',
                                        transition: 'all 0.2s ease',
                                        minHeight: '32px'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isSelected) {
                                            e.target.style.backgroundColor = isToday ? '#bbdefb' : '#f5f5f5';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isSelected) {
                                            e.target.style.backgroundColor = isToday ? '#e3f2fd' : '#fff';
                                        }
                                    }}
                                >
                                    {day.date.getDate()}
                                </button>
                            );
                        })}
                    </div>
                    
                    {/* Quick actions */}
                    <div 
                        className="mini-calendar-actions"
                        style={{
                            marginTop: '16px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '8px'
                        }}
                    >
                        <button
                            onClick={() => {
                                const today = new Date();
                                const dateString = formatDateForInput(today);
                                if (onDateSelect) {
                                    onDateSelect(dateString, today);
                                }
                                setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                                setIsVisible(false);
                            }}
                            style={{
                                flex: '1',
                                padding: '6px 12px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                backgroundColor: '#f8f9fa',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            Today
                        </button>
                        
                        <button
                            onClick={() => setIsVisible(false)}
                            style={{
                                flex: '1',
                                padding: '6px 12px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                backgroundColor: '#fff',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MiniCalendar;