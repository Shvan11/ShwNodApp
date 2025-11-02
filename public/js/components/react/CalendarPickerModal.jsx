import React, { useState, useCallback } from 'react'
import AppointmentCalendar from './AppointmentCalendar.jsx'

/**
 * CalendarPickerModal Component
 * 
 * A modal wrapper around the existing AppointmentCalendar for appointment slot selection
 * Reuses the full calendar system with selection mode for consistent UX
 */

const CalendarPickerModal = ({ onSelectDateTime, onClose, initialDate = new Date() }) => {
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [showConfirmation, setShowConfirmation] = useState(false);

    // Handle slot selection from the calendar
    const handleSlotSelect = useCallback((slotData) => {
        // Only allow selection of available slots (not booked, past, or full)
        if (slotData.slotStatus !== 'available') {
            return;
        }

        // Create datetime from slot data
        const selectedDateTime = new Date(`${slotData.date}T${slotData.time}:00`);

        setSelectedSlot({
            ...slotData,
            dateTime: selectedDateTime
        });
        setShowConfirmation(true);
    }, []);

    // Handle confirmation of selected slot
    const handleConfirmSelection = useCallback(() => {
        if (selectedSlot) {
            onSelectDateTime(selectedSlot.dateTime);
            onClose();
        }
    }, [selectedSlot, onSelectDateTime, onClose]);

    // Handle clearing selection
    const handleClearSelection = useCallback(() => {
        setSelectedSlot(null);
        setShowConfirmation(false);
    }, []);

    // Handle modal close
    const handleClose = useCallback((e) => {
        // Allow closing by clicking overlay or escape key
        if (e.target === e.currentTarget || e.key === 'Escape') {
            onClose();
        }
    }, [onClose]);

    // Handle escape key
    React.useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    // Format selected slot for display
    const formatSelectedSlot = (slot) => {
        if (!slot) return '';
        
        const date = slot.dateTime.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        
        const time = slot.dateTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        return `${date} at ${time}`;
    };

    return (
        <div className="calendar-picker-overlay" onClick={handleClose}>
            <div className="calendar-picker-modal" onClick={(e) => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="calendar-picker-header">
                    <div className="header-content">
                        <h2 className="modal-title">
                            <i className="fas fa-calendar-plus"></i>
                            Select Appointment Date & Time
                        </h2>
                        <p className="modal-subtitle">
                            Choose an available time slot for the new appointment
                        </p>
                    </div>
                    <button 
                        className="close-btn"
                        onClick={onClose}
                        aria-label="Close calendar picker"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Selection Indicator */}
                {selectedSlot && (
                    <div className="selection-indicator">
                        <div className="selected-info">
                            <i className="fas fa-check-circle"></i>
                            <span className="selected-text">
                                Selected: {formatSelectedSlot(selectedSlot)}
                            </span>
                        </div>
                        <button 
                            className="clear-selection-btn"
                            onClick={handleClearSelection}
                            title="Clear selection"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                )}

                {/* Calendar Content */}
                <div className="calendar-picker-content">
                    <AppointmentCalendar
                        initialDate={initialDate}
                        initialViewMode="week"
                        mode="selection"
                        onSlotSelect={handleSlotSelect}
                        selectedSlot={selectedSlot}
                        showOnlyAvailable={false}
                    />
                </div>

                {/* Modal Actions */}
                <div className="calendar-picker-actions">
                    <div className="action-info">
                        <i className="fas fa-info-circle"></i>
                        <span>Click on an available time slot to select it</span>
                    </div>
                    
                    <div className="action-buttons">
                        <button
                            className="btn btn-secondary"
                            onClick={onClose}
                        >
                            <i className="fas fa-times"></i>
                            Cancel
                        </button>
                        
                        <button
                            className="btn btn-primary"
                            onClick={handleConfirmSelection}
                            disabled={!selectedSlot}
                        >
                            <i className="fas fa-check"></i>
                            Confirm Selection
                        </button>
                    </div>
                </div>

                {/* Quick Help */}
                <div className="calendar-picker-help">
                    <div className="help-legend">
                        <div className="legend-item">
                            <span className="legend-color available"></span>
                            <span>Available</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color booked"></span>
                            <span>Booked</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color full"></span>
                            <span>Full (Max Reached)</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color past"></span>
                            <span>Past</span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color selected"></span>
                            <span>Selected</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CalendarPickerModal;