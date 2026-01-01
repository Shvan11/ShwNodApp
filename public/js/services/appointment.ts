/**
 * Appointment Service
 * Handles appointments data and operations
 */
import { fetchJSON } from '../core/http';

// Appointment data types
export interface Appointment {
  AppID: number;
  PatientID: number;
  PatientName: string;
  Phone: string;
  AppDate: string;
  AppTime: string;
  Status: number;
  StatusName?: string;
  Notes?: string;
  WorkType?: string;
  [key: string]: unknown;
}

export interface AppointmentsResponse {
  all: number;
  present: number;
  waiting: number;
  completed: number;
  appointments: Appointment[];
}

export interface PatientImage {
  name: string;
}

export interface VisitSummary {
  VisitID: number;
  VisitDate: string;
  Notes?: string;
  [key: string]: unknown;
}

export interface AppointmentServiceOptions {
  apiBase?: string;
}

/**
 * Appointment Service class
 */
export class AppointmentService {
  private options: Required<AppointmentServiceOptions>;

  /**
   * Create a new appointment service
   * @param options - Configuration options
   */
  constructor(options: AppointmentServiceOptions = {}) {
    this.options = {
      apiBase: '/api',
      ...options,
    };
  }

  /**
   * Get appointments for a specific date
   * @param date - Date in YYYY-MM-DD format
   * @returns Appointments data
   */
  async getAppointments(date: string): Promise<AppointmentsResponse> {
    try {
      return await fetchJSON<AppointmentsResponse>(
        `${this.options.apiBase}/getWebApps?PDate=${date}`
      );
    } catch (error) {
      console.error('Error fetching appointments:', error);
      throw error;
    }
  }

  /**
   * Format appointment data for display
   * @param appointmentsData - Raw appointments data
   * @returns Formatted appointments data
   */
  formatAppointmentsData(appointmentsData: AppointmentsResponse | null): AppointmentsResponse {
    if (!appointmentsData) {
      return {
        all: 0,
        present: 0,
        waiting: 0,
        completed: 0,
        appointments: [],
      };
    }

    return {
      all: appointmentsData.all || 0,
      present: appointmentsData.present || 0,
      waiting: appointmentsData.waiting || 0,
      completed: appointmentsData.completed || 0,
      appointments: this.formatAppointments(appointmentsData.appointments || []),
    };
  }

  /**
   * Format appointments array
   * @param appointments - Raw appointments
   * @returns Formatted appointments
   */
  private formatAppointments(appointments: Appointment[]): Appointment[] {
    return appointments.map((appointment) => {
      // Process appointment data if necessary
      return appointment;
    });
  }

  /**
   * Get patient images for a specific timepoint
   * @param patientId - Patient ID
   * @param timepoint - Timepoint code
   * @returns Patient images
   */
  async getPatientImages(patientId: string, timepoint = '0'): Promise<PatientImage[]> {
    try {
      const images = await fetchJSON<number[]>(
        `${this.options.apiBase}/getTimePointImgs?code=${patientId}&tp=${timepoint}`
      );

      // Transform image names to proper format
      return images.map((code) => {
        const name = `${patientId}0${timepoint}.i${code}`;
        return { name };
      });
    } catch (error) {
      console.error('Error getting patient images:', error);
      return [];
    }
  }

  /**
   * Get latest visit summary for a patient
   * @param patientId - Patient ID
   * @returns Latest visit summary
   */
  async getLatestVisitSummary(patientId: string): Promise<VisitSummary> {
    try {
      return await fetchJSON<VisitSummary>(
        `${this.options.apiBase}/getLatestVisitsSum?PID=${patientId}`
      );
    } catch (error) {
      console.error('Error getting latest visit summary:', error);
      throw error;
    }
  }
}

// Export a singleton instance as default
const appointmentService = new AppointmentService();
export default appointmentService;
