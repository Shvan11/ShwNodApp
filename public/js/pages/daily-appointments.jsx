import React from 'react'
import ReactDOM from 'react-dom/client'
import UniversalHeader from '../components/react/UniversalHeader.jsx'
import '../../css/pages/appointments.css'
import '../../css/components/universal-header.css'

// Initialize the daily appointments page
function initializePage() {
    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
    }

    // Initialize date picker
    initializeDatePicker();

    // Load appointments for today by default
    const today = new Date().toISOString().split('T')[0];
    const datePicker = document.getElementById('date-picker');
    if (datePicker) {
        datePicker.value = today;
    }
    loadAppointments(today);

    console.log('✅ Daily appointments page initialized');
}

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

// Initialize date picker functionality
function initializeDatePicker() {
    const datePicker = document.getElementById('date-picker');

    if (datePicker) {
        datePicker.addEventListener('change', function() {
            loadAppointments(this.value);
        });
    }
}

// Load appointments for a specific date
async function loadAppointments(date) {
    if (!date) return;

    console.log('🔄 Loading appointments for date:', date);

    try {
        // Update title
        const titleElement = document.getElementById('title');
        if (titleElement) {
            const dateObj = new Date(date + 'T12:00:00'); // Add time to avoid timezone issues
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            titleElement.textContent = `Appointments for ${formattedDate}`;
        }

        // Show loading skeletons
        showLoadingState();

        // Fetch all appointments for the date
        const [allAppointments, checkedInAppointments] = await Promise.all([
            fetchAllAppointments(date),
            fetchCheckedInAppointments(date)
        ]);

        console.log('✅ Fetched appointments:', {
            all: allAppointments?.length || 0,
            checkedIn: checkedInAppointments?.length || 0
        });

        // Render appointments
        renderAllAppointments(allAppointments);
        renderCheckedInAppointments(checkedInAppointments);

        // Update statistics
        updateStatistics(allAppointments, checkedInAppointments);

    } catch (error) {
        console.error('Error loading appointments:', error);
        showError('Failed to load appointments for ' + date);
    }
}

// Show loading state with skeleton loaders
function showLoadingState() {
    const containers = ['all-appointments-container', 'checked-in-container'];
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = createSkeletonCards(3);
        }
    });
}

