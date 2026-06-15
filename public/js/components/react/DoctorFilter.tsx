/**
 * DoctorFilter Component
 *
 * Dropdown filter for selecting a doctor to filter calendar appointments
 * Fetches doctor list from /api/doctors and provides selection UI
 */

import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import { doctorsQuery } from '@/query/queries';

interface Doctor {
    id: number;
    employee_name: string;
}

interface DoctorFilterProps {
    selectedDoctorId: number | null;
    onDoctorChange: (doctorId: number | null) => void;
    className?: string;
}

const DoctorFilter = ({ selectedDoctorId, onDoctorChange, className = '' }: DoctorFilterProps) => {
    const { data, isLoading: loading, error: queryError } = useQuery(doctorsQuery());
    const doctors: Doctor[] = data ?? [];
    const error = queryError ? httpErrorMessage(queryError, 'Unknown error') : null;

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

    if (error) {
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
