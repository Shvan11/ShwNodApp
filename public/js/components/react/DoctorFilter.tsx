/**
 * DoctorFilter Component
 *
 * The calendar's doctor filter. Lists `/api/doctors` — active employees whose
 * position is Doctor, the same set the booking forms, the legend, the daily
 * board and the server use (audit FE-F10-13).
 */

import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { doctorsQuery } from '@/query/queries';

interface DoctorFilterProps {
    selectedDoctorId: number | null;
    onDoctorChange: (doctorId: number | null) => void;
    className?: string;
}

const DoctorFilter = ({ selectedDoctorId, onDoctorChange, className = '' }: DoctorFilterProps) => {
    const { data, isLoading: loading, isError } = useQuery(doctorsQuery());
    const doctors = data ?? [];

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        // Convert empty string to null, otherwise parse as integer
        const doctorId = value === '' ? null : parseInt(value, 10);
        onDoctorChange(doctorId);
    };

    if (loading) {
        return (
            <div className={`doctor-filter ${className}`}>
                <select className="doctor-filter-select" disabled>
                    <option>Loading...</option>
                </select>
            </div>
        );
    }

    if (isError) {
        return (
            <div className={`doctor-filter ${className}`}>
                <select className="doctor-filter-select" disabled>
                    <option>Error</option>
                </select>
            </div>
        );
    }

    return (
        <div className={`doctor-filter ${className}`}>
            <select
                id="doctor-select"
                className="doctor-filter-select"
                aria-label="Filter by doctor"
                value={selectedDoctorId || ''}
                onChange={handleChange}
            >
                <option value="">Filter by Doctor...</option>
                {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                        {doctor.employee_name}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default DoctorFilter;
