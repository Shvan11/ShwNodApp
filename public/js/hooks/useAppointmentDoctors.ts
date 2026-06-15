/**
 * useAppointmentDoctors
 *
 * Fetches the appointment-eligible doctors (tblEmployees.getAppointments = 1)
 * and resolves each one's calendar colour. Powers both the calendar legend and
 * the per-doctor card tints from a single source, so the two always agree.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeesQuery } from '@/query/queries';
import { buildDoctorColors, type DoctorColorResult, type DoctorColorSource } from '../components/react/doctorColors';

const EMPTY: DoctorColorResult = { byId: new Map(), legend: [] };

export function useAppointmentDoctors(): DoctorColorResult & { loading: boolean } {
    const { data, isLoading: loading } = useQuery(employeesQuery('?getAppointments=true'));

    const result = useMemo<DoctorColorResult>(() => {
        const employees: DoctorColorSource[] = Array.isArray(data?.employees) ? data.employees : [];
        return employees.length > 0 ? buildDoctorColors(employees) : EMPTY;
    }, [data]);

    return { byId: result.byId, legend: result.legend, loading };
}
