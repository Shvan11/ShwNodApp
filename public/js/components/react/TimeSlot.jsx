/**
 * TimeSlot Component for Appointment Calendar - CALENDAR FOCUSED
 * 
 * Renders individual 30-minute time slots for scheduling overview
 * Focuses on slot availability rather than patient status tracking
 */

import React, { useCallback, useMemo } from 'react'

const TimeSlot = ({ slotData, onClick, isSelected, uniformHeight, mode = 'view', showOnlyAvailable = false }) => {
    const {
        date,
        time,
        dayName,
        appointments = [], // New: Array of appointments
        slotStatus,
        // Legacy fields for backward compatibility
        appointmentID,
        appDetail,
        patientName
    } = slotData;
    
    // Determine slot appearance classes - SUPPORTS MULTIPLE APPOINTMENTS
    const slotClass = useMemo(() => {
        const classes = ['time-slot'];
        
        // Count valid appointments
        const validAppointmentsCount = appointments.filter(appointment => 
            appointment && (appointment.patientName || appointment.appointmentID)
        ).length;
        
        // Add status classes for scheduling decisions
        classes.push(slotStatus); // available, booked (all slots are clickable regardless of status)
        
        if (isSelected) classes.push('selected');
        if (validAppointmentsCount > 0) classes.push('scheduled');
        
        // Add multiple appointments indicator
        if (validAppointmentsCount > 1) classes.push('multiple-appointments');
        if (validAppointmentsCount > 2) classes.push('many-appointments');
        
        // Add selection mode classes
        if (mode === 'selection') {
            classes.push('selection-mode');
            
            if (slotStatus === 'available') {
                classes.push('selectable');
            } else {
                classes.push('non-selectable');
            }
        }
        
        return classes.join(' ');
    }, [slotStatus, isSelected, appointments, mode]);
    
    // Click handler
    const handleClick = useCallback((event) => {
        // In selection mode, only allow clicking on available slots
        if (mode === 'selection' && slotStatus !== 'available') {
            return;
        }

        // In view mode, always allow clicks (for context menu)
        onClick(slotData, event);
    }, [onClick, slotData, slotStatus, mode]);
    
    // Render appointment content - SUPPORTS MULTIPLE APPOINTMENTS
    const renderAppointmentContent = () => {
        // Filter out empty appointments (appointments without patient names or IDs)
        const validAppointments = appointments.filter(appointment => 
            appointment && 
            (appointment.patientName || appointment.appointmentID)
        );
        
        if (validAppointments.length === 0) {
            return null;
        }
        
        // Handle single appointment (show full details)
        if (validAppointments.length === 1) {
            const appointment = validAppointments[0];
            return (
                <div className="appointment-content single">
                    <div className="patient-name">
                        {appointment.patientName || 'Scheduled'}
                    </div>
                    {appointment.appDetail && (
                        <div className="appointment-detail">
                            {appointment.appDetail}
                        </div>
                    )}
                </div>
            );
        }
        
        // Handle multiple appointments (compact view)
        const appointmentElements = validAppointments.map((appointment, index) => {
            return (
                <div
                    key={`appointment-${index}`}
                    className="appointment-item"
                >
                    <div className="patient-name-compact">
                        {appointment.patientName || 'Scheduled'}
                    </div>
                    {appointment.appDetail && (
                        <div className="appointment-detail-compact">
                            {appointment.appDetail}
                        </div>
                    )}
                </div>
            );
        });
        
        return (
            <div className="appointment-content multiple">
                <div className="appointment-count">
                    {validAppointments.length} appointments
                </div>
                <div className="appointments-list">
                    {appointmentElements}
                </div>
            </div>
        );
    };
    
    // Render empty slot content for available slots
    const renderEmptySlotContent = () => {
        // Just return null - let color coding and click behavior handle everything
        return null;
    };
    
    // Generate tooltip text - SUPPORTS MULTIPLE APPOINTMENTS
    const getTooltipText = () => {
        if (appointments.length === 0) {
            return `${time} - Available for scheduling`;
        }

        if (appointments.length === 1) {
            const appointment = appointments[0];
            let tooltip = `${time} - ${appointment.patientName || 'Patient'}`;
            if (appointment.appDetail) tooltip += ` (${appointment.appDetail})`;
            return tooltip;
        }

        // Multiple appointments
        let tooltip = `${time} - ${appointments.length} appointments:\n`;
        appointments.forEach((appointment, index) => {
            tooltip += `${index + 1}. ${appointment.patientName || 'Patient'}`;
            if (appointment.appDetail) tooltip += ` (${appointment.appDetail})`;
            if (index < appointments.length - 1) tooltip += '\n';
        });

        return tooltip;
    };
    
    // Check if we have valid appointments for rendering decision
    const hasValidAppointments = appointments.some(appointment => 
        appointment && (appointment.patientName || appointment.appointmentID)
    );
    
    // Use uniform height provided by parent component to ensure all slots for same time have same height
    const calculatedHeight = uniformHeight || 85; // MUST match --calendar-slot-min-height in CSS
    
    return (
        <div
            className={slotClass}
            onClick={handleClick}
            title={getTooltipText()}
            style={{
                minHeight: `${calculatedHeight}px`,
                height: `${calculatedHeight}px`
            }}
            data-appointment-count={appointments.length}
            data-appointment-id={appointments.length > 0 ? appointments[0].appointmentID : ''}
            data-time={time}
            data-date={date}
            data-status={slotStatus}
        >
            {hasValidAppointments ? renderAppointmentContent() : renderEmptySlotContent()}
        </div>
    );
};

export default TimeSlot;