import React, { useState, useEffect, useCallback } from 'react';
import AppointmentsHeader from './AppointmentsHeader.jsx';
import StatsCards from './StatsCards.jsx';
import MobileViewToggle from './MobileViewToggle.jsx';
import AppointmentsList from './AppointmentsList.jsx';
import Notification from './Notification.jsx';
import ContextMenu from './ContextMenu.jsx';
import { useAppointments } from '../../../hooks/useAppointments.js';
import { useWebSocketSync } from '../../../hooks/useWebSocketSync.js';

/**
 * DailyAppointments Component
 * Main application for daily appointments management
 */
const DailyAppointments = () => {
    // Get today's date in local timezone
    const getTodayDate = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const [selectedDate, setSelectedDate] = useState(getTodayDate());
    const [mobileView, setMobileView] = useState('all');
    const [notification, setNotification] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [showFlash, setShowFlash] = useState(false);

    // Use custom hooks
    const {
        allAppointments,
        checkedInAppointments,
        loading,
        error,
        loadAppointments,
        checkInPatient,
        markSeated,
        markDismissed,
        undoState,
        undoAction,
        calculateStats
    } = useAppointments();

    // WebSocket integration
    const { connectionStatus } = useWebSocketSync(selectedDate, () => {
        // Reload appointments when WebSocket updates received
        loadAppointments(selectedDate);
        flashUpdateIndicator();
        showNotification('Appointments updated', 'info');
    });

    // Load appointments when date changes
    useEffect(() => {
        loadAppointments(selectedDate);
    }, [selectedDate, loadAppointments]);

    // Flash update indicator
    const flashUpdateIndicator = () => {
        setShowFlash(true);
        setTimeout(() => setShowFlash(false), 1000);
    };

    // Handle date change
    const handleDateChange = (newDate) => {
        setSelectedDate(newDate);
    };

    // Show notification
    const showNotification = (message, type = 'info', undoData = null) => {
        setNotification({
            message,
            type,
            undoData,
            id: Date.now()
        });
    };

    // Close notification
    const closeNotification = () => {
        setNotification(null);
    };

    // Handle check-in
    const handleCheckIn = async (appointmentId) => {
        try {
            const result = await checkInPatient(appointmentId);
            if (result.success) {
                await loadAppointments(selectedDate);
                showNotification('Patient checked in', 'success', {
                    appointmentId,
                    previousState: result.previousState
                });
            }
        } catch (err) {
            showNotification('Failed to check in patient', 'error');
        }
    };

    // Handle mark seated
    const handleMarkSeated = async (appointmentId) => {
        try {
            const result = await markSeated(appointmentId);
            if (result.success) {
                await loadAppointments(selectedDate);
                showNotification('Patient seated', 'success', {
                    appointmentId,
                    previousState: result.previousState
                });
            }
        } catch (err) {
            showNotification('Failed to seat patient', 'error');
        }
    };

    // Handle mark dismissed
    const handleMarkDismissed = async (appointmentId) => {
        try {
            const result = await markDismissed(appointmentId);
            if (result.success) {
                await loadAppointments(selectedDate);
                showNotification('Visit completed', 'success', {
                    appointmentId,
                    previousState: result.previousState
                });
            }
        } catch (err) {
            showNotification('Failed to complete visit', 'error');
        }
    };

    // Handle undo state
    const handleUndoState = async (appointmentId, stateToUndo) => {
        try {
            await undoState(appointmentId, stateToUndo);
            await loadAppointments(selectedDate);
            showNotification(`${stateToUndo} status cleared`, 'info');
        } catch (err) {
            showNotification(`Failed to undo ${stateToUndo}`, 'error');
        }
    };

    // Handle undo action from notification
    const handleUndoAction = async (undoData) => {
        try {
            await undoAction(undoData.appointmentId, undoData.previousState);
            await loadAppointments(selectedDate);
            showNotification('Action undone', 'info');
        } catch (err) {
            showNotification('Failed to undo action', 'error');
        }
    };

    // Handle context menu
    const handleContextMenu = useCallback((e, appointmentId, status) => {
        e.preventDefault();

        setContextMenu({
            position: { x: e.pageX || e.clientX, y: e.pageY || e.clientY },
            appointmentId,
            status
        });
    }, []);

    // Close context menu
    const closeContextMenu = () => {
        setContextMenu(null);
    };

    // Calculate statistics
    const stats = calculateStats();

    // Error state
    if (error) {
        return (
            <div className="daily-appointments-view">
                <div className="error-message">
                    <i className="fas fa-exclamation-circle"></i>
                    Failed to load appointments: {error}
                </div>
            </div>
        );
    }

    return (
        <div className="daily-appointments-view">
            {/* Header with date picker */}
            <AppointmentsHeader
                selectedDate={selectedDate}
                onDateChange={handleDateChange}
                connectionStatus={connectionStatus}
                showFlash={showFlash}
            />

            {/* Mobile view toggle */}
            <MobileViewToggle
                activeView={mobileView}
                onViewChange={setMobileView}
            />

            {/* Statistics cards */}
            <StatsCards
                total={stats.total}
                checkedIn={stats.checkedIn}
                waiting={stats.waiting}
                completed={stats.completed}
            />

            {/* Appointments lists */}
            <div className="container full-width">
                <AppointmentsList
                    title="All Appointments"
                    appointments={allAppointments}
                    showStatus={false}
                    loading={loading}
                    onCheckIn={handleCheckIn}
                    emptyMessage="No appointments scheduled for this date."
                />

                <AppointmentsList
                    title="Checked-In Patients"
                    appointments={checkedInAppointments}
                    showStatus={true}
                    loading={loading}
                    onMarkSeated={handleMarkSeated}
                    onMarkDismissed={handleMarkDismissed}
                    onUndoState={handleUndoState}
                    onContextMenu={handleContextMenu}
                    emptyMessage="No patients checked in yet."
                />
            </div>

            {/* Footer */}
            <footer>
                <p>&copy; 2025 Shwan Orthodontics. All rights reserved.</p>
            </footer>

            {/* Notification */}
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={closeNotification}
                    onUndo={notification.undoData ? handleUndoAction : null}
                    undoData={notification.undoData}
                />
            )}

            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu.position}
                    status={contextMenu.status}
                    onClose={closeContextMenu}
                    onMarkSeated={() => handleMarkSeated(contextMenu.appointmentId)}
                    onMarkDismissed={() => handleMarkDismissed(contextMenu.appointmentId)}
                    onUndoState={(state) => handleUndoState(contextMenu.appointmentId, state)}
                />
            )}
        </div>
    );
};

export default DailyAppointments;
