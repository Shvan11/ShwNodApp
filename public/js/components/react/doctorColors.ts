/**
 * Doctor calendar colours — single source of truth shared by the calendar grid
 * (card tints), the calendar legend, and the Employee Settings colour picker.
 *
 * The colourable set is data-driven from tblEmployees: any employee with
 * getAppointments = 1 can carry a colour. A doctor's effective colour is:
 *   1. their explicit AppointmentColor (hex picked in Employee Settings), or
 *   2. a built-in default for the historically hand-tuned doctors, or
 *   3. neutral (no tint) — e.g. the generic "Clinic" house bucket.
 */

import type { DoctorColor, LegendDoctor } from './calendar.types';

/** Minimal employee shape needed to resolve a calendar colour. */
export interface DoctorColorSource {
    ID: number;
    employeeName: string;
    AppointmentColor?: string | null;
}

/**
 * Built-in defaults for the historically hand-tuned doctors, applied when the
 * employee has no AppointmentColor set so their calendar look is preserved
 * exactly. Editing the colour in Employee Settings overrides these.
 * Keyed by drID (tblEmployees.ID). fill = soft card background, edge = border.
 */
const FIXED_DEFAULT_COLORS: Record<number, DoctorColor> = {
    7: { fill: 'oklch(94% 0.04 250)', edge: 'oklch(70% 0.12 250)' }, // Rojena — blue
    1: { fill: 'oklch(94% 0.05 85)',  edge: 'oklch(72% 0.13 85)'  }  // Shwan Elias — amber
};

/** Seed shown in the Settings colour picker when no custom colour is set. */
export const DEFAULT_PICKER_HEX: Record<number, string> = {
    7: '#4f8de0', // ≈ Rojena blue
    1: '#d8a64b'  // ≈ Shwan amber
};
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
    if (emp.AppointmentColor) {
        const custom = hexToDoctorColor(emp.AppointmentColor);
        if (custom) return custom;
    }
    return FIXED_DEFAULT_COLORS[emp.ID] ?? null;
}

export interface DoctorColorResult {
    /** drID → colour for tinting cards. Neutral doctors are intentionally omitted. */
    byId: Map<number, DoctorColor>;
    /** Every appointment-eligible doctor, in display order, for the legend. */
    legend: LegendDoctor[];
}

/**
 * Build the card-tint lookup and the legend list from the appointment-eligible
 * doctors (already filtered to getAppointments = 1 by the caller).
 */
export function buildDoctorColors(eligible: DoctorColorSource[]): DoctorColorResult {
    const byId = new Map<number, DoctorColor>();
    const legend: LegendDoctor[] = [];
    for (const emp of eligible) {
        const color = resolveDoctorColor(emp);
        if (color) byId.set(emp.ID, color);
        legend.push({ id: emp.ID, name: emp.employeeName, color });
    }
    return { byId, legend };
}
