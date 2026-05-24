/**
 * useAppointmentDoctors
 *
 * Fetches the appointment-eligible doctors (tblEmployees.getAppointments = 1)
 * and resolves each one's calendar colour. Powers both the calendar legend and
 * the per-doctor card tints from a single source, so the two always agree.
 */

import { useState, useEffect } from 'react';
import { buildDoctorColors, type DoctorColorResult } from '../components/react/doctorColors';

const EMPTY: DoctorColorResult = { byId: new Map(), legend: [] };

export function useAppointmentDoctors(): DoctorColorResult & { loading: boolean } {
    const [result, setResult] = useState<DoctorColorResult>(EMPTY);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/employees?getAppointments=true');
                if (!res.ok) throw new Error(`Failed to load doctors: ${res.status}`);
                const data = await res.json();
                const employees = Array.isArray(data?.employees) ? data.employees : [];
                if (!cancelled) setResult(buildDoctorColors(employees));
            } catch (err) {
                console.error('Error loading appointment doctors:', err);
                if (!cancelled) setResult(EMPTY);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return { byId: result.byId, legend: result.legend, loading };
}
