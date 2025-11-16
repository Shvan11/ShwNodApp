import { useState, useCallback } from 'react';
import { generateActionId } from '../utils/action-id.js';

/**
 * Custom hook for managing appointments data and actions with OPTIMISTIC UPDATES
 *
 * KEY IMPROVEMENTS:
 * 1. Optimistic updates with proper list separation
 *    - allAppointments: Non-checked-in only (Present IS NULL from AllTodayApps)
 *    - checkedInAppointments: Checked-in only (Present/Seated/Dismissed from PresentTodayApps)
 *    - Optimistic updates move appointments between lists instantly
 *    - No page scrolling issues
 *    - No unnecessary reloads
 *
 * 2. Action ID tracking for event source detection
 *    - Each action gets a unique ID
 *    - Server echoes the ID in WebSocket broadcasts
 *    - Enables robust detection of own actions vs external updates
 */
export function useAppointments() {
    // TWO SEPARATE LISTS (matching database structure)
    // AllTodayApps returns appointments with Present IS NULL (no status fields)
    // PresentTodayApps returns appointments with Present/Seated/Dismissed fields
    const [allAppointments, setAllAppointments] = useState([]);
    const [checkedInAppointments, setCheckedInAppointments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    /**
     * Get current time in HH:MM:SS format
     */
    const getCurrentTime = () => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    };

    /**
     * Fetch appointments for a specific date
     * ONLY called on: initial load, date change, WebSocket update
     */
    const loadAppointments = useCallback(async (date) => {
        if (!date) return;

        console.log('🔄 Loading appointments for date:', date);

        try {
            setLoading(true);
            setError(null);

            // Fetch both lists in parallel (matching original behavior)
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

    /**
     * OPTIMISTIC UPDATE: Update appointment in checked-in list
     */
    const updateCheckedInAppointment = useCallback((appointmentId, updates) => {
        setCheckedInAppointments(prev => prev.map(apt =>
            apt.appointmentID === appointmentId
                ? { ...apt, ...updates }
                : apt
        ));
    }, []);

    /**
     * OPTIMISTIC UPDATE: Move appointment from "All" to "Checked In" list
     */
    const moveToCheckedIn = useCallback((appointmentId, appointmentData) => {
        // Remove from "All Appointments"
        setAllAppointments(prev => prev.filter(apt => apt.appointmentID !== appointmentId));

        // Add to "Checked In Patients"
        setCheckedInAppointments(prev => [...prev, appointmentData]);
    }, []);

    /**
     * OPTIMISTIC UPDATE: Move appointment from "Checked In" back to "All" list
     */
    const moveToAll = useCallback((appointmentId, appointmentData) => {
        // Remove from "Checked In Patients"
        setCheckedInAppointments(prev => prev.filter(apt => apt.appointmentID !== appointmentId));

        // Add back to "All Appointments" (without status fields)
        const basicAppointment = {
            appointmentID: appointmentData.appointmentID,
            PersonID: appointmentData.PersonID,
            AppDetail: appointmentData.AppDetail,
            AppDate: appointmentData.AppDate,
            PatientType: appointmentData.PatientType,
            PatientName: appointmentData.PatientName,
            Alerts: appointmentData.Alerts,
            apptime: appointmentData.apptime
        };
        setAllAppointments(prev => [...prev, basicAppointment]);
    }, []);

    /**
     * Check in a patient (Scheduled → Present)
     * OPTIMISTIC: Moves from "All" to "Checked In" list immediately
     * Returns actionId for event source detection
     */
    const checkInPatient = useCallback(async (appointmentId) => {
        // Generate unique action ID for tracking
        const actionId = generateActionId();

        // Find appointment in "All Appointments" list
        const appointment = allAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        // Save for rollback
        const savedAppointment = { ...appointment };

        // OPTIMISTIC UPDATE: Move to checked-in list
        const currentTime = getCurrentTime();
        const checkedInAppointment = {
            ...appointment,
            Present: true,
            PresentTime: currentTime,
            Seated: false,
            SeatedTime: null,
            Dismissed: false,
            DismissedTime: null,
            HasVisit: false,
            AppCost: null
        };

        moveToCheckedIn(appointmentId, checkedInAppointment);

        try {
            // Sync with server (includes actionId for tracking)
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Present',
                    time: currentTime,
                    actionId: actionId  // Track this action
                })
            });

            if (!response.ok) {
                throw new Error('Failed to check in patient');
            }

            const result = await response.json();
            console.log('✅ Check-in confirmed by server:', result);

            return { success: true, previousState: 'Scheduled', actionId };
        } catch (err) {
            console.error('❌ Check-in failed, rolling back:', err);
            // ROLLBACK: Move back to "All Appointments"
            setCheckedInAppointments(prev => prev.filter(apt => apt.appointmentID !== appointmentId));
            setAllAppointments(prev => [...prev, savedAppointment]);
            throw err;
        }
    }, [allAppointments, moveToCheckedIn]);

    /**
     * Mark patient as seated (Present → Seated)
     * OPTIMISTIC: Updates in "Checked In" list only (NO reload needed!)
     * Returns actionId for event source detection
     */
    const markSeated = useCallback(async (appointmentId) => {
        // Generate unique action ID for tracking
        const actionId = generateActionId();

        const appointment = checkedInAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        const previousState = {
            Seated: appointment.Seated,
            SeatedTime: appointment.SeatedTime
        };

        // OPTIMISTIC UPDATE
        const currentTime = getCurrentTime();
        updateCheckedInAppointment(appointmentId, {
            Seated: true,
            SeatedTime: currentTime
        });

        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Seated',
                    time: currentTime,
                    actionId: actionId  // Track this action
                })
            });

            if (!response.ok) {
                throw new Error('Failed to seat patient');
            }

            const result = await response.json();
            console.log('✅ Seat confirmed by server:', result);

            return { success: true, previousState: 'Present', actionId };
        } catch (err) {
            console.error('❌ Seat failed, rolling back:', err);
            updateCheckedInAppointment(appointmentId, previousState);
            throw err;
        }
    }, [checkedInAppointments, updateCheckedInAppointment]);

    /**
     * Mark patient as dismissed (Seated → Dismissed)
     * OPTIMISTIC: Updates in "Checked In" list only (NO reload needed!)
     * Returns actionId for event source detection
     */
    const markDismissed = useCallback(async (appointmentId) => {
        // Generate unique action ID for tracking
        const actionId = generateActionId();

        const appointment = checkedInAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        const previousState = {
            Dismissed: appointment.Dismissed,
            DismissedTime: appointment.DismissedTime
        };

        // OPTIMISTIC UPDATE
        const currentTime = getCurrentTime();
        updateCheckedInAppointment(appointmentId, {
            Dismissed: true,
            DismissedTime: currentTime
        });

        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: 'Dismissed',
                    time: currentTime,
                    actionId: actionId  // Track this action
                })
            });

            if (!response.ok) {
                throw new Error('Failed to complete visit');
            }

            const result = await response.json();
            console.log('✅ Dismiss confirmed by server:', result);

            return { success: true, previousState: 'Seated', actionId };
        } catch (err) {
            console.error('❌ Dismiss failed, rolling back:', err);
            updateCheckedInAppointment(appointmentId, previousState);
            throw err;
        }
    }, [checkedInAppointments, updateCheckedInAppointment]);

    /**
     * Undo state (sets state to NULL/false in database)
     * OPTIMISTIC: Updates immediately, may move between lists
     */
    const undoState = useCallback(async (appointmentId, stateToUndo) => {
        const appointment = checkedInAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        // Save full state for rollback
        const savedAppointment = { ...appointment };

        // Determine if this will move appointment back to "All" list
        // Undo Present when no other status -> goes back to "All"
        const willMoveToAll = stateToUndo === 'Present' && !appointment.Seated && !appointment.Dismissed;

        if (willMoveToAll) {
            // OPTIMISTIC UPDATE: Move back to "All Appointments"
            moveToAll(appointmentId, appointment);
        } else {
            // OPTIMISTIC UPDATE: Just clear the specific state
            const updates = {};
            if (stateToUndo === 'Present') {
                updates.Present = false;
                updates.PresentTime = null;
            } else if (stateToUndo === 'Seated') {
                updates.Seated = false;
                updates.SeatedTime = null;
            } else if (stateToUndo === 'Dismissed') {
                updates.Dismissed = false;
                updates.DismissedTime = null;
            }
            updateCheckedInAppointment(appointmentId, updates);
        }

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

            const result = await response.json();
            console.log(`✅ Undo ${stateToUndo} confirmed by server:`, result);

            return { success: true };
        } catch (err) {
            console.error(`❌ Undo ${stateToUndo} failed, rolling back:`, err);

            // ROLLBACK
            if (willMoveToAll) {
                setAllAppointments(prev => prev.filter(apt => apt.appointmentID !== appointmentId));
                setCheckedInAppointments(prev => [...prev, savedAppointment]);
            } else {
                updateCheckedInAppointment(appointmentId, savedAppointment);
            }
            throw err;
        }
    }, [checkedInAppointments, updateCheckedInAppointment, moveToAll]);

    /**
     * Undo action from notification (restores to previous state)
     * OPTIMISTIC: May move between lists
     */
    const undoAction = useCallback(async (appointmentId, previousStateName) => {
        const appointment = checkedInAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        const savedAppointment = { ...appointment };
        const currentTime = getCurrentTime();

        // Determine if we need to move to "All" list
        const willMoveToAll = previousStateName === 'Scheduled';

        if (willMoveToAll) {
            // OPTIMISTIC: Move back to "All Appointments"
            moveToAll(appointmentId, appointment);
        } else {
            // OPTIMISTIC: Update in checked-in list
            const updates = {};
            if (previousStateName === 'Present') {
                updates.Present = true;
                updates.PresentTime = currentTime;
                updates.Seated = false;
                updates.SeatedTime = null;
            } else if (previousStateName === 'Seated') {
                updates.Seated = true;
                updates.SeatedTime = currentTime;
                updates.Dismissed = false;
                updates.DismissedTime = null;
            }
            updateCheckedInAppointment(appointmentId, updates);
        }

        try {
            const response = await fetch('/api/updateAppointmentState', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appointmentID: appointmentId,
                    state: previousStateName,
                    time: currentTime
                })
            });

            if (!response.ok) {
                throw new Error('Failed to undo action');
            }

            const result = await response.json();
            console.log('✅ Undo action confirmed by server:', result);

            return { success: true };
        } catch (err) {
            console.error('❌ Undo action failed, rolling back:', err);

            // ROLLBACK
            if (willMoveToAll) {
                setAllAppointments(prev => prev.filter(apt => apt.appointmentID !== appointmentId));
                setCheckedInAppointments(prev => [...prev, savedAppointment]);
            } else {
                updateCheckedInAppointment(appointmentId, savedAppointment);
            }
            throw err;
        }
    }, [checkedInAppointments, updateCheckedInAppointment, moveToAll]);

    /**
     * Calculate statistics from current appointments
     */
    const calculateStats = useCallback(() => {
        const total = allAppointments.length + checkedInAppointments.length;
        const checkedIn = checkedInAppointments.length;
        const waiting = checkedInAppointments.filter(a => a.Present && !a.Seated && !a.Dismissed).length;
        const completed = checkedInAppointments.filter(a => a.Dismissed).length;

        return { total, checkedIn, waiting, completed };
    }, [allAppointments, checkedInAppointments]);

    return {
        // Two separate lists (matching database behavior)
        allAppointments,
        checkedInAppointments,

        // State
        loading,
        error,

        // Actions (with optimistic updates - NO unnecessary reloads!)
        loadAppointments,
        checkInPatient,
        markSeated,
        markDismissed,
        undoState,
        undoAction,
        calculateStats
    };
}
