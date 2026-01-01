import { useState, useCallback } from 'react';

/**
 * Appointment statistics from API
 */
export interface AppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
}

/**
 * Appointment data from API
 */
export interface Appointment {
  AppointmentID: number;
  PatientID: number;
  PatientName?: string;
  AppsDate?: string;
  AppsTime?: string;
  State?: string;
  Phone?: string;
  [key: string]: unknown;
}

/**
 * Initial data from loader
 */
export interface AppointmentsLoaderData {
  allAppointments?: Appointment[];
  checkedInAppointments?: Appointment[];
  stats?: AppointmentStats;
  error?: string | null;
}

/**
 * Return type for useAppointments hook
 */
export interface UseAppointmentsReturn {
  allAppointments: Appointment[];
  checkedInAppointments: Appointment[];
  loading: boolean;
  error: string | null;
  loadAppointments: (date: string) => Promise<void>;
  checkInPatient: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markSeated: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  markDismissed: (appointmentId: number, currentDate: string) => Promise<{ success: boolean }>;
  undoState: (appointmentId: number, stateToUndo: string, currentDate: string) => Promise<{ success: boolean }>;
  getStats: () => AppointmentStats;
}

/**
 * Custom hook for managing appointments data and actions
 *
 * SIMPLIFIED APPROACH:
 * - NO optimistic updates (wait for server confirmation)
 * - NO action ID tracking (unnecessary complexity)
 * - NO rollback logic (just reload on error)
 * - Database is the single source of truth
 *
 * User sees loading spinner -> Server updates DB -> Broadcast to all clients -> Reload
 *
 * @param initialData - Optional initial data from loader
 */
export function useAppointments(
  initialData: AppointmentsLoaderData | null = null
): UseAppointmentsReturn {
  // TWO SEPARATE LISTS (matching database structure)
  // Initialize from loader data if provided
  const [allAppointments, setAllAppointments] = useState<Appointment[]>(
    initialData?.allAppointments || []
  );
  const [checkedInAppointments, setCheckedInAppointments] = useState<Appointment[]>(
    initialData?.checkedInAppointments || []
  );
  const [stats, setStats] = useState<AppointmentStats>(
    initialData?.stats || { total: 0, checkedIn: 0, absent: 0, waiting: 0 }
  );

  // Only show loading spinner if we have NO initial data
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(initialData?.error || null);

  /**
   * Get current time in HH:MM:SS format
   */
  const getCurrentTime = (): string => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  };

  /**
   * Fetch appointments for a specific date
   * Called on: initial load, date change, WebSocket update
   */
  const loadAppointments = useCallback(async (date: string): Promise<void> => {
    if (!date) return;

    console.log('Loading appointments for date:', date);

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/getDailyAppointments?AppsDate=${date}`);

      if (!response.ok) {
        throw new Error('Failed to fetch appointments');
      }

      const data = await response.json();

      console.log('Loaded appointments:', {
        all: data.allAppointments?.length || 0,
        checkedIn: data.checkedInAppointments?.length || 0,
        stats: data.stats,
      });

      setAllAppointments(data.allAppointments || []);
      setCheckedInAppointments(data.checkedInAppointments || []);
      setStats(data.stats || { total: 0, checkedIn: 0, absent: 0, waiting: 0 });
    } catch (err) {
      console.error('Error loading appointments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Check in a patient (Scheduled -> Present)
   * SIMPLIFIED: Wait for server, then reload
   */
  const checkInPatient = useCallback(
    async (appointmentId: number, currentDate: string): Promise<{ success: boolean }> => {
      const currentTime = getCurrentTime();
      console.log(`Checking in appointment ${appointmentId}`);

      try {
        setLoading(true);

        const response = await fetch('/api/updateAppointmentState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentID: appointmentId,
            state: 'Present',
            time: currentTime,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to check in patient');
        }

        const result = await response.json();
        console.log('Check-in confirmed:', result);

        // Reload appointments to get fresh data
        await loadAppointments(currentDate);

        return { success: true };
      } catch (err) {
        console.error('Check-in failed:', err);
        setError(err instanceof Error ? err.message : 'Check-in failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadAppointments]
  );

  /**
   * Mark patient as seated (Present -> Seated)
   * SIMPLIFIED: Wait for server, then reload
   */
  const markSeated = useCallback(
    async (appointmentId: number, currentDate: string): Promise<{ success: boolean }> => {
      const currentTime = getCurrentTime();
      console.log(`Seating appointment ${appointmentId}`);

      try {
        setLoading(true);

        const response = await fetch('/api/updateAppointmentState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentID: appointmentId,
            state: 'Seated',
            time: currentTime,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to seat patient');
        }

        const result = await response.json();
        console.log('Seated confirmed:', result);

        // Reload appointments to get fresh data
        await loadAppointments(currentDate);

        return { success: true };
      } catch (err) {
        console.error('Seat failed:', err);
        setError(err instanceof Error ? err.message : 'Seat failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadAppointments]
  );

  /**
   * Mark patient as dismissed (Seated -> Dismissed)
   * SIMPLIFIED: Wait for server, then reload
   */
  const markDismissed = useCallback(
    async (appointmentId: number, currentDate: string): Promise<{ success: boolean }> => {
      const currentTime = getCurrentTime();
      console.log(`Dismissing appointment ${appointmentId}`);

      try {
        setLoading(true);

        const response = await fetch('/api/updateAppointmentState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentID: appointmentId,
            state: 'Dismissed',
            time: currentTime,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to complete visit');
        }

        const result = await response.json();
        console.log('Dismissed confirmed:', result);

        // Reload appointments to get fresh data
        await loadAppointments(currentDate);

        return { success: true };
      } catch (err) {
        console.error('Dismiss failed:', err);
        setError(err instanceof Error ? err.message : 'Dismiss failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadAppointments]
  );

  /**
   * Undo state (sets state to NULL in database)
   * SIMPLIFIED: Wait for server, then reload
   */
  const undoState = useCallback(
    async (
      appointmentId: number,
      stateToUndo: string,
      currentDate: string
    ): Promise<{ success: boolean }> => {
      console.log(`Undoing ${stateToUndo} for appointment ${appointmentId}`);

      try {
        setLoading(true);

        const response = await fetch('/api/undoAppointmentState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentID: appointmentId,
            state: stateToUndo,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          if (errorData && errorData.error) {
            throw new Error(errorData.error);
          }
          throw new Error(`Failed to undo ${stateToUndo}`);
        }

        const result = await response.json();
        console.log(`Undo ${stateToUndo} confirmed:`, result);

        // Reload appointments to get fresh data
        await loadAppointments(currentDate);

        return { success: true };
      } catch (err) {
        console.error(`Undo ${stateToUndo} failed:`, err);
        setError(err instanceof Error ? err.message : `Undo ${stateToUndo} failed`);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadAppointments]
  );

  /**
   * Get statistics (from API data)
   */
  const getStats = (): AppointmentStats => {
    return stats;
  };

  return {
    // Data
    allAppointments,
    checkedInAppointments,
    loading,
    error,

    // Actions
    loadAppointments,
    checkInPatient,
    markSeated,
    markDismissed,
    undoState,
    getStats,
  };
}
