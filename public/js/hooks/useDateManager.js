/**
 * Custom hook for date management in WhatsApp send page
 */
import { useState, useEffect, useMemo } from 'react';
import { CONFIG } from '../utils/whatsapp-send-constants.js';
import { validateDate } from '../utils/whatsapp-validation.js';

/**
 * Get local date string in YYYY-MM-DD format without timezone issues
 */
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Calculate days difference between two dates using local time
 */
function calculateDaysDifference(date1, date2) {
    // Create dates at midnight local time to avoid time-of-day issues
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());

    const timeDiff = d1.getTime() - d2.getTime();
    return Math.round(timeDiff / (1000 * 60 * 60 * 24));
}

/**
 * Get smart default date (tomorrow, or skip to Saturday on Thursday/Friday)
 */
function getDefaultDate() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlDate = urlParams.get('date');

        if (urlDate) {
            validateDate(urlDate);
            return urlDate;
        }
    } catch (error) {
        console.warn('Invalid date in URL parameters:', error.message);
    }

    // No URL date specified - use smart default
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday

    let defaultDate = new Date(today);

    if (dayOfWeek === 4) { // Today is Thursday
        // Default to Saturday (skip Friday weekend)
        defaultDate.setDate(today.getDate() + 2);
    } else if (dayOfWeek === 5) { // Today is Friday (weekend)
        // Default to Saturday (tomorrow)
        defaultDate.setDate(today.getDate() + 1);
    } else {
        // Default to tomorrow for all other days
        defaultDate.setDate(today.getDate() + 1);
    }

    return getLocalDateString(defaultDate);
}

/**
 * Format date label with relative time
 */
function formatDateLabel(date, currentDate) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const dateStr = getLocalDateString(date);
    const today = new Date();
    const todayStr = getLocalDateString(today);

    // Calculate yesterday and tomorrow
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);

    let label = `${dateStr} (${dayNames[date.getDay()]})`;

    if (dateStr === todayStr) {
        label += ' - Today';
    } else if (dateStr === yesterdayStr) {
        label += ' - Yesterday';
    } else if (dateStr === tomorrowStr) {
        label += ' - Tomorrow';
    } else {
        // Calculate days difference using local dates
        const daysDiff = calculateDaysDifference(date, today);

        if (daysDiff < 0) {
            // Past dates
            const absDays = Math.abs(daysDiff);
            if (absDays <= 7) {
                label += ` - ${absDays} days ago`;
            }
        } else if (daysDiff > 0) {
            // Future dates beyond tomorrow
            if (daysDiff <= 7) {
                label += ` - In ${daysDiff} days`;
            }
        }
    }

    return label;
}

/**
 * Generate date options for dropdown
 */
function generateDateOptions(currentDate) {
    const today = new Date();
    const dates = [];

    // Add past days (7 days back) for historical message status viewing
    for (let i = CONFIG.DATE_RANGE_DAYS_BACK; i > 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        dates.push(date);
    }

    // Add today
    dates.push(new Date(today));

    // Add future days
    for (let i = 1; i <= CONFIG.DATE_RANGE_DAYS_FORWARD; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        dates.push(date);
    }

    return dates.map(date => ({
        value: getLocalDateString(date),
        label: formatDateLabel(date, currentDate),
        isToday: getLocalDateString(date) === getLocalDateString(today),
        isDefault: getLocalDateString(date) === currentDate
    }));
}

/**
 * Custom hook for date management
 */
export function useDateManager() {
    const [currentDate, setCurrentDate] = useState(() => getDefaultDate());

    // Generate date options whenever current date changes
    const dateOptions = useMemo(() => {
        return generateDateOptions(currentDate);
    }, [currentDate]);

    // Handle date change
    const handleDateChange = (newDate) => {
        try {
            validateDate(newDate);
            if (newDate !== currentDate) {
                setCurrentDate(newDate);
            }
        } catch (error) {
            console.error('Invalid date provided:', error.message);
        }
    };

    return {
        currentDate,
        dateOptions,
        setCurrentDate: handleDateChange,
        getLocalDateString
    };
}