// Create skeleton loader cards
function createSkeletonCards(count = 3) {
    let html = '<div class="appointments-grid">';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-card">
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
            </div>
        `;
    }
    html += '</div>';
    return html;
}

// Fetch all appointments for a date
async function fetchAllAppointments(date) {
    const response = await fetch(`/api/getAllTodayApps?AppsDate=${date}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

// Fetch checked-in appointments for a date
async function fetchCheckedInAppointments(date) {
    const response = await fetch(`/api/getPresentTodayApps?AppsDate=${date}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

// Render all appointments in card format
function renderAllAppointments(appointments) {
    const container = document.getElementById('all-appointments-container');
    if (!container) return;

    if (!appointments || appointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No appointments scheduled for this date.</p>';
        return;
    }

    container.innerHTML = createAppointmentsCards(appointments, false);
}

// Render checked-in appointments in card format
function renderCheckedInAppointments(appointments) {
    const container = document.getElementById('checked-in-container');
    if (!container) return;

    if (!appointments || appointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No patients checked in yet.</p>';
        return;
    }

    container.innerHTML = createAppointmentsCards(appointments, true);
}

// Format SQL Server TIME value (HH:MM:SS) to 12-hour format
function formatTime(timeString) {
    if (!timeString) return '';

    // Handle SQL Server TIME format (HH:MM:SS or HH:MM:SS.000)
    const timeParts = timeString.split(':');
    if (timeParts.length < 2) return timeString;

    let hours = parseInt(timeParts[0]);
    const minutes = timeParts[1];
    const period = hours >= 12 ? 'PM' : 'AM';

    // Convert to 12-hour format
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12

    return `${hours}:${minutes} ${period}`;
}

// Create appointments cards HTML
function createAppointmentsCards(appointments, showStatus = false) {
    let html = '<div class="appointments-grid">';

    appointments.forEach((appointment) => {
        // Debug: Log appointment data
        console.log('Appointment data:', appointment);
        console.log('AppDetail:', appointment.AppDetail);
        console.log('PatientType:', appointment.PatientType);

        const time = appointment.apptime || 'N/A';
        const patientName = appointment.PatientName || 'Unknown';
        const patientId = appointment.PersonID;
        const appointmentId = appointment.appointmentID;

        // Determine current status
        let status = 'Scheduled';

        if (showStatus) {
            if (appointment.Dismissed) {
                status = 'Dismissed';
            } else if (appointment.Seated) {
                status = 'Seated';
            } else if (appointment.Present) {
                status = 'Present';
            }
        }

        // Get all state times
        const presentTime = appointment.PresentTime ? formatTime(appointment.PresentTime) : null;
        const seatedTime = appointment.SeatedTime ? formatTime(appointment.SeatedTime) : null;
        const dismissedTime = appointment.DismissedTime ? formatTime(appointment.DismissedTime) : null;

        const statusClass = status.toLowerCase();

        html += `
            <div class="appointment-card fade-in-up"
                 data-appointment-id="${appointmentId}"
                 data-status="${status.toLowerCase()}"
                 oncontextmenu="showContextMenu(event, ${appointmentId}, '${status}', ${showStatus})"
                 ontouchstart="handleTouchStart(event, ${appointmentId}, '${status}', ${showStatus})"
                 ontouchend="handleTouchEnd(event)"
                 ontouchmove="handleTouchMove(event)">
                <div class="appointment-time">
                    <i class="fas fa-clock" style="font-size: 0.875rem; opacity: 0.6; display: block; margin-bottom: 0.25rem;"></i>
                    ${time}
                </div>

                <div class="appointment-info">
                    <div class="patient-name">
                        <a href="javascript:void(0)" class="patient-link" onclick="viewPatientPhotos(${patientId})">
                            <i class="fas fa-user-circle" style="opacity: 0.7; margin-right: 0.5rem;"></i>
                            ${patientName}
                        </a>
                    </div>

                    ${appointment.AppDetail ? `
                        <div class="appointment-type">
                            <i class="fas fa-stethoscope" style="opacity: 0.6; margin-right: 0.25rem;"></i>
                            ${appointment.AppDetail}
                        </div>
                    ` : ''}

                    <div class="appointment-meta">
                        ${appointment.PatientType ? `
                            <span class="patient-type-badge">
                                <i class="fas fa-tag"></i>
                                ${appointment.PatientType}
                            </span>
                        ` : ''}
                        ${showStatus ? `
                            <span class="status-badge status-${statusClass}">
                                <i class="fas fa-${getStatusIcon(status)}"></i>
                                ${status}
                            </span>
                            <div class="state-times">
                                ${presentTime ? `
                                    <span class="status-time status-time-present" title="Checked in">
                                        <i class="fas fa-user-check"></i>
                                        ${presentTime}
                                    </span>
                                ` : ''}
                                ${seatedTime ? `
                                    <span class="status-time status-time-seated" title="Seated">
                                        <i class="fas fa-chair"></i>
                                        ${seatedTime}
                                    </span>
                                ` : ''}
                                ${dismissedTime ? `
                                    <span class="status-time status-time-dismissed" title="Dismissed">
                                        <i class="fas fa-check-circle"></i>
                                        ${dismissedTime}
                                    </span>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>

                <div class="appointment-actions">
                    ${createActionButtons(appointmentId, patientId, status, showStatus)}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

// Get status icon
function getStatusIcon(status) {
    const icons = {
        'Scheduled': 'calendar',
        'Present': 'user-check',
        'Seated': 'chair',
        'Dismissed': 'check-circle'
    };
    return icons[status] || 'circle';
}

// Create action buttons based on status - Sequential workflow implementation
function createActionButtons(appointmentId, patientId, status, showStatus) {
    if (!showStatus) {
        // All appointments table - show check-in button
        const isCheckedIn = status.toLowerCase() !== 'scheduled';

        if (isCheckedIn) {
            return `
                <span class="checked-in-indicator">
                    <i class="fas fa-check-circle"></i>
                    Checked In
                </span>
            `;
        } else {
            return `
                <button class="btn-action btn-success" onclick="checkInPatient(${appointmentId})">
                    <i class="fas fa-sign-in-alt"></i>
                    <span>Check In</span>
                </button>
            `;
        }
    } else {
        // Checked-in patients - Sequential workflow: Present → Seat → Dismiss
        const currentStatus = status.toLowerCase();

        let buttons = '';

        if (currentStatus === 'present') {
            // Present: Show "Seat" button + Undo button
            buttons = `
                <button class="btn-action btn-info" onclick="markSeated(${appointmentId})">
                    <i class="fas fa-chair"></i>
                    <span>Seat Patient</span>
                </button>
                <button class="btn-action btn-undo" onclick="undoState(${appointmentId}, 'Present')" title="Undo Check-in">
                    <i class="fas fa-undo"></i>
                </button>
            `;
        } else if (currentStatus === 'seated') {
            // Seated: Show "Complete Visit" button + Undo button
            buttons = `
                <button class="btn-action btn-success" onclick="markDismissed(${appointmentId})">
                    <i class="fas fa-check-circle"></i>
                    <span>Complete Visit</span>
                </button>
                <button class="btn-action btn-undo" onclick="undoState(${appointmentId}, 'Seated')" title="Undo Seating">
                    <i class="fas fa-undo"></i>
                </button>
            `;
        } else if (currentStatus === 'dismissed') {
            // Dismissed: Only show Undo button
            buttons = `
                <button class="btn-action btn-undo btn-undo-only" onclick="undoState(${appointmentId}, 'Dismissed')" title="Undo Dismiss">
                    <i class="fas fa-undo"></i>
                    <span>Undo Dismiss</span>
                </button>
            `;
        }

        return buttons;
    }
}

// Update statistics
function updateStatistics(allAppointments, checkedInAppointments) {
    const allCount = allAppointments ? allAppointments.length : 0;

    // Total checked in today (includes Present, Seated, and Dismissed)
    const checkedInCount = checkedInAppointments ? checkedInAppointments.length : 0;

    // Waiting patients = Present but NOT Seated (in the waiting room)
    const waitingCount = checkedInAppointments ? checkedInAppointments.filter(a => {
        return a.Present && !a.Seated && !a.Dismissed;
    }).length : 0;

    // Completed patients (dismissed)
    const completedCount = checkedInAppointments ? checkedInAppointments.filter(a => {
        return a.Dismissed;
    }).length : 0;

    console.log('📊 Updating statistics:', {
        all: allCount,
        checkedIn: checkedInCount,
        waiting: waitingCount,
        completed: completedCount
    });

    // Update DOM elements
    const elements = {
        'all': allCount,
        'present': checkedInCount,   // Total checked in today
        'waiting': waitingCount,      // In waiting room (checked in but not seated)
        'completed': completedCount   // Dismissed
    };

    Object.entries(elements).forEach(([id, count]) => {
        const element = document.getElementById(id);
        if (element) {
            // Animate count change
            animateValue(element, parseInt(element.textContent) || 0, count, 300);
        }
    });
}

// Animate value change with count-up effect
function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            element.textContent = end;
            clearInterval(timer);
        } else {
            element.textContent = Math.round(current);
        }
    }, 16);
}

