import React from 'react'
import ReactDOM from 'react-dom/client'
import AppointmentCalendar from '../components/react/AppointmentCalendar.jsx'
import UniversalHeader from '../components/react/UniversalHeader.jsx'
import '../../css/base/variables.css'
import '../../css/base/reset.css'
import '../../css/base/typography.css'
import '../../css/components/buttons.css'
import '../../css/layout/universal-header.css'
import '../../css/components/appointment-calendar.css'

// Initialize the calendar page
document.addEventListener('DOMContentLoaded', function () {
    try {
        console.log('🚀 Initializing Appointment Calendar...');

        // Name this window so tabManager can reuse it
        window.name = 'clinic_calendar';

        // Register this tab with heartbeat system

        // Get URL parameters for initial state
        const urlParams = new URLSearchParams(window.location.search);
        const initialDate = urlParams.get('date');
        const initialView = urlParams.get('view') || 'week';

        console.log('Initial parameters:', { initialDate, initialView });

        // Create React root for header
        const headerRoot = document.getElementById('header-root');
        if (!headerRoot) {
            throw new Error('Header root element not found');
        }

        const headerReactRoot = ReactDOM.createRoot(headerRoot);

        // Render the universal header
        console.log('🎨 Rendering header component...');
        headerReactRoot.render(React.createElement(UniversalHeader));

        // Create React root and render calendar
        const calendarRoot = document.getElementById('calendar-root');
        if (!calendarRoot) {
            throw new Error('Calendar root element not found');
        }

        const root = ReactDOM.createRoot(calendarRoot);

        // Render the appointment calendar
        console.log('🎨 Rendering calendar component...');
        root.render(React.createElement(AppointmentCalendar, {
            initialDate: initialDate,
            initialViewMode: initialView
        }));

        console.log('✅ Calendar initialized successfully');

        // Hide loading screen after a short delay
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('hidden');
            }
        }, 500);

    } catch (error) {
        console.error('❌ Failed to initialize calendar:', error);
        showError('Failed to initialize calendar: ' + error.message);

        // Hide loading screen even if there's an error
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('hidden');
            }
        }, 1000);
    }
});

// Error display function
function showError(message) {
    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-message');
    if (errorBanner && errorMessage) {
        errorMessage.textContent = message;
        errorBanner.classList.add('show');

        // Auto-hide after 10 seconds
        setTimeout(() => {
            errorBanner.classList.remove('show');
        }, 10000);
    }
}

// Make showError available globally
window.showError = showError;