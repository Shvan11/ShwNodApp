import React from 'react'
import ReactDOM from 'react-dom/client'
import UniversalHeader from '../components/shared/UniversalHeader.jsx'
import MiniCalendar from '../components/react/MiniCalendar.jsx'
import '../../css/pages/appointments.css'
import '../../css/components/universal-header.css'

// Initialize the daily appointments page
document.addEventListener('DOMContentLoaded', function() {
    // Mount Universal Header
    const headerRoot = document.getElementById('universal-header-root');
    if (headerRoot) {
        const headerReactRoot = ReactDOM.createRoot(headerRoot);
        headerReactRoot.render(React.createElement(UniversalHeader));
    }
    
    // Mount Mini Calendar
    const miniCalendarContainer = document.getElementById('mini-calendar-container');
    if (miniCalendarContainer) {
        const miniCalendarRoot = ReactDOM.createRoot(miniCalendarContainer);
        miniCalendarRoot.render(React.createElement(MiniCalendar, {
            onDateSelect: (dateString) => {
                const datePicker = document.getElementById('date-picker');
                if (datePicker) {
                    datePicker.value = dateString;
                    loadAppointments(dateString);
                }
            }
        }));
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
});

// Initialize date picker functionality
function initializeDatePicker() {
    const datePicker = document.getElementById('date-picker');
    const loadBtn = document.getElementById('load-date-btn');
    
    if (datePicker) {
        datePicker.addEventListener('change', function() {
            loadAppointments(this.value);
        });
    }
    
    if (loadBtn) {
        loadBtn.addEventListener('click', function() {
            const date = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
            loadAppointments(date);
        });
    }
}

// Load appointments for a specific date
async function loadAppointments(date) {
    if (!date) return;
    
    try {
        // Update title
        const titleElement = document.getElementById('title');
        if (titleElement) {
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            titleElement.textContent = `Appointments for ${formattedDate}`;
        }
        
        // Fetch all appointments for the date
        const [allAppointments, checkedInAppointments] = await Promise.all([
            fetchAllAppointments(date),
            fetchCheckedInAppointments(date)
        ]);
        
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

// Render all appointments table
function renderAllAppointments(appointments) {
    const container = document.getElementById('all-appointments-container');
    if (!container) return;
    
    if (!appointments || appointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No appointments scheduled for this date.</p>';
        return;
    }
    
    const table = createAppointmentsTable(appointments, false);
    container.innerHTML = '';
    container.appendChild(table);
}

// Render checked-in appointments table
function renderCheckedInAppointments(appointments) {
    const container = document.getElementById('checked-in-container');
    if (!container) return;
    
    if (!appointments || appointments.length === 0) {
        container.innerHTML = '<p class="no-appointments">No patients checked in yet.</p>';
        return;
    }
    
    const table = createAppointmentsTable(appointments, true);
    container.innerHTML = '';
    container.appendChild(table);
}

// Create appointments table
function createAppointmentsTable(appointments, showActions = false) {
    const table = document.createElement('table');
    table.className = 'appointments-table';
    
    // Create header
    const header = table.createTHead();
    const headerRow = header.insertRow();
    
    let headers = ['Time', 'Patient Name'];
    if (showActions) headers.push('Status'); // Only show status for checked-in patients
    headers.push('Actions');
    
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    
    // Create body
    const tbody = table.createTBody();
    
    appointments.forEach(appointment => {
        const row = tbody.insertRow();
        
        // Time
        const timeCell = row.insertCell();
        timeCell.textContent = appointment.apptime || 'N/A'; // Backend returns apptime
        timeCell.className = 'time-cell';
        
        // Patient Name (clickable to photos)
        const nameCell = row.insertCell();
        const patientId = appointment.PersonID; // Backend returns PersonID
        nameCell.innerHTML = `<a href="javascript:void(0)" class="patient-link" onclick="viewPatientPhotos(${patientId})">${appointment.PatientName || 'Unknown'}</a>`;
        nameCell.className = 'name-cell';
        
        // Status (only for checked-in patients)
        let status = 'Scheduled';
        if (showActions) {
            // For checked-in patients, determine status from backend fields
            if (appointment.Present) status = 'Present';
            else if (appointment.Seated) status = 'Seated';
            else if (appointment.Dismissed) status = 'Dismissed';
            
            const statusCell = row.insertCell();
            let statusText = status;
            let statusClass = status.toLowerCase();
            
            statusCell.innerHTML = `<span class="status-badge status-${statusClass}">${statusText}</span>`;
            statusCell.className = 'status-cell';
        }
        
        // Actions
        const actionsCell = row.insertCell();
        actionsCell.className = 'actions-cell';
        
        if (!showActions) {
            // All appointments table - show check-in button
            const appointmentId = appointment.appointmentID; // Backend returns appointmentID
            const isCheckedIn = status.toLowerCase() !== 'scheduled';
            
            if (isCheckedIn) {
                actionsCell.innerHTML = `<span class="checked-in-indicator">✓ Checked In</span>`;
            } else {
                actionsCell.innerHTML = `
                    <button class="btn-small btn-success check-in-btn" onclick="checkInPatient(${appointmentId})">
                        <i class="fas fa-sign-in-alt"></i> Check In
                    </button>
                `;
            }
        } else {
            // Checked-in patients table - show patient management actions
            const appointmentId = appointment.appointmentID; // Backend returns appointmentID
            const currentStatus = status.toLowerCase();
            
            let actionButtons = `
                <button class="btn-small btn-primary" onclick="viewPatient(${patientId})" title="View Patient Details">
                    <i class="fas fa-eye"></i>
                </button>
            `;
            
            if (currentStatus === 'present') {
                actionButtons += `
                    <button class="btn-small btn-info" onclick="markSeated(${appointmentId})" title="Mark Seated">
                        <i class="fas fa-chair"></i>
                    </button>
                    <button class="btn-small btn-success" onclick="markDismissed(${appointmentId})" title="Dismiss">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                `;
            } else if (currentStatus === 'seated') {
                actionButtons += `
                    <button class="btn-small btn-success" onclick="markDismissed(${appointmentId})" title="Dismiss">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                    <button class="btn-small btn-warning" onclick="markPresent(${appointmentId})" title="Mark Present">
                        <i class="fas fa-user"></i>
                    </button>
                `;
            } else if (currentStatus === 'dismissed') {
                actionButtons += `
                    <button class="btn-small btn-secondary" onclick="markPresent(${appointmentId})" title="Mark Present">
                        <i class="fas fa-undo"></i>
                    </button>
                `;
            }
            
            actionsCell.innerHTML = actionButtons;
        }
    });
    
    return table;
}

// Update statistics
function updateStatistics(allAppointments, checkedInAppointments) {
    const allCount = allAppointments ? allAppointments.length : 0;
    const presentCount = checkedInAppointments ? checkedInAppointments.length : 0;
    
    // Count waiting patients (Present + Seated)
    const waitingCount = checkedInAppointments ? checkedInAppointments.filter(a => {
        const status = (a.Status || a.status || '').toLowerCase();
        return status === 'present' || status === 'seated';
    }).length : 0;
    
    // Count dismissed patients  
    const completedCount = checkedInAppointments ? checkedInAppointments.filter(a => {
        const status = (a.Status || a.status || '').toLowerCase();
        return status === 'dismissed';
    }).length : 0;
    
    // Update DOM elements
    const elements = {
        'all': allCount,
        'present': presentCount,
        'waiting': waitingCount,
        'completed': completedCount
    };
    
    Object.entries(elements).forEach(([id, count]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = count;
        }
    });
}

// Show error message
function showError(message) {
    const containers = ['all-appointments-container', 'checked-in-container'];
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<p class="error-message">❌ ${message}</p>`;
        }
    });
}

// Action functions
window.viewPatient = function(patientId) {
    if (patientId) {
        window.location.href = `/patient/${patientId}`;
    }
};

// View patient photos (main click action)
window.viewPatientPhotos = function(patientId) {
    console.log('Clicking patient ID:', patientId);
    if (patientId && patientId !== 'undefined' && patientId !== 'null') {
        const url = `/patient/${patientId}`;
        console.log('Navigating to patient app:', url);
        window.location.href = url;
    } else {
        console.error('Invalid patient ID:', patientId);
        alert('Patient ID not found');
    }
};

// Check in a patient
window.checkInPatient = async function(appointmentId) {
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
            // Reload appointments to reflect changes
            refreshAppointments();
            showNotification('Patient checked in successfully', 'success');
        } else {
            showNotification('Failed to check in patient', 'error');
        }
    } catch (error) {
        console.error('Error checking in patient:', error);
        showNotification('Error checking in patient', 'error');
    }
};

// Mark patient as present (from dismissed back to present)
window.markPresent = async function(appointmentId) {
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
            refreshAppointments();
            showNotification('Patient marked as present', 'success');
        } else {
            showNotification('Failed to update patient status', 'error');
        }
    } catch (error) {
        console.error('Error updating patient status:', error);
        showNotification('Error updating patient status', 'error');
    }
};

// Mark patient as seated
window.markSeated = async function(appointmentId) {
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
            refreshAppointments();
            showNotification('Patient marked as seated', 'success');
        } else {
            showNotification('Failed to update patient status', 'error');
        }
    } catch (error) {
        console.error('Error updating patient status:', error);
        showNotification('Error updating patient status', 'error');
    }
};

// Mark patient as dismissed
window.markDismissed = async function(appointmentId) {
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
            refreshAppointments();
            showNotification('Patient dismissed', 'success');
        } else {
            showNotification('Failed to dismiss patient', 'error');
        }
    } catch (error) {
        console.error('Error dismissing patient:', error);
        showNotification('Error dismissing patient', 'error');
    }
};

// Refresh appointments with current date
function refreshAppointments() {
    const datePicker = document.getElementById('date-picker');
    const date = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
    loadAppointments(date);
}

// Show notification
function showNotification(message, type = 'info') {
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
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
    
    // Add animation
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 10);
}