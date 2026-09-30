/**
 * Doctor calendar colours — single source of truth shared by the calendar grid
 * (card tints), the calendar legend, the daily board and the Employee Settings
 * colour picker.
 *
 * A doctor's colour is their `appointment_color` (a hex picked in Employee
 * Settings), or neutral (no tint) when none is set — e.g. the "Clinic" bucket.
 *
 * There used to be a third source: built-in defaults keyed by employee id 1 and
 * 7, this clinic's two original doctors. On every other install id 1 is the
 * seeded Clinic pseudo-doctor, which then showed up amber (audit FE-F10-11).
 * Migration 1789460600000 wrote those two colours into this clinic's rows.
 */

import type { DoctorColor, LegendDoctor } from './calendar.types';

/** Minimal employee shape needed to resolve a calendar colour. */
export interface DoctorColorSource {
    id: number;
    employee_name: string;
    appointment_color?: string | null;
}

/** Seed shown in the Settings colour picker when no appointment_color is set. */
export const NEUTRAL_PICKER_HEX = '#8a94a6';

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** Derive a soft card fill + saturated edge from a single picked hex colour. */
export function hexToDoctorColor(hex: string): DoctorColor | null {
    const match = HEX_RE.exec(hex.trim());
    if (!match) return null;
    const int = parseInt(match[1], 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    // Soft fill: 16% colour over white — matches the light tint of the defaults.
    const tint = (c: number) => Math.round(c + (255 - c) * 0.84);
    return {
        fill: `rgb(${tint(r)} ${tint(g)} ${tint(b)})`,
        edge: `#${match[1].toLowerCase()}`
    };
}

/**
 * Effective calendar colour for an employee, or null when they should render
 * neutral (no tint).
 */
export function resolveDoctorColor(emp: DoctorColorSource): DoctorColor | null {
    return emp.appointment_color ? hexToDoctorColor(emp.appointment_color) : null;
}

export interface DoctorColorResult {
    /** drID → colour for tinting cards. Neutral doctors are intentionally omitted. */
    byId: Map<number, DoctorColor>;
    /** Every calendar doctor, in display order, for the legend. */
    legend: LegendDoctor[];
}

/**
 * Build the card-tint lookup and the legend list from the calendar doctors
 * (`/api/doctors`: active, position Doctor — see useAppointmentDoctors).
 */
export function buildDoctorColors(eligible: DoctorColorSource[]): DoctorColorResult {
    const byId = new Map<number, DoctorColor>();
    const legend: LegendDoctor[] = [];
    for (const emp of eligible) {
        const color = resolveDoctorColor(emp);
        if (color) byId.set(emp.id, color);
        legend.push({ id: emp.id, name: emp.employee_name, color });
    }
    return { byId, legend };
}
