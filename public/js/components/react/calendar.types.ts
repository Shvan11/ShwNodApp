/**
 * Shared Calendar Types
 * Common type definitions for all calendar components
 */

// Per-doctor colour used for card tints and the calendar legend
export interface DoctorColor {
    fill: string; // soft card background
    edge: string; // matching border / swatch edge
}

// One entry in the calendar's doctor colour legend
export interface LegendDoctor {
    id: number;
    name: string;
    color: DoctorColor | null; // null = neutral (no tint), e.g. the "Clinic" bucket
}

// Appointment displayed in calendar slots.
// `patientName`/`appDetail` are `| null` to match the contract's `appointmentInfo`
// (shared/contracts/calendar.contract.ts) so the response rows assign in cast-free.
export interface CalendarAppointment {
    appointment_id?: number | string;
    patientName?: string | null;
    appDetail?: string | null;
    personID?: number | null;
    drID?: number | null;
    time?: string;
    app_date?: string;
    person_id?: number | null;
}

// Time slot info containing appointments
export interface CalendarSlotInfo {
    appointments?: CalendarAppointment[];
    appointmentCount?: number;
    slotStatus?: 'available' | 'booked' | 'full' | 'past' | string;
}

// A day in the calendar with all its data
export interface CalendarDay {
    date: string;
    dayName?: string;
    dayOfWeek?: number;
    appointmentCount?: number;
    isHoliday?: boolean;
    // `| null` mirrors the contract's weekDay/monthDay holiday columns
    // (shared/contracts/calendar.contract.ts) so the response rows assign in cast-free.
    holidayId?: number | null;
    holidayName?: string | null;
    holidayDescription?: string | null;
    // Appointments can be a record keyed by time slot OR an array
    appointments?: CalendarAppointment[] | Record<string, CalendarSlotInfo | CalendarAppointment[]>;
}

// Calendar data structure returned from API
export interface CalendarData {
    days: CalendarDay[];
    timeSlots?: string[];
}

// Stats displayed in calendar header
export interface CalendarStats {
    utilizationPercent: number;
    availableSlots: number;
    bookedSlots: number;
    totalSlots: number;
}

// Slot data passed between components
export interface SlotData {
    date: string;
    time: string;
    dayName?: string;
    appointments?: CalendarAppointment[];
    slotStatus: 'available' | 'booked' | 'full' | 'past' | string;
    appointment_id?: number | string;
    appDetail?: string;
    patientName?: string;
}

// Position for context menus
export interface MenuPosition {
    x: number;
    y: number;
}

// View modes
export type ViewMode = 'day' | 'week' | 'month';
export type CalendarMode = 'view' | 'selection';

// Holiday modal data
export interface ExistingHoliday {
    ID?: number;
    HolidayName?: string;
    Description?: string;
}

export interface AppointmentWarning {
    count: number;
    date?: string;
    appointments?: Array<{
        patient_name: string;
        app_detail?: string;
        app_date?: string;
    }>;
}

// Holiday save data
export interface SaveHolidayData {
    date: string;
    holidayName: string;
    description: string;
    existingId?: number;
}
