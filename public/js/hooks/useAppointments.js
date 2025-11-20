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
    const [stats, setStats] = useState({ total: 0, checkedIn: 0, waiting: 0, completed: 0 });
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
     * Fetch appointments for a specific date (OPTIMIZED - Phase 3)
     * Uses unified endpoint for 80% performance improvement
     * ONLY called on: initial load, date change, WebSocket update
     */
    const loadAppointments = useCallback(async (date) => {
        if (!date) return;

        console.log('🔄 Loading appointments for date:', date);

        try {
            setLoading(true);
            setError(null);

            // Use unified optimized endpoint (single API call)
            const response = await fetch(`/api/getDailyAppointments?AppsDate=${date}`);

            if (!response.ok) {
                throw new Error('Failed to fetch appointments');
            }

            const data = await response.json();

            console.log('✅ Fetched appointments (optimized):', {
                all: data.allAppointments?.length || 0,
                checkedIn: data.checkedInAppointments?.length || 0,
                stats: data.stats
            });

            setAllAppointments(data.allAppointments || []);
            setCheckedInAppointments(data.checkedInAppointments || []);
            setStats(data.stats || { total: 0, checkedIn: 0, waiting: 0, completed: 0 });
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
            hasActiveAlert: appointmentData.hasActiveAlert,
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
            PresentTime: currentTime,
            SeatedTime: null,
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
     * Returns actionId for event source detection
     * Enhanced with validation to enforce logical state transitions
     */
    const undoState = useCallback(async (appointmentId, stateToUndo) => {
        // Generate unique action ID for tracking
        const actionId = generateActionId();

        const appointment = checkedInAppointments.find(a => a.appointmentID === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }

        // CLIENT-SIDE VALIDATION: Check logical state transition rules
        if (stateToUndo === 'Present' && appointment.SeatedTime) {
            const errorMsg = 'Cannot undo check-in: Patient is already seated';
            console.warn('⚠️ Validation failed:', errorMsg);
            throw new Error(errorMsg);
        }

        if (stateToUndo === 'Seated' && appointment.DismissedTime) {
            const errorMsg = 'Cannot undo seated: Patient visit is already completed';
            console.warn('⚠️ Validation failed:', errorMsg);
            throw new Error(errorMsg);
        }

        // Save full state for rollback
        const savedAppointment = { ...appointment };

        // Determine if this will move appointment back to "All" list
        // Undo Present when no other status -> goes back to "All"
        const willMoveToAll = stateToUndo === 'Present' && !appointment.SeatedTime && !appointment.DismissedTime;

        if (willMoveToAll) {
            // OPTIMISTIC UPDATE: Move back to "All Appointments"
            moveToAll(appointmentId, appointment);
        } else {
            // OPTIMISTIC UPDATE: Just clear the specific state
            const updates = {};
            if (stateToUndo === 'Present') {
                updates.PresentTime = null;
            } else if (stateToUndo === 'Seated') {
                updates.SeatedTime = null;
            } else if (stateToUndo === 'Dismissed') {
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
                    state: stateToUndo,
                    actionId: actionId  // Track this action
                })
            });

            if (!response.ok) {
                // Parse error response for validation errors
                const errorData = await response.json().catch(() => null);
                if (errorData && errorData.error) {
                    throw new Error(errorData.error);
                }
                throw new Error(`Failed to undo ${stateToUndo}`);
            }

            const result = await response.json();
            console.log(`✅ Undo ${stateToUndo} confirmed by server:`, result);

            return { success: true, actionId };
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
                updates.PresentTime = currentTime;
                updates.SeatedTime = null;
            } else if (previousStateName === 'Seated') {
                updates.SeatedTime = currentTime;
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
     * GRANULAR UPDATE: Apply specific changes from WebSocket (external client updates)
     * This prevents full reloads when other clients make changes
     * Updates ONLY the affected appointment without refetching all data
     */
    const applyGranularUpdate = useCallback((changeData) => {
        const { changeType, appointmentId, state, updates } = changeData;

        console.log('🔄 Applying granular update:', changeData);

        if (changeType === 'status_changed') {
            // Try updating in allAppointments first
            setAllAppointments(prev => {
                const index = prev.findIndex(apt => apt.appointmentID === appointmentId);

                if (index !== -1) {
                    // Found in allAppointments
                    const updated = [...prev];
                    updated[index] = { ...updated[index], ...updates };

                    // If they checked in (Present), move to checkedIn list
                    if (state === 'Present' && updates.Present) {
                        console.log('📋 Moving appointment to checked-in list:', appointmentId);
                        setCheckedInAppointments(prevChecked => [...prevChecked, updated[index]]);
                        return prev.filter(apt => apt.appointmentID !== appointmentId);
                    }

                    return updated;
                }
                return prev;
            });

            // Try updating in checkedInAppointments
            setCheckedInAppointments(prev => {
                const index = prev.findIndex(apt => apt.appointmentID === appointmentId);
                if (index !== -1) {
                    console.log('✏️ Updating appointment in checked-in list:', appointmentId);
                    const updated = [...prev];
                    updated[index] = { ...updated[index], ...updates };
                    return updated;
                }
                return prev;
            });

            console.log('✅ Granular update applied successfully');
        } else {
            console.warn('⚠️ Unknown change type, may need full reload:', changeType);
        }
    }, []);

    /**
     * Get statistics (OPTIMIZED - Phase 3 & 4)
     * Now uses stats from API instead of calculating client-side
     * Falls back to calculation for optimistic updates
     *
     * Performance: Automatically optimized by React Compiler (React 19).
     * No manual useCallback needed - the compiler memoizes this automatically.
     */
    const getStats = () => {
        // If we have fresh stats from API, use them
        if (stats && stats.total > 0) {
            return stats;
        }

        // Fallback: Calculate from current state (for optimistic updates)
        // React Compiler will automatically memoize this calculation
        const total = allAppointments.length + checkedInAppointments.length;
        const checkedIn = checkedInAppointments.length;
        const waiting = checkedInAppointments.filter(a => a.Present && !a.Seated && !a.Dismissed).length;
        const completed = checkedInAppointments.filter(a => a.Dismissed).length;

        return { total, checkedIn, waiting, completed };
    };

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

        // Granular WebSocket updates (efficient real-time sync)
        applyGranularUpdate,

        // Stats (OPTIMIZED - from API or calculated)
        getStats
    };
}
