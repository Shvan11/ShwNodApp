import { useState, useCallback } from 'react';

/**
 * Custom hook for managing appointments data and actions
 * Handles fetching, state updates, and appointment workflow (check-in, seat, dismiss)
 */
export function useAppointments() {
    const [allAppointments, setAllAppointments] = useState([]);
    const [checkedInAppointments, setCheckedInAppointments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch appointments for a specific date
    const loadAppointments = useCallback(async (date) => {
        if (!date) return;

        console.log('🔄 Loading appointments for date:', date);

        try {
            setLoading(true);
            setError(null);

            // Fetch both all appointments and checked-in appointments in parallel
            const [allResponse, checkedInResponse] = await Promise.all([
                fetch(`/api/getAllTodayApps?AppsDate=${date}`),
                fetch(`/api/getPresentTodayApps?AppsDate=${date}`)
            ]);

            if (!allResponse.ok || !checkedInResponse.ok) {
                throw new Error('Failed to fetch appointments');
            }

            const allData = await allResponse.json();
            const checkedInData = await checkedInResponse.json();

            console.log('✅ Fetched appointments:', {
                all: allData?.length || 0,
                checkedIn: checkedInData?.length || 0
            });

            setAllAppointments(allData || []);
            setCheckedInAppointments(checkedInData || []);
        } catch (err) {
            console.error('Error loading appointments:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Check in a patient (Scheduled → Present)
    const checkInPatient = useCallback(async (appointmentId) => {
        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Present',
                    time: new Date().toLocaleTimeString('en-US', { hour12: false })
                })
            });

            if (!response.ok) {
                throw new Error('Failed to check in patient');
            }

            return { success: true, previousState: 'Scheduled' };
        } catch (err) {
            console.error('Error checking in patient:', err);
            throw err;
        }
    }, []);

    // Mark patient as seated (Present → Seated)
    const markSeated = useCallback(async (appointmentId) => {
        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Seated',
                    time: new Date().toLocaleTimeString('en-US', { hour12: false })
                })
            });

            if (!response.ok) {
                throw new Error('Failed to seat patient');
            }

            return { success: true, previousState: 'Present' };
        } catch (err) {
            console.error('Error seating patient:', err);
            throw err;
        }
    }, []);

    // Mark patient as dismissed (Seated → Dismissed)
    const markDismissed = useCallback(async (appointmentId) => {
        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Dismissed',
                    time: new Date().toLocaleTimeString('en-US', { hour12: false })
                })
            });

            if (!response.ok) {
                throw new Error('Failed to complete visit');
            }

            return { success: true, previousState: 'Seated' };
        } catch (err) {
            console.error('Error completing visit:', err);
            throw err;
        }
    }, []);

    // Undo state (sets state to NULL in database)
    const undoState = useCallback(async (appointmentId, stateToUndo) => {
        try {
            const response = await fetch('/api/undoAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: stateToUndo
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to undo ${stateToUndo}`);
            }

            return { success: true };
        } catch (err) {
            console.error('Error undoing state:', err);
            throw err;
        }
    }, []);

    // Undo action (restores to previous state)
    const undoAction = useCallback(async (appointmentId, previousState) => {
        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: previousState,
                    time: new Date().toLocaleTimeString('en-US', { hour12: false })
                })
            });

            if (!response.ok) {
                throw new Error('Failed to undo action');
            }

            return { success: true };
        } catch (err) {
            console.error('Error undoing action:', err);
            throw err;
        }
    }, []);

    // Calculate statistics
    const calculateStats = useCallback(() => {
        const total = allAppointments.length;
        const checkedIn = checkedInAppointments.length;
        const waiting = checkedInAppointments.filter(a => a.Present && !a.Seated && !a.Dismissed).length;
        const completed = checkedInAppointments.filter(a => a.Dismissed).length;

        return { total, checkedIn, waiting, completed };
    }, [allAppointments, checkedInAppointments]);

    return {
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
    };
}