// Show error message
function showError(message) {
    const containers = ['all-appointments-container', 'checked-in-container'];
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<p class="error-message"><i class="fas fa-exclamation-circle"></i> ${message}</p>`;
        }
    });
}

// Store last action for undo functionality
let lastAction = null;

// Action functions
window.viewPatient = function(patientId) {
    if (patientId) {
        window.location.href = `/patient/${patientId}/works`;
    }
};

// View patient photos (main click action)
window.viewPatientPhotos = function(patientId) {
    console.log('Clicking patient ID:', patientId);
    if (patientId && patientId !== 'undefined' && patientId !== 'null') {
        const url = `/patient/${patientId}/works`;
        console.log('Navigating to patient app:', url);
        window.location.href = url;
    } else {
        console.error('Invalid patient ID:', patientId);
        alert('Patient ID not found');
    }
};

// Check in a patient
window.checkInPatient = async function(appointmentId, patientId) {
    try {
        const response = await fetch('/api/updateAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: 'Present',
                time: new Date().toLocaleTimeString('en-US', { hour12: false })
            })
        });

        if (response.ok) {
            // Store action for undo
            lastAction = {
                appointmentId,
                patientId,
                previousState: 'Scheduled',
                currentState: 'Present'
            };

            await refreshAppointments();
            showNotificationWithUndo('Patient checked in', 'success', appointmentId, 'Scheduled');
        } else {
            showNotification('Failed to check in patient', 'error');
        }
    } catch (error) {
        console.error('Error checking in patient:', error);
        showNotification('Error checking in patient', 'error');
    }
};

// Mark patient as seated
window.markSeated = async function(appointmentId, patientId) {
    try {
        const response = await fetch('/api/updateAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: 'Seated',
                time: new Date().toLocaleTimeString('en-US', { hour12: false })
            })
        });

        if (response.ok) {
            // Store action for undo
            lastAction = {
                appointmentId,
                patientId,
                previousState: 'Present',
                currentState: 'Seated'
            };

            await refreshAppointments();
            showNotificationWithUndo('Patient seated', 'success', appointmentId, 'Present');
        } else {
            showNotification('Failed to seat patient', 'error');
        }
    } catch (error) {
        console.error('Error seating patient:', error);
        showNotification('Error seating patient', 'error');
    }
};

// Mark patient as dismissed (complete visit)
window.markDismissed = async function(appointmentId, patientId) {
    try {
        const response = await fetch('/api/updateAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: 'Dismissed',
                time: new Date().toLocaleTimeString('en-US', { hour12: false })
            })
        });

        if (response.ok) {
            // Store action for undo
            lastAction = {
                appointmentId,
                patientId,
                previousState: 'Seated',
                currentState: 'Dismissed'
            };

            await refreshAppointments();
            showNotificationWithUndo('Visit completed', 'success', appointmentId, 'Seated');
        } else {
            showNotification('Failed to complete visit', 'error');
        }
    } catch (error) {
        console.error('Error completing visit:', error);
        showNotification('Error completing visit', 'error');
    }
};

// Undo dismiss - restore to Present state
window.undoDismiss = async function(appointmentId, patientId) {
    try {
        const response = await fetch('/api/updateAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: 'Present',
                time: new Date().toLocaleTimeString('en-US', { hour12: false })
            })
        });

        if (response.ok) {
            await refreshAppointments();
            showNotification('Visit restored', 'info');
        } else {
            showNotification('Failed to restore visit', 'error');
        }
    } catch (error) {
        console.error('Error restoring visit:', error);
        showNotification('Error restoring visit', 'error');
    }
};

// Generic undo function called from notification
window.undoAction = async function(appointmentId, previousState) {
    try {
        const response = await fetch('/api/updateAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: previousState,
                time: new Date().toLocaleTimeString('en-US', { hour12: false })
            })
        });

        if (response.ok) {
            // Clear last action
            lastAction = null;
            await refreshAppointments();
            showNotification('Action undone', 'info');
        } else {
            showNotification('Failed to undo action', 'error');
        }
    } catch (error) {
        console.error('Error undoing action:', error);
        showNotification('Error undoing action', 'error');
    }
};

// Undo state by setting field to NULL (enforces sequential workflow)
window.undoState = async function(appointmentId, stateToUndo) {
    try {
        const response = await fetch('/api/undoAppointmentState', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                appointmentID: appointmentId,
                state: stateToUndo
            })
        });

        if (response.ok) {
            // Wait for refresh to complete before showing notification
            await refreshAppointments();
            showNotification(`${stateToUndo} status cleared`, 'info');
        } else {
            showNotification(`Failed to undo ${stateToUndo}`, 'error');
        }
    } catch (error) {
        console.error('Error undoing state:', error);
        showNotification('Error undoing state', 'error');
    }
};

// Refresh appointments with current date
async function refreshAppointments() {
    const datePicker = document.getElementById('date-picker');
    const date = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
    await loadAppointments(date);
}

// Show notification with undo button
function showNotificationWithUndo(message, type, appointmentId, previousState) {
    // Remove any existing notifications
    document.querySelectorAll('.notification').forEach(n => n.remove());

    // Create notification element with undo button
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
        <button class="notification-undo" onclick="undoAction(${appointmentId}, '${previousState}'); this.parentElement.remove();">
            <i class="fas fa-undo"></i>
            Undo
        </button>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    });

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 200);
        }
    }, 5000);
}

// Show notification (standard without undo)
function showNotification(message, type = 'info') {
    // Remove any existing notifications
    document.querySelectorAll('.notification').forEach(n => n.remove());

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    });

    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 200);
        }
    }, 3000);
}

// Context menu for power users
window.showContextMenu = function(event, appointmentId, status, showStatus) {
    event.preventDefault();

    // Remove any existing context menu
    const existingMenu = document.getElementById('context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    // Only show context menu for checked-in patients
    if (!showStatus) return;

    const statusLower = status.toLowerCase();

    // Create context menu
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';

    let menuItems = '';

    // Add appropriate menu items based on status
    if (statusLower === 'present') {
        menuItems = `
            <div class="context-menu-item" onclick="markSeated(${appointmentId}); closeContextMenu();">
                <i class="fas fa-chair"></i>
                <span>Seat Patient</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item context-menu-item-danger" onclick="undoState(${appointmentId}, 'Present'); closeContextMenu();">
                <i class="fas fa-undo"></i>
                <span>Undo Check-in</span>
            </div>
        `;
    } else if (statusLower === 'seated') {
        menuItems = `
            <div class="context-menu-item" onclick="markDismissed(${appointmentId}); closeContextMenu();">
                <i class="fas fa-check-circle"></i>
                <span>Complete Visit</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item context-menu-item-danger" onclick="undoState(${appointmentId}, 'Seated'); closeContextMenu();">
                <i class="fas fa-undo"></i>
                <span>Undo Seating</span>
            </div>
        `;
    } else if (statusLower === 'dismissed') {
        menuItems = `
            <div class="context-menu-item context-menu-item-danger" onclick="undoState(${appointmentId}, 'Dismissed'); closeContextMenu();">
                <i class="fas fa-undo"></i>
                <span>Undo Dismiss</span>
            </div>
        `;
    }

    menu.innerHTML = menuItems;

    // Position menu at cursor
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    // Add to page
    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 0);
};

window.closeContextMenu = function() {
    const menu = document.getElementById('context-menu');
    if (menu) {
        menu.remove();
    }
};

// Touch event handlers for long-press on mobile
let touchTimer = null;
let touchMoved = false;

window.handleTouchStart = function(event, appointmentId, status, showStatus) {
    touchMoved = false;

    // Start long-press timer (500ms)
    touchTimer = setTimeout(() => {
        if (!touchMoved && showStatus) {
            // Trigger context menu on long press
            const touch = event.touches[0];
            const syntheticEvent = {
                preventDefault: () => event.preventDefault(),
                pageX: touch.pageX,
                pageY: touch.pageY
            };
            showContextMenu(syntheticEvent, appointmentId, status, showStatus);

            // Vibrate for haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }
    }, 500);
};

window.handleTouchMove = function(event) {
    touchMoved = true;
    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }
};

window.handleTouchEnd = function(event) {
    if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
    }
};
