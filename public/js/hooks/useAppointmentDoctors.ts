/**
 * useAppointmentDoctors
 *
 * The calendar's doctors (`/api/doctors`: active employees whose position is
 * Doctor — the one definition the booking forms, the calendar filter, the legend,
 * the daily board and the server share; audit FE-F10-13) with each one's calendar
 * colour. Powers both the legend and the per-doctor card tints from one read, so
 * the two always agree.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doctorsQuery } from '@/query/queries';
import { buildDoctorColors, type DoctorColorResult } from '../components/react/doctorColors';

const EMPTY: DoctorColorResult = { byId: new Map(), legend: [] };

export function useAppointmentDoctors(): DoctorColorResult & { loading: boolean } {
    const { data, isLoading: loading } = useQuery(doctorsQuery());

    const result = useMemo<DoctorColorResult>(
        () => (data && data.length > 0 ? buildDoctorColors(data) : EMPTY),
        [data]
    );

    return { byId: result.byId, legend: result.legend, loading };
}
